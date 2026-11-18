// Story frameworks: each is just named sections. A story picks one; switching keeps any section
// whose key the new framework also has (Action stays Action from STAR to CAR). Built-ins live
// in code (so improving one reaches every copy on update); people add their own as Custom
// frameworks, stored in the frameworks table.

export interface FrameworkSection {
  /** Stable key, shared across frameworks where the meaning is the same. */
  key: string;
  label: string;
  /** A nudge shown as the field's placeholder. */
  prompt: string;
}

export interface FrameworkDef {
  key: string;
  name: string;
  group: 'Opener' | 'Behavioral' | 'Technical' | 'Custom';
  /** One line on when to use it. */
  blurb: string;
  sections: FrameworkSection[];
  /** Questions this kind of story usually answers. Stories start with these as suggestions. */
  questions: string[];
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
    questions: ['Tell me about yourself.', 'Walk me through your resume.', 'What do you do today?'],
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
    questions: ['Why do you want to work here?', 'Why this role?', 'What do you know about us?'],
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
    questions: ['Why are you leaving your current role?', 'What are you looking for next?'],
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
    questions: ['Tell me about a time you…', 'Give me an example of…'],
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
    questions: ['Can you give me another example?', 'Quick example of…?'],
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
    questions: ['What is the hardest problem you have solved?', 'Biggest obstacle on a project?'],
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
    questions: [
      'Tell me about a mistake you made.',
      'Tell me about a project that did not go well.',
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
    questions: ['What is your biggest weakness?', 'What feedback do you get most often?'],
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
    questions: [
      'Walk me through an architecture decision you made.',
      'Build vs. buy: how do you decide?',
      'Tell me about a complex system you designed.',
    ],
  },
];

export const BUILTIN_KEYS = BUILTIN_FRAMEWORKS.map((f) => f.key);

/**
 * Fields a story has besides its framework's sections. A story shows only its framework's parts
 * plus the extras that fit its kind: openers (Introduction, Why this job, Why I'm looking) are
 * just their parts; behavioral, technical and custom stories also get a hook, competencies and
 * the questions they answer. A field that already holds something still shows, so nothing
 * stored is hidden.
 */
export type StoryExtra = 'hook' | 'competencies' | 'questions';
const EXTRAS: Record<FrameworkDef['group'], StoryExtra[]> = {
  Opener: [],
  Behavioral: ['hook', 'competencies', 'questions'],
  Technical: ['hook', 'competencies', 'questions'],
  Custom: ['hook', 'competencies', 'questions'],
};
export const storyExtras = (group: string | undefined): StoryExtra[] =>
  EXTRAS[(group ?? 'Custom') as FrameworkDef['group']] ?? EXTRAS.Custom;

/** The letter badge shown next to a section in call mode ("S", "T", "A", "R"). */
export const sectionLetter = (label: string) =>
  (label.replace(/^(the|why|what|my)\s+/i, '').trim()[0] ?? '?').toUpperCase();
