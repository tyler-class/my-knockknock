// Search: the main section for the job search itself, holding Jobs, Companies, People and Files
// (its pages share one row of tabs). Each stretch of searching is a "round" in the interface.
import type { GlassTab } from '../components/GlassTabBar';

/** The parent section for the search itself: jobs and the companies, people and files around them. */
export const TRACKER = 'Search';
/** What's under Tracker, in order (each a page with the same row of tabs at its top). */
export const TRACKER_ITEMS: GlassTab[] = [
  ['/jobs', 'Jobs', 'briefcase'],
  ['/companies', 'Companies', 'building'],
  ['/people', 'People', 'user'],
  ['/files', 'Files', 'paperclip'],
];

/** The parent section for getting ready: stories to tell and questions to ask. */
export const PREPARE = 'Prepare';
export const PREPARE_ITEMS: GlassTab[] = [
  ['/stories', 'Stories', 'quote'],
  ['/questions', 'Questions', 'question'],
];

/** The Prepare page an address belongs to. */
export function preparePage(path: string): string | null {
  if (path.startsWith('/stories')) return '/stories';
  if (path.startsWith('/questions')) return '/questions';
  return null;
}

/** The Tracker page an address belongs to (a job's page is Jobs, a company's Companies). */
export function trackerPage(path: string): string | null {
  if (path.startsWith('/a/') || path.startsWith('/jobs') || path.startsWith('/pipeline'))
    return '/jobs';
  if (path.startsWith('/c/') || path.startsWith('/companies')) return '/companies';
  if (path.startsWith('/people')) return '/people';
  if (path.startsWith('/files')) return '/files';
  return null;
}
