/**
 * The generic challenge engine (spec section 6).
 *
 * One evaluator handles every non-code question type. Code challenges are
 * dispatched to the local runner on the server; everything else resolves here,
 * deterministically and without I/O, so it can be unit-tested exhaustively.
 */

import type {
  ChallengeType,
  EvaluationData,
  EvaluationOutcome,
  SubmissionValue,
} from './types.js';

function normaliseText(value: string, data: EvaluationData): string {
  let out = value ?? '';
  if (data.ignoreWhitespace !== false) {
    out = out.replace(/\r\n/g, '\n').trim().replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n');
  }
  if (!data.caseSensitive) out = out.toLowerCase();
  return out;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Evaluate a submission against the (server-only) evaluation data.
 * Returns `correct: false` rather than throwing on malformed input - a garbled
 * client payload must never crash the round.
 */
export function evaluateAnswer(
  type: ChallengeType,
  data: EvaluationData,
  submission: SubmissionValue | null | undefined,
): EvaluationOutcome {
  if (!submission) return { correct: false, detail: 'No answer submitted' };

  switch (type) {
    case 'mcq': {
      if (submission.kind !== 'choice') return { correct: false, detail: 'Malformed answer' };
      const expected = data.correctOptionIds ?? [];
      const chosen = submission.optionIds.slice(0, 1);
      return {
        correct: chosen.length === 1 && expected.includes(chosen[0] as string),
        detail: chosen[0] ? `Selected ${chosen[0]}` : 'Nothing selected',
      };
    }

    case 'multi': {
      if (submission.kind !== 'choice') return { correct: false, detail: 'Malformed answer' };
      const expected = data.correctOptionIds ?? [];
      return {
        correct: sameSet(expected, submission.optionIds),
        detail: `Selected ${submission.optionIds.length} option(s)`,
      };
    }

    case 'true_false': {
      if (submission.kind !== 'boolean') return { correct: false, detail: 'Malformed answer' };
      return {
        correct: submission.value === data.correctBoolean,
        detail: submission.value ? 'Answered TRUE' : 'Answered FALSE',
      };
    }

    case 'output':
    case 'short_text': {
      if (submission.kind !== 'text') return { correct: false, detail: 'Malformed answer' };
      const given = normaliseText(submission.value, data);
      const accepted = (data.acceptedAnswers ?? []).map((a) => normaliseText(a, data));
      return {
        correct: accepted.some((a) => a === given),
        detail: submission.value ? `Answered "${truncate(submission.value)}"` : 'Blank answer',
      };
    }

    case 'numeric': {
      if (submission.kind !== 'number') return { correct: false, detail: 'Malformed answer' };
      const expected = data.correctNumber;
      if (typeof expected !== 'number') return { correct: false, detail: 'No expected value' };
      const tolerance = Math.abs(data.tolerance ?? 0);
      const value = submission.value;
      return {
        correct: Number.isFinite(value) && Math.abs(value - expected) <= tolerance,
        detail: `Answered ${value}`,
      };
    }

    case 'ordering': {
      if (submission.kind !== 'order') return { correct: false, detail: 'Malformed answer' };
      return {
        correct: sameOrder(data.correctOrder ?? [], submission.itemIds),
        detail: `Submitted order of ${submission.itemIds.length} items`,
      };
    }

    case 'matching': {
      if (submission.kind !== 'pairs') return { correct: false, detail: 'Malformed answer' };
      const expected = data.correctPairs ?? {};
      const keys = Object.keys(expected);
      const matched = keys.filter((k) => submission.pairs[k] === expected[k]).length;
      return {
        correct: matched === keys.length && Object.keys(submission.pairs).length === keys.length,
        detail: `${matched}/${keys.length} pairs matched`,
      };
    }

    case 'code':
      // Executed by the server-side runner; never resolved purely.
      return { correct: false, detail: 'Code challenges are evaluated by the runner' };

    default:
      return { correct: false, detail: 'Unsupported challenge type' };
  }
}

function truncate(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

/** Cheap client-side check: has the participant produced a submittable answer? */
export function isAnswerComplete(
  type: ChallengeType,
  submission: SubmissionValue | null,
  expectedCounts?: { items?: number; pairs?: number },
): boolean {
  if (!submission) return false;
  switch (type) {
    case 'mcq':
      return submission.kind === 'choice' && submission.optionIds.length === 1;
    case 'multi':
      return submission.kind === 'choice' && submission.optionIds.length > 0;
    case 'true_false':
      return submission.kind === 'boolean';
    case 'output':
    case 'short_text':
      return submission.kind === 'text' && submission.value.trim().length > 0;
    case 'numeric':
      return submission.kind === 'number' && Number.isFinite(submission.value);
    case 'ordering':
      return (
        submission.kind === 'order' &&
        submission.itemIds.length === (expectedCounts?.items ?? submission.itemIds.length)
      );
    case 'matching':
      return (
        submission.kind === 'pairs' &&
        Object.keys(submission.pairs).length === (expectedCounts?.pairs ?? -1)
      );
    case 'code':
      return submission.kind === 'code' && submission.source.trim().length > 0;
    default:
      return false;
  }
}

/** Compare program output to expected output for the code runner. */
export function outputMatches(actual: string, expected: string): boolean {
  const norm = (s: string) =>
    s
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''))
      .join('\n')
      .replace(/\n+$/, '');
  return norm(actual) === norm(expected);
}
