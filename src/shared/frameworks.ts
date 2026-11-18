// Story frameworks: each is just named sections. A story picks one; switching keeps any section
// whose key the new framework also has (Action stays Action from STAR to CAR). Built-ins live
// in code (so improving one reaches every copy on update); people add their own as Custom
// frameworks, stored in the frameworks table.

export interface FrameworkSection {
  /** Stable key, shared across frameworks where the meaning is the same. */
  key: string;
  label: string;
  /** A nudge shown under the part's label. */
  prompt: string;
}

export interface FrameworkDef {
  key: string;
  name: string;
  group: 'Opener' | 'Behavioral' | 'Technical' | 'Custom';
  /** One line on when to use it. */
  blurb: string;
  sections: FrameworkSection[];
}

const s = (key: string, label: string, prompt: string): FrameworkSection => ({
  key,
  label,
  prompt,
});

export const BUILTIN_FRAMEWORKS: FrameworkDef[] = [
  {
    key: 'intro',
    name: 'Introduction',
    group: 'Opener',
    blurb: 'Tell me about yourself, in about 90 seconds.',
    sections: [
      s('present', 'Present', 'What you do now, in one or two sentences.'),
      s('past', 'Past', 'How you got here: the two or three moves that matter.'),
      s('future', 'Future', 'What you want next, and why this role fits it.'),
    ],
  },
  {
    key: 'why_job',
    name: 'Why this job',
    group: 'Opener',
    blurb: 'Why us, why this role, why now.',
    sections: [
      s('company', 'The company', 'What about this company specifically.'),
      s('role', 'The role', 'What about this role specifically.'),
      s('now', 'Why now', 'Why this is the right moment.'),
      s('fit', 'Why I fit', 'The one thing you bring that they need.'),
    ],
  },
  {
    key: 'why_looking',
    name: 'Why I’m looking',
    group: 'Opener',
    blurb: 'Why are you leaving, without complaining.',
    sections: [
      s('context', 'Context', 'Where you are and what has gone well there.'),
      s('missing', 'What’s missing', 'What you can’t get there, said plainly and kindly.'),
      s('next', 'What I want next', 'What you are moving toward.'),
    ],
  },
  {
    key: 'star',
    name: 'STAR',
    group: 'Behavioral',
    blurb: 'Tell me about a time…',
    sections: [
      s('situation', 'Situation', 'Where, when, and what was going on.'),
      s('task', 'Task', 'What you were responsible for.'),
      s('action', 'Action', 'What you did, in your own words, step by step.'),
      s('result', 'Result', 'What changed, with a number if you have one.'),
    ],
  },
  {
    key: 'car',
    name: 'CAR',
    group: 'Behavioral',
    blurb: 'A shorter STAR for quick follow-ups.',
    sections: [
      s('challenge', 'Challenge', 'The problem in one sentence.'),
      s('action', 'Action', 'What you did.'),
      s('result', 'Result', 'What changed.'),
    ],
  },
  {
    key: 'soar',
    name: 'SOAR',
    group: 'Behavioral',
    blurb: 'When the obstacle is the story.',
    sections: [
      s('situation', 'Situation', 'Where, when, and what was going on.'),
      s('obstacle', 'Obstacle', 'What stood in the way.'),
      s('action', 'Action', 'How you got past it.'),
      s('result', 'Result', 'What changed.'),
    ],
  },
  {
    key: 'failure',
    name: 'Failure',
    group: 'Behavioral',
    blurb: 'A mistake, owned, and what it taught you.',
    sections: [
      s('what_happened', 'What happened', 'The facts, briefly.'),
      s('my_part', 'My part', 'What you got wrong. Own it.'),
      s('lesson', 'Lesson', 'What you learned.'),
      s('what_now', 'What I do now', 'The habit you changed because of it.'),
    ],
  },
  {
    key: 'weakness',
    name: 'Weakness',
    group: 'Behavioral',
    blurb: 'A real one, with what you are doing about it.',
    sections: [
      s('weakness', 'Weakness', 'A real one, not a humblebrag.'),
      s('example', 'Example', 'When it showed up.'),
      s('doing', 'What I’m doing about it', 'The concrete practice that is working.'),
    ],
  },
  {
    key: 'design',
    name: 'Design decision',
    group: 'Technical',
    blurb: 'Walk me through an architecture call.',
    sections: [
      s('context', 'Context', 'The system, the constraint, the stakes.'),
      s('options', 'Options', 'What you considered.'),
      s('decision', 'Decision', 'What you chose and why.'),
      s('tradeoffs', 'Trade-offs', 'What it cost, and what you would revisit.'),
    ],
  },
];

export const BUILTIN_KEYS = BUILTIN_FRAMEWORKS.map((f) => f.key);

/** The letter badge shown next to a section in call mode ("S", "T", "A", "R"). */
export const sectionLetter = (label: string) =>
  (label.replace(/^(the|why|what|my)\s+/i, '').trim()[0] ?? '?').toUpperCase();
