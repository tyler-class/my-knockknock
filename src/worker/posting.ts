// Reading a job posting for an assistant (the read_posting tool), as complete and exact as it
// can be, in this order:
//   1. The job board's own public data: Greenhouse, Lever, Ashby, SmartRecruiters and Workday
//      publish each posting as JSON. Exact, fast, free.
//   2. The page's own job data: most posting pages carry a schema.org JobPosting (for Google
//      Jobs) with the title, pay range, location, type and the full description.
//   3. The page as a browser sees it: Browser Run (the BROWSER binding) loads it, runs its
//      JavaScript and returns it as Markdown. For pages that are an empty shell until scripts run.
// The assistant does the reading: this only fetches, cleans and labels what it found.

/** What was found, for the assistant to read and turn into an application's fields. */
export interface Posting {
  /** Where the text came from. */
  source:
    'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters' | 'workday' | 'page-data' | 'browser';
  url: string;
  title?: string;
  company?: string;
  location?: string;
  work_mode?: string;
  employment_type?: string;
  department?: string;
  pay?: string;
  posted_on?: string;
  /** The posting's text (Markdown or plain), trimmed to a size an assistant can take in. */
  description: string;
}

const MAX_TEXT = 40_000;
const UA = 'Mozilla/5.0 (compatible; KnockKnock/1.0; +https://github.com/tyler-class/knockknock)';

/** The one Browser Run call used here (the Worker's BROWSER binding has this, and more). */
interface Browser {
  quickAction(
    action: 'markdown',
    options: {
      url: string;
      gotoOptions?: {
        waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
        timeout?: number;
      };
      rejectResourceTypes?: ('image' | 'media' | 'font')[];
    },
  ): Promise<Response>;
}
type Env = { BROWSER?: Browser };

export async function readPosting(env: Env, raw: string): Promise<Posting> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That isn’t a link to a posting.');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https links can be read.');

  const fromBoard = await fromJobBoard(url).catch(() => null);
  if (fromBoard && fromBoard.description.length > 200) return fromBoard;

  const html = await fetchText(url.toString()).catch(() => null);
  const fromPage = html ? fromPageData(html, url.toString()) : null;
  if (fromPage && fromPage.description.length > 300) return fromPage;

  const rendered = await fromBrowser(env, url.toString()).catch((e: Error) => e);
  if (typeof rendered === 'string' && rendered.trim())
    return {
      ...(fromPage ?? {}),
      source: 'browser',
      url: url.toString(),
      description: cap(rendered),
    };

  if (fromBoard) return fromBoard;
  if (fromPage) return fromPage;
  const why = rendered instanceof Error ? ` (${rendered.message})` : '';
  throw new Error(
    `Couldn’t read that page${why}. It may need a sign-in or block automated readers: ask the owner to paste the posting’s text.`,
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Job boards' own data

async function fromJobBoard(url: URL): Promise<Posting | null> {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  // Greenhouse: boards.greenhouse.io/<board>/jobs/<id>, job-boards.greenhouse.io/<board>/jobs/<id>,
  // or any careers page with ?gh_jid=<id> (the board is then unknown: try the embed route).
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const at = parts.indexOf('jobs');
    const board = parts[0];
    const id = at > 0 ? parts[at + 1] : url.searchParams.get('gh_jid');
    if (board && id) return greenhouse(board, id, url);
  }
  // Lever: jobs.lever.co/<company>/<id>
  if (host === 'jobs.lever.co' && parts[0] && parts[1]) return lever(parts[0], parts[1], url);
  // Ashby: jobs.ashbyhq.com/<org>/<id>
  if (host === 'jobs.ashbyhq.com' && parts[0] && parts[1]) return ashby(parts[0], parts[1], url);
  // SmartRecruiters: jobs.smartrecruiters.com/<company>/<id>-<slug>
  if (host === 'jobs.smartrecruiters.com' && parts[0] && parts[1]) {
    const id = parts[1].split('-')[0];
    if (id) return smartRecruiters(parts[0], id, url);
  }
  // Workday: <tenant>.wd<N>.myworkdayjobs.com/[<locale>/]<site>/job/<location>/<slug>
  const wd = /^([^.]+)\.wd\d+\.myworkdayjobs\.com$/.exec(host);
  if (wd) {
    const j = parts.indexOf('job');
    const site = j > 0 ? parts[j - 1] : undefined;
    if (site && j >= 0) return workday(url, wd[1]!, site, parts.slice(j + 1).join('/'));
  }
  return null;
}

async function greenhouse(board: string, id: string, url: URL): Promise<Posting> {
  const j = await fetchJson<{
    title?: string;
    location?: { name?: string };
    content?: string;
    updated_at?: string;
    departments?: { name?: string }[];
    company_name?: string;
    pay_input_ranges?: { min_cents?: number; max_cents?: number; currency_type?: string }[];
  }>(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}?pay_transparency=true`);
  const pay = j.pay_input_ranges?.[0];
  return {
    source: 'greenhouse',
    url: url.toString(),
    title: j.title,
    company: j.company_name,
    location: j.location?.name,
    department:
      j.departments
        ?.map((d) => d.name)
        .filter(Boolean)
        .join(', ') || undefined,
    pay: pay
      ? `${money(pay.min_cents, pay.currency_type)}–${money(pay.max_cents, pay.currency_type)}`
      : undefined,
    description: cap(htmlToText(decodeEntities(j.content ?? ''))),
  };
}

async function lever(company: string, id: string, url: URL): Promise<Posting> {
  const j = await fetchJson<{
    text?: string;
    descriptionPlain?: string;
    additionalPlain?: string;
    lists?: { text?: string; content?: string }[];
    categories?: { location?: string; team?: string; commitment?: string; department?: string };
    workplaceType?: string;
    salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
    createdAt?: number;
  }>(`https://api.lever.co/v0/postings/${company}/${id}`);
  const lists = (j.lists ?? [])
    .map((l) => `${l.text ?? ''}\n${htmlToText(l.content ?? '')}`)
    .join('\n\n');
  const s = j.salaryRange;
  return {
    source: 'lever',
    url: url.toString(),
    title: j.text,
    location: j.categories?.location,
    work_mode: j.workplaceType,
    employment_type: j.categories?.commitment,
    department: j.categories?.team ?? j.categories?.department,
    pay: s
      ? `${s.currency ?? ''} ${s.min ?? ''}–${s.max ?? ''} ${s.interval ?? ''}`.trim()
      : undefined,
    posted_on: j.createdAt ? new Date(j.createdAt).toISOString().slice(0, 10) : undefined,
    description: cap([j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n\n')),
  };
}

async function ashby(org: string, id: string, url: URL): Promise<Posting> {
  const j = await fetchJson<{
    jobs?: {
      id: string;
      title?: string;
      location?: string;
      department?: string;
      employmentType?: string;
      workplaceType?: string;
      isRemote?: boolean;
      descriptionPlain?: string;
      publishedAt?: string;
      compensation?: {
        compensationTierSummary?: string;
        scrapeableCompensationSalarySummary?: string;
      };
    }[];
  }>(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`);
  const job = j.jobs?.find((x) => x.id === id);
  if (!job) throw new Error('not on the board');
  return {
    source: 'ashby',
    url: url.toString(),
    title: job.title,
    location: job.location,
    work_mode: job.workplaceType ?? (job.isRemote ? 'Remote' : undefined),
    employment_type: job.employmentType,
    department: job.department,
    pay:
      job.compensation?.scrapeableCompensationSalarySummary ??
      job.compensation?.compensationTierSummary,
    posted_on: job.publishedAt?.slice(0, 10),
    description: cap(job.descriptionPlain ?? ''),
  };
}

async function smartRecruiters(company: string, id: string, url: URL): Promise<Posting> {
  const j = await fetchJson<{
    name?: string;
    company?: { name?: string };
    location?: { city?: string; region?: string; country?: string; remote?: boolean };
    typeOfEmployment?: { label?: string };
    department?: { label?: string };
    releasedDate?: string;
    jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
  }>(`https://api.smartrecruiters.com/v1/companies/${company}/postings/${id}`);
  const sections = Object.values(j.jobAd?.sections ?? {})
    .map((x) => `${x.title ?? ''}\n${htmlToText(x.text ?? '')}`)
    .join('\n\n');
  const l = j.location;
  return {
    source: 'smartrecruiters',
    url: url.toString(),
    title: j.name,
    company: j.company?.name,
    location: [l?.city, l?.region, l?.country].filter(Boolean).join(', ') || undefined,
    work_mode: l?.remote ? 'Remote' : undefined,
    employment_type: j.typeOfEmployment?.label,
    department: j.department?.label,
    posted_on: j.releasedDate?.slice(0, 10),
    description: cap(sections),
  };
}

async function workday(url: URL, tenant: string, site: string, path: string): Promise<Posting> {
  const j = await fetchJson<{
    jobPostingInfo?: {
      title?: string;
      location?: string;
      timeType?: string;
      startDate?: string;
      jobDescription?: string;
      remoteType?: string;
    };
    hiringOrganization?: { name?: string };
  }>(`${url.origin}/wday/cxs/${tenant}/${site}/job/${path}`);
  const p = j.jobPostingInfo;
  if (!p) throw new Error('no posting');
  return {
    source: 'workday',
    url: url.toString(),
    title: p.title,
    company: j.hiringOrganization?.name,
    location: p.location,
    work_mode: p.remoteType,
    employment_type: p.timeType,
    posted_on: p.startDate,
    description: cap(htmlToText(p.jobDescription ?? '')),
  };
}

// ---------------------------------------------------------------------------------------------
// 2. The page's own job data (schema.org JobPosting)

export function fromPageData(html: string, url: string): Posting | null {
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const job = findJobPosting(data);
    if (!job) continue;
    const loc = asArray(job.jobLocation)
      .map((l) => {
        const a = (l as { address?: Record<string, string> })?.address ?? {};
        return [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
      })
      .filter(Boolean)
      .join(' · ');
    const salary = job.baseSalary as
      | {
          currency?: string;
          value?: { minValue?: number; maxValue?: number; value?: number; unitText?: string };
        }
      | undefined;
    const v = salary?.value;
    const pay = v
      ? `${salary?.currency ?? ''} ${v.minValue ?? v.value ?? ''}${v.maxValue ? `–${v.maxValue}` : ''} ${v.unitText ?? ''}`.trim()
      : undefined;
    return {
      source: 'page-data',
      url,
      title: str(job.title),
      company: str((job.hiringOrganization as { name?: string })?.name),
      location: loc || undefined,
      work_mode: str(job.jobLocationType) === 'TELECOMMUTE' ? 'Remote' : undefined,
      employment_type: asArray(job.employmentType).map(String).join(', ') || undefined,
      pay,
      posted_on: str(job.datePosted)?.slice(0, 10),
      description: cap(htmlToText(decodeEntities(str(job.description) ?? ''))),
    };
  }
  return null;
}

function findJobPosting(d: unknown): Record<string, unknown> | null {
  if (Array.isArray(d)) {
    for (const x of d) {
      const f = findJobPosting(x);
      if (f) return f;
    }
    return null;
  }
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    const t = o['@type'];
    if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return o;
    if (o['@graph']) return findJobPosting(o['@graph']);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// 3. The page as a browser sees it

async function fromBrowser(env: Env, url: string): Promise<string> {
  if (!env.BROWSER) throw new Error('no browser available here');
  const res = await env.BROWSER.quickAction('markdown', {
    url,
    gotoOptions: { waitUntil: 'networkidle2', timeout: 30_000 },
    rejectResourceTypes: ['image', 'media', 'font'],
  });
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    result?: string;
    errors?: { message?: string }[];
  } | null;
  if (res.status === 429) throw new Error('the daily browser allowance is used up');
  if (!res.ok || !body?.success || typeof body.result !== 'string')
    throw new Error(body?.errors?.[0]?.message ?? `browser error ${res.status}`);
  return body.result;
}

// ---------------------------------------------------------------------------------------------
// Helpers

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.text()).slice(0, 3_000_000);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** HTML to readable text: block elements become line breaks, list items bullets, tags go. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<\/(p|div|ul|ol|section|tr)>/gi, '\n')
      .replace(/<h[1-6][^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    bull: '•',
  };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10),
      );
    return named[e.toLowerCase()] ?? m;
  });
}

const cap = (s: string) =>
  s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n\n[…the rest was cut for length]` : s;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const money = (cents?: number, cur?: string) =>
  cents == null ? '' : `${cur ?? ''} ${Math.round(cents / 100).toLocaleString('en-US')}`.trim();
