/**
 * Auto-submit a selected answer on timeout (spec sections 1, 23).
 *
 * A team that SELECTED an answer but did not press Submit must have that answer
 * submitted and evaluated when its clock runs out - never dropped as a blank
 * timeout. The server owns the deadline and holds the selection, so a frozen or
 * reconnecting laptop is still settled correctly, and a submit racing the timer
 * never produces two attempts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  advanceTo,
  answerFor,
  capital,
  makeHarness,
  openFirstQuestion,
  startRound,
  type Harness,
} from './helpers.js';
import type { Question } from '@code-market/shared';

let h: Harness;

/** Let the async expiry path (evaluate -> settle) run to completion. */
const flush = () => new Promise((r) => setTimeout(r, 25));

/** Join the first normal question as a team, ready to answer. */
function joinFirst(teamId = 'T01'): { slotIndex: number; question: Question } {
  const { slot, question } = openFirstQuestion(h);
  h.engine.unlockQuestion(teamId, question.id, question.accessKey);
  h.engine.joinQuestion(teamId, question.id);
  return { slotIndex: slot.index, question };
}

beforeEach(() => {
  h = makeHarness();
  startRound(h, 4);
});
afterEach(() => h.close());

describe('normal question timeout (spec 1, 23)', () => {
  it('auto-submits and evaluates a selected answer when the clock expires', async () => {
    const { slotIndex, question } = joinFirst();
    const before = capital(h, 'T01');
    h.engine.stageAnswer('T01', question.id, answerFor(question, true));

    expect(h.engine.fireTimer(`deadline:T01:${slotIndex}`)).toBe(true);
    await flush();

    const attempts = h.repo.listAttemptsForTeam('T01');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.result).toBe('correct'); // NOT stuck on a blank timeout
    expect(capital(h, 'T01')).toBeGreaterThan(before);
    expect(h.engine.teamView('T01')?.questionState).toBe('resolved');
  });

  it('records the existing unanswered behaviour when nothing was selected', async () => {
    const { slotIndex } = joinFirst();
    expect(h.engine.fireTimer(`deadline:T01:${slotIndex}`)).toBe(true);
    await flush();

    const attempts = h.repo.listAttemptsForTeam('T01');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.result).toBe('timeout');
  });

  it('evaluates a staged WRONG answer as wrong, not as an unanswered timeout', async () => {
    const { slotIndex, question } = joinFirst();
    h.engine.stageAnswer('T01', question.id, answerFor(question, false));
    expect(h.engine.fireTimer(`deadline:T01:${slotIndex}`)).toBe(true);
    await flush();
    expect(h.repo.listAttemptsForTeam('T01')[0]?.result).toBe('wrong');
  });

  it('a manual submit before the deadline settles normally and clears the timer', async () => {
    const { slotIndex, question } = joinFirst();
    h.engine.stageAnswer('T01', question.id, answerFor(question, false));
    await h.engine.submitAnswer('T01', question.id, answerFor(question, true));

    // The per-team deadline timer is cleared on submit; firing it is a no-op.
    expect(h.engine.fireTimer(`deadline:T01:${slotIndex}`)).toBe(false);
    await flush();

    const attempts = h.repo.listAttemptsForTeam('T01');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.result).toBe('correct'); // the manual answer wins
  });

  it('never produces two attempts when a submit and the timeout race', async () => {
    const { slotIndex, question } = joinFirst();
    h.engine.stageAnswer('T01', question.id, answerFor(question, true));

    // Submit and fire the deadline in the same tick.
    const submit = h.engine.submitAnswer('T01', question.id, answerFor(question, true));
    h.engine.fireTimer(`deadline:T01:${slotIndex}`);
    await submit.catch(() => undefined);
    await flush();

    expect(h.repo.listAttemptsForTeam('T01')).toHaveLength(1);
  });

  it('discards a stale staged answer once the attempt is resolved', async () => {
    const { slotIndex, question } = joinFirst();
    h.engine.stageAnswer('T01', question.id, answerFor(question, true));
    await h.engine.submitAnswer('T01', question.id, answerFor(question, true));
    expect(h.repo.getParticipation('T01', slotIndex)?.stagedSubmission).toBeNull();
  });
});

describe('premium attempt timeout (spec 1)', () => {
  it('auto-submits the premium attempter staged answer instead of timing out', async () => {
    const slot = advanceTo(h, (s) => s.kind === 'premium');
    const question = h.repo.getQuestion(slot.questionId) as Question;
    h.engine.startAuction();
    h.engine.placeBid('T01', 400);
    h.engine.closeAuction();

    // Capital before the attempt; the ₹400 bid is staked on start, and a correct
    // staged auto-submit pays it back 2x -> net +400 for the winning bidder.
    const before = capital(h, 'T01');
    h.engine.startPremiumAttempt();
    h.engine.stageAnswer('T01', question.id, answerFor(question, true));
    expect(h.engine.fireTimer(`premium:${question.id}`)).toBe(true);
    await flush();

    const attempts = h.repo.listAttemptsForTeam('T01');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.result).toBe('correct');
    expect(capital(h, 'T01')).toBe(before + 400);
  });
});
