import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config.js';
import {
  SequenceError,
  describeSlot,
  finalPremiumIndex,
  finalStretchSlotIndices,
  generateSequence,
  isFinalStretchSlot,
  nextSlot,
  normalSlots,
  premiumSlots,
  slotAt,
} from './sequence.js';
import type { Difficulty, Question, SequenceSlot } from './types.js';

type PoolItem = Pick<Question, 'id' | 'kind' | 'difficulty'>;

const DIFFS: Difficulty[] = ['easy', 'medium', 'hard', 'very_hard'];

function pool(normals: number, premiums: number): PoolItem[] {
  const items: PoolItem[] = [];
  for (let i = 1; i <= normals; i++) {
    items.push({
      id: `N${String(i).padStart(2, '0')}`,
      kind: 'normal',
      difficulty: DIFFS[i % DIFFS.length] as Difficulty,
    });
  }
  for (let i = 1; i <= premiums; i++) {
    items.push({ id: `P${i}`, kind: 'premium', difficulty: 'very_hard' });
  }
  return items;
}

const cfg = (over: Partial<typeof DEFAULT_CONFIG> = {}) => ({
  blocks: 4,
  questionsPerBlock: 3,
  noRepeatWindow: 6,
  normalDifficulties: DIFFS,
  ...over,
});

function generate(normals = 24, premiums = 4, over = {}, seed = 12345): SequenceSlot[] {
  return generateSequence({ pool: pool(normals, premiums), config: cfg(over), seed });
}

describe('block structure (spec 1, 3)', () => {
  it('produces exactly three normal questions before every premium', () => {
    const slots = generate();
    const pattern = slots.map((s) => s.kind);
    expect(pattern).toEqual([
      'normal', 'normal', 'normal', 'premium',
      'normal', 'normal', 'normal', 'premium',
      'normal', 'normal', 'normal', 'premium',
      'normal', 'normal', 'normal', 'premium',
    ]);
  });

  it('numbers slots contiguously from 1', () => {
    const slots = generate();
    expect(slots.map((s) => s.index)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
  });

  it('labels blocks and positions correctly', () => {
    const slots = generate();
    expect(slots.slice(0, 4).map((s) => [s.blockNumber, s.positionInBlock])).toEqual([
      [1, 1], [1, 2], [1, 3], [1, 4],
    ]);
    expect(slots.slice(4, 8).map((s) => [s.blockNumber, s.positionInBlock])).toEqual([
      [2, 1], [2, 2], [2, 3], [2, 4],
    ]);
  });

  it('honours a different block count and block size', () => {
    const slots = generate(24, 6, { blocks: 2, questionsPerBlock: 5 });
    expect(slots).toHaveLength(12);
    expect(normalSlots(slots)).toHaveLength(10);
    expect(premiumSlots(slots)).toHaveLength(2);
    expect(slots[5]?.kind).toBe('premium');
  });

  it('starts every slot pending', () => {
    expect(generate().every((s) => s.state === 'pending')).toBe(true);
  });

  it('uses each premium once, in authored order', () => {
    const premiums = premiumSlots(generate());
    expect(premiums.map((s) => s.questionId)).toEqual(['P1', 'P2', 'P3', 'P4']);
  });
});

describe('random draw (spec 1, 22)', () => {
  it('does NOT impose a difficulty progression', () => {
    // The forbidden behaviour is a monotonic ramp inside each block. Across
    // many seeds, at least one block must break easy -> medium -> hard order.
    const order: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2, very_hard: 3 };
    const difficultyOf = new Map(pool(24, 4).map((q) => [q.id, q.difficulty]));

    let sawNonMonotonic = false;
    for (let seed = 1; seed <= 30 && !sawNonMonotonic; seed++) {
      const slots = generate(24, 4, {}, seed);
      for (let block = 1; block <= 4; block++) {
        const tiers = slots
          .filter((s) => s.blockNumber === block && s.kind === 'normal')
          .map((s) => order[difficultyOf.get(s.questionId) as Difficulty]);
        for (let i = 1; i < tiers.length; i++) {
          if ((tiers[i] as number) <= (tiers[i - 1] as number)) sawNonMonotonic = true;
        }
      }
    }
    expect(sawNonMonotonic).toBe(true);
  });

  it('draws from every difficulty tier over a run of seeds', () => {
    const difficultyOf = new Map(pool(24, 4).map((q) => [q.id, q.difficulty]));
    const seen = new Set<Difficulty>();
    for (let seed = 1; seed <= 20; seed++) {
      for (const slot of normalSlots(generate(24, 4, {}, seed))) {
        seen.add(difficultyOf.get(slot.questionId) as Difficulty);
      }
    }
    expect([...seen].sort()).toEqual(['easy', 'hard', 'medium', 'very_hard']);
  });

  it('never repeats a question when the pool is large enough', () => {
    const ids = normalSlots(generate(24, 4)).map((s) => s.questionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never draws a premium into a normal slot', () => {
    const ids = normalSlots(generate()).map((s) => s.questionId);
    expect(ids.every((id) => id.startsWith('N'))).toBe(true);
  });

  it('respects the no-repeat window when the pool must be re-used', () => {
    // 5 normals for 12 slots forces re-use; nothing may repeat within 4.
    const slots = normalSlots(generate(5, 4, { noRepeatWindow: 4 }));
    const ids = slots.map((s) => s.questionId);
    for (let i = 0; i < ids.length; i++) {
      const window = ids.slice(Math.max(0, i - 4), i);
      expect(window, `slot ${i} repeated ${ids[i]} too soon`).not.toContain(ids[i]);
    }
  });

  it('still terminates when the pool is smaller than the window', () => {
    const slots = generate(2, 4, { noRepeatWindow: 10 });
    expect(normalSlots(slots)).toHaveLength(12);
  });

  it('only draws from the configured difficulties', () => {
    const difficultyOf = new Map(pool(24, 4).map((q) => [q.id, q.difficulty]));
    const slots = normalSlots(generate(24, 4, { normalDifficulties: ['hard', 'very_hard'] }));
    for (const slot of slots) {
      expect(['hard', 'very_hard']).toContain(difficultyOf.get(slot.questionId));
    }
  });
});

describe('determinism (spec 22)', () => {
  it('the same seed always produces the same round', () => {
    expect(generate(24, 4, {}, 777)).toEqual(generate(24, 4, {}, 777));
  });

  it('different seeds produce different rounds', () => {
    const a = normalSlots(generate(24, 4, {}, 1)).map((s) => s.questionId);
    const b = normalSlots(generate(24, 4, {}, 2)).map((s) => s.questionId);
    expect(a).not.toEqual(b);
  });

  it('regenerating after a restart yields an identical sequence', () => {
    const before = generate(24, 4, {}, 424242);
    const afterRestart = generate(24, 4, {}, 424242);
    expect(afterRestart.map((s) => s.questionId)).toEqual(before.map((s) => s.questionId));
  });
});

describe('pool validation', () => {
  it('refuses to generate without normal questions', () => {
    expect(() => generateSequence({ pool: pool(0, 4), config: cfg(), seed: 1 })).toThrow(
      SequenceError,
    );
  });

  it('refuses to generate without premium questions', () => {
    expect(() => generateSequence({ pool: pool(24, 0), config: cfg(), seed: 1 })).toThrow(
      /no premium/i,
    );
  });

  it('refuses when there are fewer premiums than blocks', () => {
    expect(() => generateSequence({ pool: pool(24, 2), config: cfg(), seed: 1 })).toThrow(
      /4 blocks need 4 premium/,
    );
  });

  it('refuses when no difficulty is eligible', () => {
    expect(() =>
      generateSequence({ pool: pool(24, 4), config: cfg({ normalDifficulties: [] }), seed: 1 }),
    ).toThrow(/no eligible normal/i);
  });
});

describe('final stretch (spec 11, 18)', () => {
  it('covers the LAST FOUR normal questions, not the last four slots', () => {
    const slots = generate();
    const blackout = finalStretchSlotIndices(slots, 4);
    const normals = normalSlots(slots);
    const expected = normals.slice(-4).map((s) => s.index);

    expect([...blackout].sort((a, b) => a - b)).toEqual(expected);
    // The final premium sits between them and is NOT blacked out.
    expect(blackout.has(finalPremiumIndex(slots) as number)).toBe(false);
  });

  it('excludes earlier questions', () => {
    const slots = generate();
    expect(isFinalStretchSlot(slots, 4, 1)).toBe(false);
    expect(isFinalStretchSlot(slots, 4, 2)).toBe(false);
    const lastNormal = normalSlots(slots).at(-1) as SequenceSlot;
    expect(isFinalStretchSlot(slots, 4, lastNormal.index)).toBe(true);
  });

  it('can be disabled with zero', () => {
    expect(finalStretchSlotIndices(generate(), 0).size).toBe(0);
  });

  it('covers everything when the count exceeds the round', () => {
    const slots = generate();
    expect(finalStretchSlotIndices(slots, 99).size).toBe(normalSlots(slots).length);
  });
});

describe('navigation helpers', () => {
  it('finds a slot and its successor', () => {
    const slots = generate();
    expect(slotAt(slots, 4)?.kind).toBe('premium');
    expect(nextSlot(slots, 4)?.index).toBe(5);
    expect(nextSlot(slots, slots.length)).toBeNull();
    expect(slotAt(slots, 999)).toBeNull();
  });

  it('identifies the final premium', () => {
    expect(finalPremiumIndex(generate())).toBe(16);
  });

  it('describes a slot for the operator', () => {
    const slots = generate();
    expect(describeSlot(slots[1] as SequenceSlot, 3)).toBe('Block 1 · Q2 of 3');
    expect(describeSlot(slots[3] as SequenceSlot, 3)).toBe('Block 1 · PREMIUM');
  });
});

describe('default configuration', () => {
  it('is Round 3 with a 3-question block and no qualification concept', () => {
    expect(DEFAULT_CONFIG.roundNumber).toBe(3);
    expect(DEFAULT_CONFIG.questionsPerBlock).toBe(3);
    expect(DEFAULT_CONFIG.podiumPlaces).toBe(3);
    expect(DEFAULT_CONFIG).not.toHaveProperty('qualifiers');
  });

  it('uses the specified solve times', () => {
    expect(DEFAULT_CONFIG.difficultyTimes).toEqual({
      easy: 60,
      medium: 90,
      hard: 120,
      very_hard: 150,
    });
  });

  it('uses a 7-minute premium window and a 40-second strategy phase', () => {
    expect(DEFAULT_CONFIG.premiumWindowSeconds).toBe(420);
    expect(DEFAULT_CONFIG.strategyWindowSeconds).toBe(40);
  });

  it('blacks out the last four questions', () => {
    expect(DEFAULT_CONFIG.hideLeaderboardLastQuestions).toBe(4);
  });
});
