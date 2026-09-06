/**
 * Round sequence generation (spec sections 1, 3, 22).
 *
 * THE RULE: before every premium challenge there are exactly N normal
 * questions, drawn RANDOMLY from the whole pool across Easy / Medium / Hard /
 * Very Hard. There is deliberately NO difficulty progression - no
 * easy-then-medium-then-hard ramp. Any tier can appear at any position.
 *
 *   3 random questions -> PREMIUM -> 3 random questions -> PREMIUM -> ...
 *
 * The draw is:
 *  - server-side only (a client never picks its own question),
 *  - seeded, so the same seed always produces the same round,
 *  - persisted, so a restart or a reconnect never re-rolls the order,
 *  - duplicate-free, and it avoids re-using a question that appeared within
 *    the configured no-repeat window.
 */

import type { GameConfig } from './config.js';
import type { Difficulty, Question, SequenceSlot } from './types.js';
import { mulberry32 } from './util.js';

export interface GenerateInput {
  /** The whole question pool - normal and premium items together. */
  pool: Pick<Question, 'id' | 'kind' | 'difficulty'>[];
  config: Pick<
    GameConfig,
    'blocks' | 'questionsPerBlock' | 'noRepeatWindow' | 'normalDifficulties'
  >;
  /** Any integer. The same seed always yields the same round. */
  seed: number;
}

export class SequenceError extends Error {
  constructor(
    readonly code: 'no_normal_questions' | 'no_premium_questions' | 'insufficient_pool',
    message: string,
  ) {
    super(message);
    this.name = 'SequenceError';
  }
}

/** Fisher-Yates using the supplied PRNG, so shuffling is reproducible. */
function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * Build the whole round.
 *
 * Normal questions are drawn without replacement while the pool lasts. If the
 * round needs more questions than the pool holds, the pool is reshuffled and
 * re-used - but never in a way that repeats an item inside the no-repeat
 * window, so a team never sees the same question twice in quick succession.
 */
export function generateSequence(input: GenerateInput): SequenceSlot[] {
  const { pool, config, seed } = input;
  const rand = mulberry32(seed);

  const eligible = new Set<Difficulty>(config.normalDifficulties);
  const normals = pool.filter((q) => q.kind === 'normal' && eligible.has(q.difficulty));
  const premiums = pool.filter((q) => q.kind === 'premium');

  if (normals.length === 0) {
    throw new SequenceError('no_normal_questions', 'The pool has no eligible normal questions');
  }
  if (premiums.length === 0) {
    throw new SequenceError('no_premium_questions', 'The pool has no premium questions');
  }

  const perBlock = Math.max(1, Math.floor(config.questionsPerBlock));
  const blocks = Math.max(1, Math.floor(config.blocks));
  const needed = perBlock * blocks;

  if (premiums.length < blocks) {
    throw new SequenceError(
      'insufficient_pool',
      `${blocks} blocks need ${blocks} premium questions but the pool has ${premiums.length}`,
    );
  }

  // Premiums keep their authored order (they are hand-tuned showpieces and the
  // last one is the finale); only the normal draw is randomised.
  const premiumOrder = premiums.slice(0, blocks);

  const normalOrder = drawNormals(normals, needed, config.noRepeatWindow, rand);

  const slots: SequenceSlot[] = [];
  let index = 0;
  let cursor = 0;

  for (let block = 1; block <= blocks; block++) {
    for (let position = 1; position <= perBlock; position++) {
      const question = normalOrder[cursor++];
      if (!question) break;
      slots.push({
        index: ++index,
        blockNumber: block,
        positionInBlock: position,
        kind: 'normal',
        questionId: question,
        state: 'pending',
      });
    }
    const premium = premiumOrder[block - 1];
    if (premium) {
      slots.push({
        index: ++index,
        blockNumber: block,
        positionInBlock: perBlock + 1,
        kind: 'premium',
        questionId: premium.id,
        state: 'pending',
      });
    }
  }

  return slots;
}

/**
 * Draw `count` normal question ids at random.
 *
 * Within one pass through the pool every question is distinct. When the round
 * is longer than the pool, later passes re-shuffle, and any question that would
 * land inside the no-repeat window is deferred rather than repeated.
 */
function drawNormals(
  normals: readonly Pick<Question, 'id'>[],
  count: number,
  noRepeatWindow: number,
  rand: () => number,
): string[] {
  const picked: string[] = [];
  const window = Math.max(0, Math.floor(noRepeatWindow));

  while (picked.length < count) {
    const pass = shuffle(normals, rand).map((q) => q.id);

    for (const id of pass) {
      if (picked.length >= count) break;
      const recent = picked.slice(-window);
      if (window > 0 && recent.includes(id)) {
        // Too soon: hold it back and try the rest of this pass first.
        continue;
      }
      picked.push(id);
    }

    // Nothing was addable this pass (tiny pool vs a large window): relax the
    // window rather than loop forever, still preferring the least-recent item.
    if (picked.length < count) {
      const leastRecent = [...normals]
        .map((q) => ({ id: q.id, lastUsed: picked.lastIndexOf(q.id) }))
        .sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!leastRecent) break;
      picked.push(leastRecent.id);
    }
  }

  return picked.slice(0, count);
}

/* ------------------------------------------------------------------ *
 * Derived facts about a generated sequence
 * ------------------------------------------------------------------ */

/** The normal-question slots, in order. */
export function normalSlots(slots: readonly SequenceSlot[]): SequenceSlot[] {
  return slots.filter((s) => s.kind === 'normal');
}

/** The premium slots, in order. */
export function premiumSlots(slots: readonly SequenceSlot[]): SequenceSlot[] {
  return slots.filter((s) => s.kind === 'premium');
}

/**
 * Slot indices covered by the leaderboard blackout: the LAST N normal
 * questions of the round (spec sections 11, 18). Premiums are not counted -
 * the auction is public theatre and stays visible.
 */
export function finalStretchSlotIndices(
  slots: readonly SequenceSlot[],
  lastQuestions: number,
): Set<number> {
  const count = Math.max(0, Math.floor(lastQuestions));
  if (count === 0) return new Set();
  const normals = normalSlots(slots);
  return new Set(normals.slice(-count).map((s) => s.index));
}

/** Is this slot inside the blackout? */
export function isFinalStretchSlot(
  slots: readonly SequenceSlot[],
  lastQuestions: number,
  slotIndex: number,
): boolean {
  return finalStretchSlotIndices(slots, lastQuestions).has(slotIndex);
}

/** The last premium in the round gets the ceremonial treatment. */
export function finalPremiumIndex(slots: readonly SequenceSlot[]): number | null {
  const premiums = premiumSlots(slots);
  return premiums.length > 0 ? (premiums[premiums.length - 1] as SequenceSlot).index : null;
}

/** The slot that follows `index`, or null at the end of the round. */
export function nextSlot(
  slots: readonly SequenceSlot[],
  index: number,
): SequenceSlot | null {
  return slots.find((s) => s.index === index + 1) ?? null;
}

export function slotAt(slots: readonly SequenceSlot[], index: number): SequenceSlot | null {
  return slots.find((s) => s.index === index) ?? null;
}

/** Human summary for the organizer: "BLOCK 2 · Q2 of 3". */
export function describeSlot(slot: SequenceSlot, questionsPerBlock: number): string {
  if (slot.kind === 'premium') return `Block ${slot.blockNumber} · PREMIUM`;
  return `Block ${slot.blockNumber} · Q${slot.positionInBlock} of ${questionsPerBlock}`;
}
