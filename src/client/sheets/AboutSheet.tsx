import { ABOUT_ICONS, aboutLinks, BUILT_BY, type AboutLinkKind } from '../kit/about';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/ui';
import { Joke, Wordmark } from '../components/Brand';
import { useSheets } from './context';

const LINKS = aboutLinks({
  title: 'Knock Knock',
  repo: 'tyler-class/knockknock',
  email: 'knockknock@tylerclass.net',
  coffee: 'Knock Knock is free. Buy me a coffee ☕',
});
/** An About link's icon: the kit's shared set, identical in every app. */
function LinkIcon({ kind, className }: { kind: AboutLinkKind; className?: string }) {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ABOUT_ICONS[kind] }}
    />
  );
}

/** About Knock Knock: version, what it is, who built it, and links (Selfhost Kit layout). */
export function AboutSheet() {
  const sheets = useSheets();
  return (
    <Sheet
      title="About Knock Knock"
      icon="info"
      sub={`Version ${__APP_VERSION__}`}
      onClose={sheets.close}
    >
      <div className="about-mark">
        <Wordmark pop />
      </div>
      <p style={{ marginTop: 0 }}>
        Knock Knock is a free, open-source job search tracker: every application as a timeline, a a
        story bank for interviews, and an MCP server so your AI assistant keeps it all up to date.
        It runs on your own Cloudflare account, so your search stays yours.
      </p>
      <Joke />
      <p className="sub">{BUILT_BY}</p>
      <div style={{ marginTop: 8 }}>
        {LINKS.map((l) => (
          <a
            key={l.href}
            className="link-row"
            href={l.href}
            {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            <LinkIcon kind={l.kind} />
            <span>{l.label}</span>
            <Icon name="chevRight" size={16} />
          </a>
        ))}
      </div>
    </Sheet>
  );
}
