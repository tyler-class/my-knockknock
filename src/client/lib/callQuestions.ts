// A meeting's questions: marked in call notes with "Q:", kept in the meeting's list.
import type { CallQuestion, JobQuestion } from '@shared/types';

export const newQuestionId = () =>
  `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The questions marked in notes: lines starting "Q:" (also as a list item, "- Q: …"). */
export function questionsInNotes(notes: string): string[] {
  const out: string[] = [];
  for (const line of notes.split('\n')) {
    const m = /^\s*(?:[-*]\s+)?q:\s*(\S.*?)\s*$/i.exec(line);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

/**
 * The list with the questions marked in the notes taken in: new ones added at the end. One still
 * being typed (the notes save as you pause) replaces its unfinished version rather than adding
 * another: an unanswered question whose text the new one starts with.
 */
export function withNoteQuestions(list: CallQuestion[], notes: string): CallQuestion[] {
  const inNotes = questionsInNotes(notes);
  let next = list;
  for (const text of inNotes) {
    const t = text.toLowerCase();
    if (next.some((q) => q.text.trim().toLowerCase() === t)) continue;
    const partial = next.find(
      (q) => !q.asked && !q.answer?.trim() && t.startsWith(q.text.trim().toLowerCase()),
    );
    next = partial
      ? next.map((q) => (q === partial ? { ...q, text } : q))
      : [...next, { id: newQuestionId(), text, answer: null, asked: false, from_notes: true }];
  }
  // A question marked in the notes whose line is gone (its Q deleted) goes from the list too,
  // unless something was written for it.
  const kept = new Set(inNotes.map((t) => t.toLowerCase()));
  const pruned = next.filter(
    (q) => !q.from_notes || kept.has(q.text.trim().toLowerCase()) || q.asked || !!q.answer?.trim(),
  );
  return pruned.length === list.length && pruned.every((q, i) => q === list[i]) ? list : pruned;
}

/** Only questions with words in them are saved (one being retyped can be empty for a moment). */
export const savable = (list: CallQuestion[]): CallQuestion[] =>
  list.filter((q) => q.text.trim()).map((q) => ({ ...q, text: q.text.trim() }));

/**
 * A call's questions, in the meeting's own order: the job's questions not on it yet first, then
 * what the meeting keeps (its own questions and the job's, with what was said to them). A job
 * question taken off the job goes, unless something was said to it.
 */
export function callList(jobQs: JobQuestion[], meeting: CallQuestion[]): CallQuestion[] {
  const jobById = new Map(jobQs.map((j) => [j.id, j]));
  const kept = meeting
    .filter(
      (q) => !q.job_question_id || jobById.has(q.job_question_id) || q.asked || !!q.answer?.trim(),
    )
    .map((q) => {
      // The job's words, even if they changed since this call was saved.
      const jq = q.job_question_id ? jobById.get(q.job_question_id) : undefined;
      return jq && jq.text !== q.text ? { ...q, text: jq.text } : q;
    });
  const on = new Set(kept.map((q) => q.job_question_id).filter(Boolean));
  const missing = jobQs
    .filter((j) => !on.has(j.id))
    .map((j) => ({
      id: `jq-${j.id}`,
      text: j.text,
      answer: null,
      asked: false,
      job_question_id: j.id,
      question_id: j.question_id,
    }));
  return [...missing, ...kept];
}

/** What a meeting keeps of a call's list: all of it, in its order (blank ones left out). */
export const meetingKeeps = (list: CallQuestion[]): CallQuestion[] => savable(list);
