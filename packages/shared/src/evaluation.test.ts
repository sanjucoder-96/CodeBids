import { describe, expect, it } from 'vitest';
import { evaluateAnswer, isAnswerComplete, outputMatches } from './evaluation.js';
import type { EvaluationData } from './types.js';

describe('mcq', () => {
  const data: EvaluationData = { correctOptionIds: ['b'] };

  it('accepts the correct option', () => {
    expect(evaluateAnswer('mcq', data, { kind: 'choice', optionIds: ['b'] }).correct).toBe(true);
  });

  it('rejects a wrong option', () => {
    expect(evaluateAnswer('mcq', data, { kind: 'choice', optionIds: ['a'] }).correct).toBe(false);
  });

  it('only considers the first selection', () => {
    expect(evaluateAnswer('mcq', data, { kind: 'choice', optionIds: ['a', 'b'] }).correct).toBe(false);
  });

  it('rejects an empty or missing submission', () => {
    expect(evaluateAnswer('mcq', data, { kind: 'choice', optionIds: [] }).correct).toBe(false);
    expect(evaluateAnswer('mcq', data, null).correct).toBe(false);
  });

  it('rejects a mismatched payload kind instead of throwing', () => {
    expect(evaluateAnswer('mcq', data, { kind: 'text', value: 'b' }).correct).toBe(false);
  });
});

describe('multiple select', () => {
  const data: EvaluationData = { correctOptionIds: ['a', 'c'] };

  it('accepts the exact set in any order', () => {
    expect(evaluateAnswer('multi', data, { kind: 'choice', optionIds: ['c', 'a'] }).correct).toBe(true);
  });

  it('rejects a subset and a superset', () => {
    expect(evaluateAnswer('multi', data, { kind: 'choice', optionIds: ['a'] }).correct).toBe(false);
    expect(evaluateAnswer('multi', data, { kind: 'choice', optionIds: ['a', 'b', 'c'] }).correct).toBe(false);
  });
});

describe('true/false', () => {
  it('compares strictly', () => {
    const data: EvaluationData = { correctBoolean: true };
    expect(evaluateAnswer('true_false', data, { kind: 'boolean', value: true }).correct).toBe(true);
    expect(evaluateAnswer('true_false', data, { kind: 'boolean', value: false }).correct).toBe(false);
  });
});

describe('output prediction / short text', () => {
  const data: EvaluationData = { acceptedAnswers: ['24', 'twenty four'] };

  it('accepts any listed answer', () => {
    expect(evaluateAnswer('output', data, { kind: 'text', value: '24' }).correct).toBe(true);
    expect(evaluateAnswer('output', data, { kind: 'text', value: 'twenty four' }).correct).toBe(true);
  });

  it('is case-insensitive and whitespace-tolerant by default', () => {
    expect(evaluateAnswer('output', data, { kind: 'text', value: '  TWENTY   FOUR ' }).correct).toBe(true);
  });

  it('respects caseSensitive when set', () => {
    const strict: EvaluationData = { acceptedAnswers: ['Hello'], caseSensitive: true };
    expect(evaluateAnswer('short_text', strict, { kind: 'text', value: 'hello' }).correct).toBe(false);
    expect(evaluateAnswer('short_text', strict, { kind: 'text', value: 'Hello' }).correct).toBe(true);
  });

  it('normalises multi-line output', () => {
    const multi: EvaluationData = { acceptedAnswers: ['1\n2\n3'] };
    expect(evaluateAnswer('output', multi, { kind: 'text', value: '1\r\n 2 \r\n3' }).correct).toBe(true);
  });

  it('rejects a blank answer', () => {
    expect(evaluateAnswer('output', data, { kind: 'text', value: '' }).correct).toBe(false);
  });
});

describe('numeric', () => {
  it('accepts an exact match with zero tolerance', () => {
    const data: EvaluationData = { correctNumber: 42 };
    expect(evaluateAnswer('numeric', data, { kind: 'number', value: 42 }).correct).toBe(true);
    expect(evaluateAnswer('numeric', data, { kind: 'number', value: 42.1 }).correct).toBe(false);
  });

  it('honours tolerance at the boundary', () => {
    const data: EvaluationData = { correctNumber: 3.14159, tolerance: 0.01 };
    expect(evaluateAnswer('numeric', data, { kind: 'number', value: 3.15 }).correct).toBe(true);
    expect(evaluateAnswer('numeric', data, { kind: 'number', value: 3.16 }).correct).toBe(false);
  });

  it('rejects NaN', () => {
    const data: EvaluationData = { correctNumber: 1 };
    expect(evaluateAnswer('numeric', data, { kind: 'number', value: Number.NaN }).correct).toBe(false);
  });
});

describe('ordering', () => {
  const data: EvaluationData = { correctOrder: ['a', 'b', 'c', 'd'] };

  it('requires the exact sequence', () => {
    expect(evaluateAnswer('ordering', data, { kind: 'order', itemIds: ['a', 'b', 'c', 'd'] }).correct).toBe(true);
    expect(evaluateAnswer('ordering', data, { kind: 'order', itemIds: ['a', 'c', 'b', 'd'] }).correct).toBe(false);
  });

  it('rejects a partial ordering', () => {
    expect(evaluateAnswer('ordering', data, { kind: 'order', itemIds: ['a', 'b'] }).correct).toBe(false);
  });
});

describe('matching', () => {
  const data: EvaluationData = { correctPairs: { l1: 'r2', l2: 'r1', l3: 'r3' } };

  it('accepts a complete correct mapping', () => {
    const r = evaluateAnswer('matching', data, {
      kind: 'pairs',
      pairs: { l1: 'r2', l2: 'r1', l3: 'r3' },
    });
    expect(r.correct).toBe(true);
    expect(r.detail).toBe('3/3 pairs matched');
  });

  it('rejects a partial mapping and reports the score', () => {
    const r = evaluateAnswer('matching', data, { kind: 'pairs', pairs: { l1: 'r2', l2: 'r3', l3: 'r1' } });
    expect(r.correct).toBe(false);
    expect(r.detail).toBe('1/3 pairs matched');
  });

  it('rejects an incomplete mapping', () => {
    expect(evaluateAnswer('matching', data, { kind: 'pairs', pairs: { l1: 'r2' } }).correct).toBe(false);
  });
});

describe('code type is delegated to the runner', () => {
  it('never resolves purely', () => {
    const r = evaluateAnswer('code', {}, { kind: 'code', language: 'python', source: 'print(1)' });
    expect(r.correct).toBe(false);
    expect(r.detail).toContain('runner');
  });
});

describe('isAnswerComplete', () => {
  it('gates the submit button per type', () => {
    expect(isAnswerComplete('mcq', { kind: 'choice', optionIds: [] })).toBe(false);
    expect(isAnswerComplete('mcq', { kind: 'choice', optionIds: ['a'] })).toBe(true);
    expect(isAnswerComplete('multi', { kind: 'choice', optionIds: ['a'] })).toBe(true);
    expect(isAnswerComplete('output', { kind: 'text', value: '   ' })).toBe(false);
    expect(isAnswerComplete('numeric', { kind: 'number', value: Number.NaN })).toBe(false);
    expect(isAnswerComplete('true_false', { kind: 'boolean', value: false })).toBe(true);
    expect(isAnswerComplete('ordering', { kind: 'order', itemIds: ['a', 'b'] }, { items: 3 })).toBe(false);
    expect(isAnswerComplete('matching', { kind: 'pairs', pairs: { a: 'b' } }, { pairs: 1 })).toBe(true);
    expect(isAnswerComplete('code', { kind: 'code', language: 'python', source: '' })).toBe(false);
    expect(isAnswerComplete('mcq', null)).toBe(false);
  });
});

describe('outputMatches (code runner comparison)', () => {
  it('ignores trailing whitespace and trailing newlines', () => {
    expect(outputMatches('1\n2\n', '1\n2')).toBe(true);
    expect(outputMatches('1 \n2  \n\n', '1\n2')).toBe(true);
    expect(outputMatches('1\r\n2\r\n', '1\n2')).toBe(true);
  });

  it('does not ignore meaningful differences', () => {
    expect(outputMatches('1\n2', '1\n3')).toBe(false);
    expect(outputMatches(' 1', '1')).toBe(false);
  });
});
