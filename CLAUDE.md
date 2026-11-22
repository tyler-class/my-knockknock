# Knock Knock

Conventions for working on Knock Knock, shared with the owner's other self-hosted Cloudflare apps.

Knock Knock has its **own visual language** (1.0, "Ultramarine"): a light grey page (`--bg`),
white rounded cards with soft shadows and no borders, one deep ultramarine accent (`--accent`),
Bricolage Grotesque headings over Manrope text, and the asterisk on a tilted ultramarine tile
beside the narrow all-caps Archivo wordmark. The 1.0 layer at the end of `styles.css` sets it.
Don't bring in styling from the sibling apps; match this app's look for anything new.

## Look

- Light mode only: no dark theme, no theme setting, no `prefers-color-scheme: dark` rules.
- Buttons are pills: the primary action solid ultramarine with white text; every other button
  white with a grey outline (never white on white with no edge), ghost buttons in ultramarine
  text. Nothing lifts on an extrusion: hovers shade softly.
- Cards: white, `--radius` corners, the soft `--sh` shadow, no border.
- Section and card headings are in Title Case ("Job Description", "Log to Timeline", "The
  Meeting"); buttons and body text stay in sentence case.
- Tabs (a job's Details, Timeline, Stories, Files; the Jobs list's stages): plain text, the open
  one bold with an ink underline; counts sit in small circles, the open tab's in ultramarine.
- The stage bar is a row of rounded segments with the stage name under each: done stages light
  ultramarine, the current one solid, the rest grey.
- Statuses show their icon (`STATUS_ICON`) in white on a small solid round badge (`StatusIcon`):
  ultramarine along the way, green for Offer, dark green for Accepted, red for Rejected, grey for
  Declined and Ghosted. No coloured dots, no pale badges on grey.
- Contrast: nothing low-contrast. Quiet text uses `--ink3` (readable on white and grey); small
  icon buttons are ink on a visible grey disc; letter badges (story parts, initials) are white on
  solid ultramarine; danger buttons are white with a red outline, filled red on hover (only the
  confirm popup's final Delete is solid red). No soft red on grey.
- Every sheet carries an icon left of its title (`Sheet icon=`) and no subtitle under it (About's
  version line is the one exception). Files use the paperclip
  everywhere.
- Pay shows as "$187.2–198.8K" (thousands and millions to one decimal); amounts being typed get
  thousands commas.
- Icons on cards, timelines and lists are grey or ink outlines, never filled with the accent.
  Page headings carry the page's icon in white on the tilted ultramarine tile (`.h-icon`).
- A job's header card: the title, then the company in bold with work mode and the applied date,
  Call Mode and Log to timeline at the right, and the stage bar. No status pill (the stage bar
  says it), and no floating "+" button anywhere.
- Each detail edits in place in exactly the spot, size, type and content it's shown in: nothing
  but the border changes when editing starts. A link is shown and edited in its short form
  ("example.com", no https://), opens only from the new-tab button beside its label, and a
  click on it edits it. Nested text in a value never picks up the label rules. A blank field
  shows an em dash (—), never "Add".
- Field labels are bold ink; values are regular weight, shown and editing alike.
- Filters open from a filter icon button into a drawer, offering only choices that exist.
- Many-valued choices (six meeting kinds) are a dropdown (`Select`), not a sliding toggle.

## Workflow

- Start with `git pull --ff-only`.
- Every round of changes gets a new version number, without being asked: when you start making
  changes after the last push to `main`, bump the patch version in `package.json` first
  (0.1.0 → 0.1.1), so each push ships under its own version. Bump minor or major only when the
  owner asks. Mention the new version when you report or push.
- The MCP server reports `package.json`'s version (`src/worker/mcp.ts` imports it; a test in
  `test/api/mcp.test.ts` checks they match). Don't hard-code it.
- Verify with typecheck, lint, tests and `curl`; don't open a browser unless the owner asks.
- Push to `main` only when the owner says so. Deploying (`npm run deploy`) is a separate step,
  also only when asked.
- Files headed "Selfhost Kit: synced from tyler-class/selfhost-kit" (`src/*/kit/*`,
  `scripts/release.ts`, `.github/workflows/update.yml`) are overwritten by the kit's sync: make
  those changes in the kit, not here.

## Behaviour

- Home (`/`) is the default page: counts for the chosen search, what's coming up, and recent
  activity. The search menu at the top of the sidebar (top bar on phones) picks the search;
  everything but the Story Bank follows it. The pick is remembered on the device
  (`lib/currentSearch.ts`) and also saved as the server's `current_search_id`, which is what new
  applications and assistants use.
- Every detail of an application (title, company, pay, links, dates, company facts,
  requirements (Required / Preferred), notes, the job posting) is edited in place on its page: each field, or small
  group that edits together (pay), sits in an edit container with its pencil right-aligned. Tap
  it to edit; fields and groups (pay) save on Enter, Tab or clicking away, with no Save or Cancel
  buttons, and Escape cancels. A field keeps its size, font and place while being edited. There's no edit sheet for an existing job (the sheet only adds a new one);
  deleting sits at the bottom of the page. Tapping a stage on the stepper opens the status sheet
  for that stage.
- The Job card holds everything about the role: its fields, Required and Preferred, and the
  pasted job posting at the end (clamped, with Show full posting). Notes sits under it in the
  left column; Company and People on the right.
- The timeline is one plain list with no filter. Every entry's icon sits in a grey disc in a white
  circle, all in the same grey and line weight; status changes use the bar-built arrow
  (`StatusArrow`), the job being added the asterisk, files the paperclip. The rail starts at the
  asterisk (the oldest entry) and nothing runs below it. A file entry's open button sits right
  after its name, and its sheet is one group: the file, kind, date added and a comment.
- Timeline entries work the same way: tapping a meeting, email, note or file card opens it in a
  sheet (a drawer on phones, a panel on wider screens) where every value edits in place, with
  no Edit button or separate form. Each kind has its own fields, grouped into cards like a job's
  Details (`sheets/EventView.tsx`; the in-place pieces are in `components/edit.tsx`). Status
  changes and the job being added are the app's own record: their cards don't open. The log
  sheet (`EventSheet`) is only for logging something new.
- On the timeline, a note sits under the meeting or email it's about; a note attached to nothing
  that was written during a meeting (15 minutes before it starts to 30 after it ends) shows under
  that meeting too (`timelineView`). Notes under an event show four lines with Show more.
- Deleting a job, a timeline entry or a file asks first in a small popup ("Are you sure you want
  to delete …?", Cancel and Delete). Jobs and entries use a boxed red button at the lower right of the page or
  panel (`ConfirmButton solid`); a file keeps its small trash button (`ConfirmDialog`).
- Files are just there or not (no locking). Adding one writes a "File added" note on the
  timeline (`data.file_id`), dated when it was uploaded and editable like any note; deleting the
  file removes it.
- A story is its framework, its title and its parts (plus notes, shown only when there are
  some). There's no hook, competencies or probable questions: anything you'd search for is in
  the parts, so Stories, Call Mode, linking and `list_stories` search the title, the framework's
  name and the parts' text (`searchStories` in `src/shared/logic/stories.ts`). The `hook`,
  `tags` and `questions` columns (and frameworks' `questions`) stay in D1 and in exports, unused,
  rather than dropping them with a migration; they also stay in the copy hash so existing job
  copies keep their sync state. The UI and MCP tools don't show or take them.
- A new story's sheet is titled "New Story" whatever the framework; Cancel goes back to the
  framework picker.
- Report numbers come from `src/shared/logic/report.ts`. "Heard back" means the application
  moved past Applied (Screening or later) or was rejected; time to hear back is from applying to
  the first such status change (shown from 2 replies). Say "3 of 10 heard back", never "n=".
- A sheet and its backdrop open and close together (nothing pops in or out partway), and
  `prefers-reduced-motion` turns motion off.
- If drag to reorder is added: start it after a short press on touch so a swipe still scrolls,
  support the keyboard, show the new order straight away and put the old one back if saving fails,
  and don't animate the dropped item back to where it started.
- Removing or changing something that can be undone (deleting an event, story or application,
  changing a status) shows a toast with **Undo** (the toast already supports an action). Keep the
  two-tap confirm only where undo isn't possible. Status changes undo by deleting the status
  events they wrote (status is derived from the timeline), and archiving a story undoes by
  unarchiving. Deleting an application, event, story or search is still a hard delete (it
  cascades to timelines, notes, copies and files; a job's people stay at its company), so those ask first until the API can restore
  them: jobs and timeline entries in the popup above, stories and searches with the two-tap
  confirm.
- A filter shows the same choices and counts everywhere the same data appears: count in
  `src/client/lib/filters.ts`, not inline.
- Companies are their own records (`companies`; `src/worker/companies.ts`): several jobs can be
  at one company. A job points at it (`company_id`) and keeps a copy of its name and details in
  its `company_*` columns, kept in step on every change, so lists, search and assistants that read
  the job still see them. A company name or detail written to a job (the job page, an assistant)
  goes to its company: a name links the job to the company of that name (ignoring case) or makes
  one, except that a job alone at its company renames it. Website replaces Domain in the UI (the
  domain is derived from it). A logo is optional and shows on Jobs cards and rows.
  Companies have their own list (`/companies`, in the sidebar) and page (`/c/:id`), where their
  details and logo are edited. A job's Company card is a lookup: pick or type the company, see a
  summary (facts, website, LinkedIn, other jobs there), and Open company to change it.
- People work at a company (`people.company_id`) and can be on several of its jobs
  (`job_people`). Adding someone to a job first offers the people already at its company; New
  person makes one there. A company's page lists its people and can add someone on no job yet.
  Remove from job takes them off that job only; deleting a job leaves its people at the company
  (only someone at no company goes with it).
- The Jobs board opens on a computer and the list on a phone (not remembered). Cards can be
  dragged within a lane into your own order (`board_position`, saved straight away and put back if
  saving fails); a card not yet placed sits at the top; moving to another lane clears its place.
  Under each job: grey pills for pay and "Last activity 3d ago", an ultramarine one only when
  there's something to act on.
- Search fields have a ✕ to clear them (`SearchClear`).
- Stories filters: frameworks are many-of (All clears the rest), and Group by None or Framework.
- The report's flow: something still in play stops at its stage (no "still at" branch).
- An application, event or story is changed the same way wherever it appears: one shared sheet
  (`useSheets()`), as now.
- After a save, everything on screen updates straight away; nothing needs a reload.
- View choices (Jobs view, stage and search; Stories filters) are remembered on the device, and
  put in the address when it makes sense to bookmark or share the view (`useViewState` in
  `src/client/lib/viewState.ts`; the address wins when present).
- A list or column with nothing in it is hidden or says clearly that it's empty.
- Phones: text wraps rather than running off the edge where the full text matters; notes fields
  grow with the text (`AutoTextarea` in `components/ui.tsx`). The pasted posting and pasted
  transcript fields stay fixed-height on purpose: they hold very long text.

## Wording

- Product nouns are capitalized; group headings are plural where they name a kind of thing.
- Ranges of times read "2:00 to 2:45 PM", not with a dash.
- Relative times are compact: "3h ago", "3d ago".

## Assistants (MCP)

- Archived or hidden things (archived stories, and archived searches if added) stay out of the
  normal tools. Give them a dedicated tool that finds them, says they're archived and how to bring
  one back if the owner asks (e.g. `update_story` with `archived: false`), and say so in the
  server's instructions. Archived stories have `list_archived_stories`.
- `find_applications` looks in the current search unless `all_searches` is true, and says how many
  more matches sit in past searches. The current search is the one last picked in the app.
- People with role `other` carry their own words in `other_role`, shown in place of "Other".

## Statuses and stories

- Statuses show an icon (`STATUS_ICON`, drawn with `StatusIcon` in `components/StatusChip.tsx`)
  in its tinted round badge (see Look): bookmark Saved, paper plane Applied, phone Screening,
  people Interviewing, gift Offer, check Accepted, X Rejected, minus Declined, ghost Ghosted.
- The stage bar (`components/StageBar.tsx`) is Saved → Applied → Screening → Interviewing → Offer →
  Closed. Closed covers Accepted, Rejected, Declined and Ghosted; picking it asks how it ended.
- Call Mode's notepad ("Call notes") saves itself (about a second after typing stops, and on
  blur or leaving) into one note on the job's timeline, on the meeting if there is one; the
  note is found again by its `external_ref` (`call-notes:<meeting id>`, or the application and
  day without a meeting), so reopening Call Mode loads it back. Text is never cleared, and
  unsaved text is kept on the device until it saves. **End call** opens "How did it go?": the
  reflections save as their own "How it went" note (dated now, on the meeting); Skip or close
  saves nothing more.
- No "told" concept: stories aren't marked as told or heard by anyone (no UI, API or MCP tool).
  The `story_tells` table stays in D1 and in exports, unused, rather than dropping it with a
  migration.
- A job keeps its own copy of a Story Bank story. Talk about it in plain words ("You changed this
  for PwC", "Your Story Bank story has changed since"), with at most the one or two actions that
  fit. No version numbers, "push", "pull" or "bank" jargon in the UI.
