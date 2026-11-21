# Knock Knock

Conventions for working on Knock Knock, shared with the owner's other self-hosted Cloudflare apps.

Knock Knock has its **own visual language** (black, white and hi-vis yellow; Archivo, Geist and
Geist Mono; hard 1.5px ink borders; stepped extrusion shadows; the glass tab bar). Don't bring in
styling from the sibling apps (soft pills, circle icon buttons, tinted icon circles, hover shades,
focus rings, grain): the rules below are about workflow, behaviour, wording and data only. Match
this app's existing look for anything new.

## Look

- Light mode only: no dark theme, no theme setting, no `prefers-color-scheme: dark` rules.
- No solid black buttons. Anything you can press is white (or yellow for the primary action)
  with the ink border, and lifts on a black extrusion when hovered. The selected or current
  state (active nav item, chosen segment or option, picked chip, current search) is `--sel`, a
  light tint of the yellow, with ink text and an ink border, so the black extrusion still reads.
- Exception: the job page's tabs (Details, Timeline, Stories, Files), also used for the Jobs
  list's stages (a toggle under the Board/List toggle was too much). Tabs don't lift, so the
  "no black buttons" rule (lifted buttons losing their shadow) doesn't apply: the open tab is a
  solid ink folder tab with white text and icon on the line under the row; the others are plain
  `--ink2` text with no box. The row scrolls sideways only on phones, with hard stops.
- The round yellow "+" (`.fab`, "Log to timeline") appears on job pages only: it opens the log
  sheet for that job. No other page (Call Mode included) has it.
- Yellow is a fill, never thin text, icon strokes or outlines on white: icons and text on light
  backgrounds are ink (or `--ink2` grey). A ghost button gets its ink outline back when it lifts.
- Sliding toggles (`SlideToggle`) don't lift on hover; the stage stepper doesn't either.
- Page headings carry the page's icon in a yellow squircle (`PageHeader` with `icon`; `.h-icon`),
  with no highlighter band behind the text.

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
  must-haves, notes, the job description) is edited in place on its page: each field, or small
  group that edits together (pay), sits in an edit container with its pencil right-aligned. Tap
  it to edit; single fields save on Enter or blur, groups and long text have Save and Cancel,
  and Escape cancels. There's no edit sheet for an existing job (the sheet only adds a new one);
  deleting sits at the bottom of the page. Tapping a stage on the stepper opens the status sheet
  for that stage.
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
- A new story's sheet is titled "New story" whatever the framework; Cancel goes back to the
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
  cascades to timelines, notes, copies and files), so those ask first until the API can restore
  them: jobs and timeline entries in the popup above, stories and searches with the two-tap
  confirm.
- A filter shows the same choices and counts everywhere the same data appears: count in
  `src/client/lib/filters.ts`, not inline.
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

- Statuses show an icon (`STATUS_ICON`, drawn with `StatusIcon` in `components/StatusChip.tsx`),
  filled inside: yellow for Saved, Applied, Screening and Interviewing (only the front person),
  green for Offer, blue for Accepted, red for Rejected, light grey for Ghosted, none for
  Declined. Every status chip is otherwise the same plain chip.
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
