import { describe, expect, it } from 'vitest';
import type { Question } from '@code-market/shared';
import { ACTIVE_IDS, QUESTION_POOL, NORMAL_POOL, PREMIUM_POOL, RESERVE_POOL, FULL_BANK } from '../src/content/pool.js';
import { makeHarness } from './helpers.js';

describe('Round 3 final question bank', () => {
  it('the ACTIVE pool is the curated ACTIVE_IDS set: 12 normal + 4 premium, matching one game exactly', () => {
    expect(QUESTION_POOL).toHaveLength(16);
    expect(NORMAL_POOL).toHaveLength(12);
    expect(PREMIUM_POOL).toHaveLength(4);
    for (const q of QUESTION_POOL) expect(ACTIVE_IDS.has(q.id), q.id).toBe(true);
  });

  it('the active pool has a genuine difficulty spread, not a hard/very_hard skew', () => {
    const byTier: Record<string, number> = {};
    for (const q of QUESTION_POOL) byTier[q.difficulty] = (byTier[q.difficulty] ?? 0) + 1;
    expect(byTier).toEqual({ medium: 5, hard: 5, very_hard: 6 });
  });

  it('RESERVE_POOL holds everything not selected into ACTIVE_IDS (14 normal + 2 premium), kept but not seeded', () => {
    expect(RESERVE_POOL).toHaveLength(16);
    expect(RESERVE_POOL.filter((q) => q.kind === 'normal')).toHaveLength(14);
    expect(RESERVE_POOL.filter((q) => q.kind === 'premium')).toHaveLength(2);
    for (const q of RESERVE_POOL) expect(ACTIVE_IDS.has(q.id), q.id).toBe(false);
  });

  it('FULL_BANK is all 32 authored questions (active + reserve)', () => {
    expect(FULL_BANK).toHaveLength(32);
    expect(FULL_BANK.filter((q) => q.kind === 'normal')).toHaveLength(26);
    expect(FULL_BANK.filter((q) => q.kind === 'premium')).toHaveLength(6);
  });

  it('is keyed Q01..Q32 across the full bank with unique ids and unique access keys', () => {
    const ids = FULL_BANK.map((q) => q.id).sort();
    const expected = Array.from({ length: 32 }, (_, i) => `Q${String(i + 1).padStart(2, '0')}`);
    expect(ids).toEqual(expected);
    expect(new Set(FULL_BANK.map((q) => q.accessKey)).size).toBe(32);
  });

  it('uses only the approved medium/hard/very_hard tiers', () => {
    const tiers = new Set(FULL_BANK.map((q) => q.difficulty));
    expect([...tiers].sort()).toEqual(['hard', 'medium', 'very_hard']);
  });

  it('gives every question an internally consistent evaluation', () => {
    for (const q of FULL_BANK) {
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

  it('draws a full 12-normal / 4-premium round using every active question, in a random order', () => {
    const h = makeHarness();
    try {
      h.engine.createTeams([{ id: 'T01', name: 'ALPHA' }]);
      const slots = h.engine.generateRound(4242);
      const normals = slots.filter((s) => s.kind === 'normal');
      const premiums = slots.filter((s) => s.kind === 'premium');
      expect(normals).toHaveLength(12);
      expect(premiums).toHaveLength(4);
      // Every drawn id belongs to the curated active set.
      for (const s of slots) expect(ACTIVE_IDS.has(s.questionId), s.questionId).toBe(true);
      // Exactly the 12 active normals are used (no repeats, none left out) -
      // the pool size equals the draw size, so composition is deterministic.
      expect(new Set(normals.map((s) => s.questionId)).size).toBe(12);
      expect(new Set(premiums.map((s) => s.questionId))).toEqual(
        new Set(PREMIUM_POOL.map((q) => q.id)),
      );
    } finally {
      h.close();
    }
  });

  it('prunes a stale question from a previous bank on reseed, and never seeds the reserve half', () => {
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
      expect(h.repo.getQuestion('Q01')).toBeNull(); // reserve half, not seeded
      expect(h.repo.listQuestions()).toHaveLength(16);
    } finally {
      h.close();
    }
  });
});
