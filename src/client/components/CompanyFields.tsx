// Companies in forms: choosing (or adding) a job's company, and a company's logo.
import { useRef, useState } from 'react';
import type { Company } from '@shared/types';
import { uploadFile } from '../lib/api';
import { useActions } from '../lib/queries';
import { Icon } from './Icon';
import { CompanyLogo } from './CompanyLogo';
import { cx } from './ui';
import { INDUSTRIES } from '@shared/lookups';
import { DEFAULT_LOGO_COLOR, LOGO_COLORS, logoColor } from '@shared/logo';

/** The company's logo at the right of its card's heading: add one, change it, or remove it. */
export function CompanyLogoEdit({ company }: { company: Company | undefined }) {
  const act = useActions();
  const input = useRef<HTMLInputElement>(null);
  if (!company) return null;
  const upload = async (file: File | undefined) => {
    if (!file) return;
    await act.run(() => uploadFile(`/companies/${company.id}/logo`, file), 'Logo added');
  };
  return (
    <div className="co-logo-edit">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {company.has_logo ? (
        <>
          <button
            type="button"
            className="co-logo-btn"
            aria-label="Change the logo"
            title="Change the logo"
            onClick={() => input.current?.click()}
          >
            <CompanyLogo company={company} size={32} />
          </button>
          <button
            type="button"
            className="linkish"
            onClick={() => void act.del(`/companies/${company.id}/logo`, 'Logo removed')}
          >
            Remove
          </button>
        </>
      ) : (
        <button type="button" className="linkish" onClick={() => input.current?.click()}>
          <Icon name="upload" size={14} /> Add logo
        </button>
      )}
    </div>
  );
}

/**
 * A company's big mark on its page: its logo, or its monogram when it has none. A ⋯ button over
 * its corner (on hover; always there on touch) opens a menu: Replace and Delete for a logo;
 * Upload logo and the monogram's color (a small palette, ultramarine by default) otherwise.
 */
export function LogoMark({ company }: { company: Company }) {
  const act = useActions();
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const current = logoColor(company.logo_color).key;
  const upload = async (file: File | undefined) => {
    if (!file) return;
    await act.run(
      () => uploadFile(`/companies/${company.id}/logo`, file),
      company.has_logo ? 'Logo replaced' : 'Logo added',
    );
  };
  return (
    <span
      className={cx('co-mark big has-logo', !company.has_logo && 'mono')}
      onMouseLeave={() => setMenu(false)}
    >
      <CompanyLogo company={company} size={64} />
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="co-logo-more"
        aria-label="Logo options"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
      >
        <Icon name="more" size={14} />
      </button>
      {menu && (
        <span className="co-logo-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              input.current?.click();
            }}
          >
            <Icon name="upload" size={14} /> {company.has_logo ? 'Replace' : 'Upload logo'}
          </button>
          {company.has_logo ? (
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => {
                setMenu(false);
                void act.del(`/companies/${company.id}/logo`, 'Logo deleted');
              }}
            >
              <Icon name="trash" size={14} /> Delete
            </button>
          ) : (
            <span className="co-colors" role="group" aria-label="Color">
              <span className="co-colors-l">Color</span>
              <span className="co-swatches">
                {LOGO_COLORS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={c.key === current}
                    aria-label={c.label}
                    title={c.label}
                    className="co-swatch"
                    style={{ background: c.hex }}
                    onClick={() => {
                      setMenu(false);
                      if (c.key !== current)
                        void act.patch(`/companies/${company.id}`, {
                          logo_color: c.key === DEFAULT_LOGO_COLOR ? null : c.key,
                        });
                    }}
                  >
                    {c.key === current && <Icon name="check" size={14} />}
                  </button>
                ))}
              </span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export interface NewCompany {
  name: string;
  website: string;
  linkedin: string;
  hq: string;
  size: string;
  industry: string;
  funding: string;
}
export const EMPTY_COMPANY: NewCompany = {
  name: '',
  website: '',
  linkedin: '',
  hq: '',
  size: '',
  industry: '',
  funding: '',
};

/**
 * Adding a job: find the company it's at among yours, or add a new company (its details in a
 * card of their own). `picked` is the chosen company; `fresh` the new one being filled in.
 */
export function CompanyChooser({
  companies,
  picked,
  onPick,
  fresh,
  onFresh,
  logo,
  onLogo,
}: {
  companies: Company[];
  picked: Company | null;
  onPick: (c: Company | null) => void;
  fresh: NewCompany | null;
  onFresh: (c: NewCompany | null) => void;
  /** A logo for the new company, uploaded once it's made. */
  logo: File | null;
  onLogo: (f: File | null) => void;
}) {
  const logoInput = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(-1);
  const [open, setOpen] = useState(false);
  if (picked)
    return (
      <div className="co-chosen">
        <span className={picked.has_logo ? 'co-mark has-img' : 'co-mark'}>
          <CompanyLogo company={picked} size={40} />
        </span>
        <strong>{picked.name}</strong>
        <button type="button" className="btn sm" onClick={() => onPick(null)}>
          Change
        </button>
      </div>
    );
  if (fresh) {
    const set = (k: keyof NewCompany) => (e: { target: { value: string } }) =>
      onFresh({ ...fresh, [k]: e.target.value });
    const inp = (k: keyof NewCompany, label: string, url = false, list?: string) => (
      <label className="fg">
        <span className="lbl">{label}</span>
        <input
          className="in"
          value={fresh[k]}
          onChange={set(k)}
          list={list}
          {...(url ? { inputMode: 'url' as const, autoCapitalize: 'off', spellCheck: false } : {})}
        />
      </label>
    );
    return (
      <div className="co-new card-inset">
        <div className="co-new-h">
          <strong>
            <Icon name="building" size={16} /> New Company
          </strong>
          <button type="button" className="linkish" onClick={() => onFresh(null)}>
            Choose an existing one
          </button>
        </div>
        <div className="co-new-name">
          <button
            type="button"
            className="co-mark co-logo-pick"
            aria-label={logo ? 'Change the logo' : 'Add a logo'}
            title={logo ? 'Change the logo' : 'Add a logo'}
            onClick={() => logoInput.current?.click()}
          >
            {logo ? (
              <img src={URL.createObjectURL(logo)} alt="" className="co-logo" />
            ) : (
              <Icon name="upload" size={18} />
            )}
          </button>
          <input
            ref={logoInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            hidden
            onChange={(e) => {
              onLogo(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
          {inp('name', 'Company Name')}
        </div>
        <div className="two">
          {inp('website', 'Website', true)}
          {inp('linkedin', 'LinkedIn', true)}
          {inp('hq', 'Headquarters')}
          {inp('size', 'Size')}
          {inp('industry', 'Industry', false, 'kk-industries')}
          {inp('funding', 'Funding')}
        </div>
        <datalist id="kk-industries">
          {INDUSTRIES.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </div>
    );
  }
  const ql = q.trim().toLowerCase();
  const hits = companies.filter((c) => !ql || c.name.toLowerCase().includes(ql)).slice(0, 8);
  const exact = companies.some((c) => c.name.trim().toLowerCase() === ql);
  // The list: matching companies, then "Add company" (with what's typed as its name).
  const choices = [...hits.map((c) => ({ c })), ...(exact ? [] : [{ c: null }])];
  const choose = (i: number) => {
    const ch = choices[i];
    if (!ch) return;
    if (ch.c) onPick(ch.c);
    else onFresh({ ...EMPTY_COMPANY, name: q.trim() });
  };
  return (
    <div className="co-pick">
      <label className="search-in search-full">
        <Icon name="search" size={16} />
        <input
          value={q}
          placeholder="Search companies"
          aria-label="Company"
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(-1);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              setHi((i) => Math.max(0, Math.min(choices.length - 1, i + d)));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(hi >= 0 ? hi : 0);
            }
          }}
        />
      </label>
      {open && (
        <div className="sel-list co-list" role="listbox" aria-label="Companies">
          <div>
            {choices.map((ch, i) => (
              <div
                key={ch.c?.id ?? 'new'}
                role="option"
                aria-selected={i === hi}
                className={cx('sel-opt', i === hi && 'hi', !ch.c && 'co-add')}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
              >
                {ch.c ? (
                  ch.c.name
                ) : (
                  <span>
                    <Icon name="plus" size={14} /> Add company{q.trim() ? ` “${q.trim()}”` : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Where someone works, as a person's sheet picks it: one of yours, a new one by name, or none. */
export type CompanyPick = { id: string | null } | { name: string };

/**
 * A person's company: shows the one they're at with Change; changing searches your companies,
 * offers "Add company" for a name that's new, and "No company" to take them off theirs.
 */
export function CompanyLookup({
  companies,
  value,
  onChange,
}: {
  companies: Company[];
  value: CompanyPick;
  onChange: (v: CompanyPick) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const current = 'id' in value ? companies.find((c) => c.id === value.id) : undefined;
  if (!editing)
    return (
      <div className="co-chosen">
        {'name' in value ? (
          <>
            <span className="co-mark">
              <Icon name="building" size={18} />
            </span>
            <strong>{value.name}</strong>
            <span className="sub">New company</span>
          </>
        ) : current ? (
          <>
            <span className={current.has_logo ? 'co-mark has-img' : 'co-mark'}>
              <CompanyLogo company={current} size={40} />
            </span>
            <strong>{current.name}</strong>
          </>
        ) : (
          <strong className="co-none">No company</strong>
        )}
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            setQ('');
            setHi(0);
            setEditing(true);
          }}
        >
          Change
        </button>
      </div>
    );
  const ql = q.trim().toLowerCase();
  const hits = companies
    .filter((c) => !ql || c.name.toLowerCase().includes(ql))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 8);
  const exact = companies.some((c) => c.name.trim().toLowerCase() === ql);
  type Choice = { kind: 'co'; c: Company } | { kind: 'add' } | { kind: 'none' };
  const choices: Choice[] = [
    ...hits.map((c) => ({ kind: 'co' as const, c })),
    ...(ql && !exact ? [{ kind: 'add' as const }] : []),
    ...(!ql ? [{ kind: 'none' as const }] : []),
  ];
  const choose = (ch: Choice | undefined) => {
    if (!ch) return;
    onChange(
      ch.kind === 'co' ? { id: ch.c.id } : ch.kind === 'add' ? { name: q.trim() } : { id: null },
    );
    setEditing(false);
  };
  return (
    <div className="co-pick">
      <label className="search-in search-full">
        <Icon name="search" size={16} />
        <input
          autoFocus
          value={q}
          placeholder="Search companies"
          aria-label="Company"
          aria-autocomplete="list"
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const d = e.key === 'ArrowDown' ? 1 : -1;
              setHi((i) => Math.max(0, Math.min(choices.length - 1, i + d)));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(choices[hi]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
        <button type="button" className="linkish" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </label>
      <div className="sel-list co-list" role="listbox" aria-label="Companies">
        <div>
          {choices.map((ch, i) => (
            <div
              key={ch.kind === 'co' ? ch.c.id : ch.kind}
              role="option"
              aria-selected={i === hi}
              className={cx('sel-opt', i === hi && 'hi', ch.kind !== 'co' && 'co-add')}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(ch);
              }}
            >
              {ch.kind === 'co' ? (
                ch.c.name
              ) : ch.kind === 'add' ? (
                <span>
                  <Icon name="plus" size={14} /> Add company “{q.trim()}”
                </span>
              ) : (
                <span>No company</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
