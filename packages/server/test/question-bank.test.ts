import { describe, expect, it } from 'vitest';
import type { Question } from '@code-market/shared';
import { QUESTION_POOL, NORMAL_POOL, PREMIUM_POOL } from '../src/content/pool.js';
import { makeHarness } from './helpers.js';

describe('Round 3 final question bank', () => {
  it('holds 32 questions: 26 normal + 6 premium', () => {
    expect(QUESTION_POOL).toHaveLength(32);
    expect(NORMAL_POOL).toHaveLength(26);
    expect(PREMIUM_POOL).toHaveLength(6);
  });

  it('is keyed Q01..Q32 with unique ids and unique access keys', () => {
    const ids = QUESTION_POOL.map((q) => q.id).sort();
    const expected = Array.from({ length: 32 }, (_, i) => `Q${String(i + 1).padStart(2, '0')}`);
    expect(ids).toEqual(expected);
    expect(new Set(QUESTION_POOL.map((q) => q.accessKey)).size).toBe(32);
  });

  it('uses only the approved medium/hard/very_hard tiers', () => {
    const tiers = new Set(QUESTION_POOL.map((q) => q.difficulty));
    expect([...tiers].sort()).toEqual(['hard', 'medium', 'very_hard']);
  });

  it('gives every question an internally consistent evaluation', () => {
    for (const q of QUESTION_POOL) {
      const e = q.evaluation;
      switch (q.type) {
        case 'mcq':
          expect(e.correctOptionIds, q.id).toHaveLength(1);
          expect((q.question.options ?? []).map((o) => o.id), q.id).toContain(
            e.correctOptionIds?.[0],
          );
          break;
        case 'multi': {
          expect((e.correctOptionIds ?? []).length, q.id).toBeGreaterThan(0);
          const optionIds = new Set((q.question.options ?? []).map((o) => o.id));
          for (const id of e.correctOptionIds ?? []) expect(optionIds.has(id), `${q.id}:${id}`).toBe(true);
          break;
        }
        case 'true_false':
          expect(typeof e.correctBoolean, q.id).toBe('boolean');
          break;
        case 'numeric':
          expect(typeof e.correctNumber, q.id).toBe('number');
          break;
        case 'ordering': {
          const itemIds = new Set((q.question.items ?? []).map((i) => i.id));
          expect((e.correctOrder ?? []).length, q.id).toBe(itemIds.size);
          for (const id of e.correctOrder ?? []) expect(itemIds.has(id), `${q.id}:${id}`).toBe(true);
          break;
        }
        default: // output / short_text
          expect((e.acceptedAnswers ?? []).length, q.id).toBeGreaterThan(0);
          expect((e.acceptedAnswers ?? [])[0], q.id).toBeTruthy();
      }
    }
  });

  it('draws a full 12-normal / 4-premium round from the new bank', () => {
    const h = makeHarness();
    try {
      h.engine.createTeams([{ id: 'T01', name: 'ALPHA' }]);
      const slots = h.engine.generateRound(4242);
      const normals = slots.filter((s) => s.kind === 'normal');
      const premiums = slots.filter((s) => s.kind === 'premium');
      expect(normals).toHaveLength(12);
      expect(premiums).toHaveLength(4);
      // Every drawn id belongs to the new Q01..Q32 bank.
      for (const s of slots) expect(s.questionId).toMatch(/^Q\d{2}$/);
    } finally {
      h.close();
    }
  });

  it('prunes a stale question from a previous bank on reseed', () => {
    const h = makeHarness();
    try {
      const stale: Question = {
        id: 'N99',
        kind: 'normal',
        title: 'Stale',
        domain: 'dsa',
        type: 'numeric',
        difficulty: 'easy',
        timeLimit: 60,
        accessKey: 'OLD-0001',
        question: { prompt: 'old' },
        evaluation: { correctNumber: 1 },
      };
      h.repo.upsertQuestion(stale, 'deadbeef');
      expect(h.repo.getQuestion('N99')).not.toBeNull();

      h.engine.seedQuestions();

      expect(h.repo.getQuestion('N99')).toBeNull();
      expect(h.repo.listQuestions()).toHaveLength(32);
    } finally {
      h.close();
    }
  });
});
