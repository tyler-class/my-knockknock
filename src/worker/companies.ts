// Companies as their own records. A job points at its company (company_id); the company's
// details and logo live on the company. Each job keeps a copy of its company's name and details
// in its company_* columns (kept in step here), so lists, search and assistants that read the job
// still see them. A job's company is found by name, ignoring case and spaces at the ends.
import type { Company } from '@shared/types';
import { first, insertStmt, newId, nowIso, toCompany, updateStmt } from './db';

export type CompanyFields = Partial<
  Pick<Company, 'name' | 'website' | 'linkedin' | 'hq' | 'size' | 'industry' | 'funding'>
>;

/** "https://www.acme.com/about" → "acme.com": what assistants match an email's domain against. */
export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(/^https?:/i.test(website) ? website : `https://${website}`).hostname
      .replace(/^www\./i, '')
      .toLowerCase();
  } catch {
    return null;
  }
}

export async function loadCompany(db: D1Database, id: string): Promise<Company | null> {
  const r = await first(db, 'SELECT * FROM companies WHERE id = ?', id);
  return r ? toCompany(r) : null;
}

export async function findCompanyByName(db: D1Database, name: string) {
  const r = await first(
    db,
    'SELECT * FROM companies WHERE lower(trim(name)) = lower(trim(?)) ORDER BY created_at LIMIT 1',
    name,
  );
  return r ? toCompany(r) : null;
}

export async function createCompany(db: D1Database, f: CompanyFields & { name: string }) {
  const id = newId();
  const now = nowIso();
  await insertStmt(db, 'companies', {
    id,
    name: f.name.trim(),
    website: f.website ?? null,
    linkedin: f.linkedin ?? null,
    hq: f.hq ?? null,
    size: f.size ?? null,
    industry: f.industry ?? null,
    funding: f.funding ?? null,
    created_at: now,
    updated_at: now,
  }).run();
  return (await loadCompany(db, id))!;
}

/** Changes a company and copies its name and details to every job at it. */
export async function updateCompany(db: D1Database, id: string, f: CompanyFields) {
  const set = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
  if (Object.keys(set).length) await updateStmt(db, 'companies', id, set).run();
  await copyToJobs(db, id);
  return loadCompany(db, id);
}

/** Every job at the company gets its current name and details. */
export async function copyToJobs(db: D1Database, companyId: string, appId?: string) {
  const c = await loadCompany(db, companyId);
  if (!c) return;
  await db
    .prepare(
      `UPDATE applications SET company = ?, company_website = ?, company_domain = ?,
        company_linkedin = ?, company_hq = ?, company_size = ?, company_industry = ?,
        company_funding = ? WHERE company_id = ?${appId ? ' AND id = ?' : ''}`,
    )
    .bind(
      c.name,
      c.website,
      domainOf(c.website),
      c.linkedin,
      c.hq,
      c.size,
      c.industry,
      c.funding,
      companyId,
      ...(appId ? [appId] : []),
    )
    .run();
}

/** Points a job at a company and gives it that company's name and details. */
export async function linkJob(db: D1Database, appId: string, companyId: string) {
  await db
    .prepare('UPDATE applications SET company_id = ? WHERE id = ?')
    .bind(companyId, appId)
    .run();
  await copyToJobs(db, companyId, appId);
  // People on the job not yet at a company are at this one.
  await db
    .prepare(
      'UPDATE people SET company_id = ? WHERE company_id IS NULL AND id IN (SELECT person_id FROM job_people WHERE application_id = ?)',
    )
    .bind(companyId, appId)
    .run();
}

/** The company details an application create or update carries, as company fields. */
export function companyFieldsOf(input: Record<string, unknown>): CompanyFields {
  const pick = (k: string) => (k in input ? (input[k] as string | null) : undefined);
  const domain = pick('company_domain');
  return {
    website:
      pick('company_website') ??
      (domain ? `https://${domain.replace(/^https?:\/\//, '')}` : undefined),
    linkedin: pick('company_linkedin'),
    hq: pick('company_hq'),
    size: pick('company_size'),
    industry: pick('company_industry'),
    funding: pick('company_funding'),
  };
}

/**
 * After a job is created or updated with company fields (an assistant, or older clients): a new
 * company name links it to that company (found by name, or made); details it carries go onto its
 * company (on a new job, only where the company has none yet), and every job at it gets them.
 */
export async function settleCompany(
  db: D1Database,
  appId: string,
  input: Record<string, unknown>,
  isNew: boolean,
) {
  const app = await first<{ company: string; company_id: string | null }>(
    db,
    'SELECT company, company_id FROM applications WHERE id = ?',
    appId,
  );
  if (!app) return;
  let companyId = app.company_id;
  const fields = companyFieldsOf(input);
  if (typeof input.company === 'string' || !companyId) {
    const name = typeof input.company === 'string' ? input.company : app.company;
    const found = await findCompanyByName(db, name);
    const alone =
      companyId &&
      (await first<{ n: number }>(
        db,
        'SELECT COUNT(*) AS n FROM applications WHERE company_id = ?',
        companyId,
      ))!.n === 1;
    if (found) companyId = found.id;
    // A new name for a company only this job is at: a correction, so the company is renamed
    // (keeping its details and logo) rather than replaced by a blank one.
    else if (companyId && alone) await updateCompany(db, companyId, { name: name.trim() });
    else companyId = (await createCompany(db, { name, ...stripUndefined(fields) })).id;
    await db
      .prepare('UPDATE applications SET company_id = ? WHERE id = ?')
      .bind(companyId, appId)
      .run();
  }
  const set = stripUndefined(fields);
  if (Object.keys(set).length) {
    if (isNew) {
      // A new job fills in only what its company doesn't know yet.
      const c = (await loadCompany(db, companyId))!;
      for (const k of Object.keys(set) as (keyof CompanyFields)[])
        if (c[k] != null && c[k] !== '') delete set[k];
    }
    await updateCompany(db, companyId, set);
  } else await copyToJobs(db, companyId);
}

function stripUndefined(f: CompanyFields): CompanyFields {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as CompanyFields;
}
