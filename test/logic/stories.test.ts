import { describe, expect, it } from 'vitest';
import { BUILTIN_FRAMEWORKS, sectionLetter } from '@shared/frameworks';
import { contentHash, searchStories, switchFramework, syncState } from '@shared/logic/stories';
import type { JobStory, Story } from '@shared/types';

const star = BUILTIN_FRAMEWORKS.find((f) => f.key === 'star')!;
const car = BUILTIN_FRAMEWORKS.find((f) => f.key === 'car')!;

function story(o: Partial<Story> = {}): Story {
  return {
    id: 's1',
    framework_key: 'star',
    title: 'Pushing back on a VP’s deadline',
    hook: 'Traded scope for date.',
    tags: ['conflict', 'influence'],
    sections: {
      situation: 'A VP promised the board a date.',
      action: 'Showed two plans.',
      result: 'Shipped on time.',
    },
    questions: [
      'Tell me about a time you disagreed with a leader.',
      'How do you say no to an executive?',
    ],
    notes: null,
    version: 2,
    archived: false,
    created_at: '',
    updated_at: '',
    ...o,
  };
}
const copyOf = (s: Story, o: Partial<JobStory> = {}): JobStory => ({
  id: 'j1',
  application_id: 'a1',
  story_id: s.id,
  source_version: s.version,
  framework_key: s.framework_key,
  section_defs: star.sections,
  title: s.title,
  hook: s.hook,
  tags: s.tags,
  sections: s.sections,
  questions: s.questions,
  notes: s.notes,
  angle: null,
  base_hash: contentHash(s),
  position: 0,
  created_at: '',
  updated_at: '',
  ...o,
});

describe('job copies', () => {
  it('in sync, edited, bank newer, both, job-only, source gone', () => {
    const s = story();
    const c = copyOf(s);
    expect(syncState(c, s)).toBe('in_sync');
    // The angle is job-only: never an edit.
    expect(syncState({ ...c, angle: 'For Leah: lead with the number.' }, s)).toBe('in_sync');
    const edited = {
      ...c,
      sections: { ...c.sections, result: 'Shipped on time; asked for me again.' },
    };
    expect(syncState(edited, s)).toBe('edited');
    expect(syncState(c, { ...s, version: 3 })).toBe('bank_newer');
    expect(syncState(edited, { ...s, version: 3 })).toBe('both');
    expect(syncState({ ...c, story_id: null, source_version: null }, undefined)).toBe('job_only');
    expect(syncState(c, undefined)).toBe('source_gone');
  });

  it('the hash ignores empty sections and tag order', () => {
    const s = story();
    expect(
      contentHash({
        ...s,
        sections: { ...s.sections, task: '  ' },
        tags: ['influence', 'conflict'],
      }),
    ).toBe(contentHash(s));
    expect(contentHash({ ...s, title: 'Other' })).not.toBe(contentHash(s));
  });
});

describe('switching frameworks', () => {
  it('keeps sections the new framework has and moves the rest to notes', () => {
    const r = switchFramework(
      { situation: 'Ctx', task: 'Mine', action: 'Did', result: 'Won' },
      star.sections,
      car.sections,
      null,
    );
    expect(r.sections).toEqual({ action: 'Did', result: 'Won' });
    expect(r.notes).toBe('Situation: Ctx\n\nTask: Mine');
  });
});

describe('call-mode search', () => {
  const bank = [
    story(),
    story({
      id: 's2',
      title: 'Event bus for 14 integrations',
      tags: ['architecture'],
      hook: null,
      sections: { action: 'Platform events' },
      questions: ['Tell me about a complex system you designed.'],
    }),
    story({
      id: 's3',
      title: 'Quote-to-cash with Finance',
      tags: ['finance'],
      hook: null,
      sections: {},
      questions: ['Tell me about working with Finance.'],
    }),
  ];
  it('matches the question you heard against probable questions first', () => {
    const hits = searchStories(bank, 'tell me about a time you disagreed with your leader');
    expect(hits[0]!.item.id).toBe('s1');
    expect(hits[0]!.question).toBe('Tell me about a time you disagreed with a leader.');
    expect(searchStories(bank, 'complex systems')[0]!.item.id).toBe('s2');
    expect(searchStories(bank, 'finance').map((h) => h.item.id)).toEqual(['s3']);
  });
  it('an empty query lists everything; a tag filters', () => {
    expect(searchStories(bank, '')).toHaveLength(3);
    expect(searchStories(bank, '', 'architecture').map((h) => h.item.id)).toEqual(['s2']);
  });
  it('section letters', () => {
    expect(star.sections.map((s) => sectionLetter(s.label)).join('')).toBe('STAR');
    expect(sectionLetter('The company')).toBe('C');
    expect(sectionLetter('Why now')).toBe('N');
  });
});
