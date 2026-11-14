// Example requests people can make of an assistant connected to Knock Knock. One list feeds the
// MCP server instructions, the get_started tool and the "Try asking" list in Settings.

export interface ExamplePrompt {
  /** What to say, written the way a person would ask. <angle brackets> mark what to fill in. */
  prompt: string;
  /** Why it's worth asking, in a few words. */
  why: string;
}

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    prompt: 'Add these jobs to Knock Knock: <link>, <link>, <link>.',
    why: 'Each posting parsed into a Saved application.',
  },
  {
    prompt: 'Check my email from the last day for anything about my applications and log it.',
    why: 'Confirmations, scheduling and rejections land on the right timelines.',
  },
  {
    prompt: 'I just applied to <company>. Mark it applied.',
    why: 'One sentence instead of a form.',
  },
  {
    prompt: 'Prep me for my <company> interview tomorrow.',
    why: 'Who’s in the room, what they heard, which stories to bring.',
  },
  {
    prompt:
      'Here’s the transcript from my <company> call. Write the debrief and log which stories I told.',
    why: 'A debrief note and a “told” mark on each story.',
  },
  {
    prompt: 'Which applications have gone quiet, and who should I follow up with?',
    why: 'A short list with drafts if you want them.',
  },
  {
    prompt: 'Write a STAR story about <project> and add it to my story bank.',
    why: 'Talk it through; it lands in the bank with probable questions.',
  },
  {
    prompt: 'How is my search going? Response rate, where things die, what’s working.',
    why: 'The report, read out with an opinion.',
  },
];

/** The ready-made MCP prompts, for listing alongside the examples. */
export const MCP_PROMPTS: { name: string; title: string; does: string }[] = [
  {
    name: 'add_jobs',
    title: 'Add jobs from links',
    does: 'Reads each posting and creates a Saved application, skipping ones you already have.',
  },
  {
    name: 'sync_inbox',
    title: 'Log what happened in my inbox',
    does: 'Reads recent email and calendar invites and writes them to the right timelines, without duplicates.',
  },
  {
    name: 'prep_interview',
    title: 'Prep me for an interview',
    does: 'Who’s in the room, what they already heard, and which stories to bring.',
  },
  {
    name: 'debrief',
    title: 'Debrief an interview',
    does: 'Turns your notes or a transcript into a debrief and records the stories you told.',
  },
  {
    name: 'weekly_review',
    title: 'Weekly search review',
    does: 'What moved, what went quiet, and one thing to change next week.',
  },
];
