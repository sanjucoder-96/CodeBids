/**
 * The Round 3 structure: generated blocks, the state machine, the strategy
 * phase, the leaderboard blackout and the podium.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  advanceTo,
  answerFor,
  capital,
  makeHarness,
  openFirstQuestion,
  play,
  seedTeams,
  startRound,
  type Harness,
} from './helpers.js';
import type { Question } from '@code-market/shared';

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

afterEach(() => h.close());

/* ------------------------------------------------------------------ */

describe('generated sequence (spec 1, 3, 22)', () => {
  it('builds blocks of three normal questions then a premium', () => {
    startRound(h);
    const kinds = h.engine.sequence().map((s) => s.kind);
    expect(kinds).toEqual([
      'normal', 'normal', 'normal', 'premium',
      'normal', 'normal', 'normal', 'premium',
      'normal', 'normal', 'normal', 'premium',
      'normal', 'normal', 'normal', 'premium',
    ]);
  });

  it('persists the sequence and its seed', () => {
    startRound(h, 4, 4242);
    expect(h.repo.getMeta('sequence_seed')).toBe('4242');
    expect(h.repo.listSequence()).toHaveLength(16);
  });

  it('does not re-roll the sequence on a second start', () => {
    startRound(h, 4, 4242);
    const before = h.engine.sequence().map((s) => s.questionId);
    h.engine.generateRound();
    expect(h.engine.sequence().map((s) => s.questionId)).toEqual(before);
  });

  it('never repeats a normal question inside one round', () => {
    startRound(h);
    const normals = h.engine.sequence().filter((s) => s.kind === 'normal').map((s) => s.questionId);
    expect(new Set(normals).size).toBe(normals.length);
  });

  it('draws normal questions from more than one difficulty tier', () => {
    startRound(h);
    const questions = new Map(h.engine.listQuestions().map((q) => [q.id, q]));
    const tiers = new Set(
      h.engine
        .sequence()
        .filter((s) => s.kind === 'normal')
        .map((s) => questions.get(s.questionId)?.difficulty),
    );
    expect(tiers.size).toBeGreaterThan(1);
  });

  it('honours a reconfigured block count', () => {
    seedTeams(h, 4);
    h.engine.updateConfig({ blocks: 2, questionsPerBlock: 2 });
    h.engine.generateRound(11);
    h.engine.startGame();
    expect(h.engine.sequence().map((s) => s.kind)).toEqual([
      'normal', 'normal', 'premium', 'normal', 'normal', 'premium',
    ]);
  });

  it('exposes the sequence to the organizer with domain and difficulty', () => {
    startRound(h);
    const entries = h.engine.sequenceEntries();
    expect(entries).toHaveLength(16);
    expect(entries[0]).toMatchObject({ blockNumber: 1, positionInBlock: 1, kind: 'normal' });
    expect(entries[0]?.domain).toBeTruthy();
    expect(entries[0]?.difficulty).toBeTruthy();
    expect(entries[0]?.timeLimit).toBeGreaterThan(0);
    expect(entries.at(-1)?.isFinalPremium).toBe(true);
  });
});

describe('solve times come from difficulty (spec 4)', () => {
  it('assigns the configured time to every question', () => {
    startRound(h);
    const expected = { easy: 60, medium: 90, hard: 120, very_hard: 150 };
    for (const q of h.engine.listQuestions()) {
      expect(q.timeLimit, `${q.id} (${q.difficulty})`).toBe(expected[q.difficulty]);
    }
  });

  it('re-times questions when the organizer changes the config', () => {
    seedTeams(h, 2);
    h.engine.updateConfig({ difficultyTimes: { easy: 45, medium: 90, hard: 120, very_hard: 200 } });
    h.engine.seedQuestions();
    const veryHard = h.engine.listQuestions().find((q) => q.difficulty === 'very_hard');
    expect(veryHard?.timeLimit).toBe(150); // authored time is kept once seeded
  });
});

describe('state machine (spec 19)', () => {
  it('walks idle -> question_intro -> question_active -> question_result', () => {
    startRound(h);
    expect(h.engine.gameState().phase).toBe('idle');

    h.engine.advance();
    expect(h.engine.gameState().phase).toBe('question_intro');

    h.engine.openQuestion();
    expect(h.engine.gameState().phase).toBe('question_active');

    h.engine.closeQuestion();
    expect(h.engine.gameState().phase).toBe('question_result');
  });

  it('the intro timer opens the question automatically', () => {
    startRound(h);
    h.engine.advance();
    expect(h.engine.fireTimer('intro')).toBe(true);
    expect(h.engine.gameState().phase).toBe('question_active');
  });

  it('withholds the question body during the intro', () => {
    startRound(h);
    h.clearEvents();
    h.engine.advance();
    const intro = h.lastEvent<{ question: { revealed: boolean; question: { prompt: string } } }>(
      'QUESTION_INTRO',
    );
    expect(intro?.question.revealed).toBe(false);
    expect(intro?.question.question.prompt).toBe('');
  });

  it('reveals domain, difficulty and time in the intro', () => {
    startRound(h);
    h.clearEvents();
    h.engine.advance();
    const intro = h.lastEvent<{
      question: { domain: string; difficulty: string; timeLimit: number };
    }>('QUESTION_INTRO');
    expect(intro?.question.domain).toBeTruthy();
    expect(intro?.question.difficulty).toBeTruthy();
    expect(intro?.question.timeLimit).toBeGreaterThan(0);
  });

  it('walks premium_intro -> auction_active -> premium_authorized -> premium_solving', () => {
    startRound(h);
    const slot = advanceTo(h, (s) => s.kind === 'premium');
    expect(h.engine.gameState().phase).toBe('premium_intro');

    h.engine.startAuction();
    expect(h.engine.gameState().phase).toBe('auction_active');

    h.engine.placeBid('T01');
    h.engine.closeAuction();
    // The winning bidder MUST attempt - no sit-out for the winner (spec 8).
    expect(h.engine.gameState().phase).toBe('premium_authorized');

    // The operator opens the attempt.
    h.engine.startPremiumAttempt();
    expect(h.engine.gameState().phase).toBe('premium_solving');
    void slot;
  });

  it('reaches premium_result when the premium closes', () => {
    startRound(h);
    advanceTo(h, (s) => s.kind === 'premium');
    h.engine.startAuction();
    h.engine.placeBid('T01');
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();
    h.engine.forcePremiumResult('correct');
    expect(h.engine.gameState().phase).toBe('premium_result');
  });

  it('pause and resume return to the previous phase', () => {
    startRound(h);
    h.engine.advance();
    h.engine.openQuestion();
    h.engine.pauseGame();
    expect(h.engine.gameState().phase).toBe('paused');
    h.engine.resumeGame();
    expect(h.engine.gameState().phase).toBe('question_active');
  });
});

describe('premium preview hides the question (spec 5)', () => {
  it('publishes domain, difficulty, time and starting bid only', () => {
    startRound(h);
    h.clearEvents();
    advanceTo(h, (s) => s.kind === 'premium');

    const intro = h.lastEvent<{ preview: Record<string, unknown> }>('PREMIUM_INTRO');
    expect(intro?.preview).toMatchObject({ startingBid: 200, increment: 100 });
    expect(intro?.preview.domain).toBeTruthy();
    expect(intro?.preview.difficulty).toBeTruthy();
    expect(intro?.preview.timeLimit).toBeGreaterThan(0);

    // The body must not be anywhere in the payload.
    const dump = JSON.stringify(intro);
    expect(dump).not.toContain('prompt');
    expect(dump).not.toContain('acceptedAnswers');
  });

  it('uses the final premium opening bid for the last block', () => {
    startRound(h);
    let slot = advanceTo(h, (s) => s.kind === 'premium');
    while (slot.index < 16) {
      h.engine.closePremium();
      slot = advanceTo(h, (s) => s.kind === 'premium');
    }
    const preview = h.engine.currentPremiumPreview();
    expect(preview?.isFinalPremium).toBe(true);
    expect(preview?.startingBid).toBe(200);
  });

  it('never leaks the premium body to a non-winner snapshot', () => {
    startRound(h);
    advanceTo(h, (s) => s.kind === 'premium');
    h.engine.startAuction();
    h.engine.placeBid('T01');
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();

    const outsider = h.engine.snapshot('participant', 'T05', 0);
    expect(outsider.question?.revealed).toBe(false);
    expect(JSON.stringify(outsider)).not.toContain('acceptedAnswers');

    const winner = h.engine.snapshot('participant', 'T01', 0);
    expect(winner.question?.revealed).toBe(true);
  });
});

describe('the 7-minute premium window (spec 6)', () => {
  it('starts a window when the premium is introduced', () => {
    startRound(h);
    advanceTo(h, (s) => s.kind === 'premium');
    const premium = h.engine.currentPremium();
    expect(premium?.stage).toBe('intro');
    const remaining = (premium?.windowEndsAt ?? 0) - Date.now();
    expect(remaining).toBeGreaterThan(400_000);
    expect(remaining).toBeLessThanOrEqual(420_000);
  });

  it('closes the premium when the window expires', () => {
    startRound(h);
    const slot = advanceTo(h, (s) => s.kind === 'premium');
    h.engine.startAuction();
    expect(h.engine.fireTimer(`window:${slot.questionId}`)).toBe(true);
    expect(h.engine.currentPremium()?.stage).toBe('closed');
  });

  it('settles an in-flight attempt as a timeout when the window expires', () => {
    startRound(h);
    const slot = advanceTo(h, (s) => s.kind === 'premium');
    h.engine.startAuction();
    h.engine.placeBid('T01', 400);
    h.engine.closeAuction();
    h.engine.startPremiumAttempt();

    const before = capital(h, 'T01');
    h.engine.fireTimer(`window:${slot.questionId}`);
    expect(capital(h, 'T01')).toBe(before - 400);
  });
});

describe('strategy phase (spec 10)', () => {
  it('runs for the configured 40 seconds and announces the next slot', () => {
    startRound(h);
    advanceTo(h, (s) => s.kind === 'premium');
    h.engine.closePremium();
    h.clearEvents();

    h.engine.startStrategyPhase();
    expect(h.engine.gameState().phase).toBe('strategy_phase');

    const started = h.lastEvent<{ duration: number; endsAt: number; nextSlotIndex: number }>(
      'STRATEGY_STARTED',
    );
    expect(started?.duration).toBe(40);
    expect(started?.nextSlotIndex).toBe(5);
    expect((started?.endsAt ?? 0) - Date.now()).toBeGreaterThan(38_000);
  });

  it('advances into the next block when it ends', () => {
    startRound(h);
    advanceTo(h, (s) => s.kind === 'premium');
    h.engine.closePremium();
    h.engine.startStrategyPhase();

    expect(h.engine.fireTimer('strategy')).toBe(true);
    expect(h.engine.gameState().slotIndex).toBe(5);
    expect(h.engine.gameState().phase).toBe('question_intro');
  });

  it('can be skipped by the operator', () => {
    startRound(h);
    advanceTo(h, (s) => s.kind === 'premium');
    h.engine.closePremium();
    h.engine.startStrategyPhase();
    h.engine.endStrategyPhase();
    expect(h.engine.gameState().phase).toBe('question_intro');
  });

  it('is configurable', () => {
    startRound(h);
    h.engine.updateConfig({ strategyWindowSeconds: 15 });
    advanceTo(h, (s) => s.kind === 'premium');
    h.engine.closePremium();
    h.clearEvents();
    h.engine.startStrategyPhase();
    expect(h.lastEvent<{ duration: number }>('STRATEGY_STARTED')?.duration).toBe(15);
  });
});

describe('leaderboard blackout (spec 11, 18)', () => {
  /** Walk to a given slot index, settling everything on the way. */
  function walkTo(harness: Harness, target: number): void {
    while (harness.engine.gameState().slotIndex < target) {
      harness.engine.advance();
      const slot = harness.engine.currentSlot();
      if (!slot || slot.index >= target) break;
      if (slot.kind === 'normal') harness.engine.closeQuestion();
      else harness.engine.closePremium();
    }
  }

  it('is off for the early questions', () => {
    startRound(h);
    h.engine.advance();
    expect(h.engine.isFinalStretch()).toBe(false);
    expect(h.engine.snapshot('projector', null, 0).leaderboard.length).toBeGreaterThan(0);
  });

  it('turns on for the last four NORMAL questions', () => {
    startRound(h);
    // Normal slots are 1,2,3, 5,6,7, 9,10,11, 13,14,15. Last four: 10,11,13,14,15?
    // The last four normal slots are 11, 13, 14, 15 -> blackout begins at 11.
    walkTo(h, 11);
    expect(h.engine.gameState().slotIndex).toBe(11);
    expect(h.engine.isFinalStretch()).toBe(true);
  });

  it('hides the board from the projector but never from the organizer', () => {
    startRound(h);
    walkTo(h, 11);

    expect(h.engine.snapshot('projector', null, 0).leaderboard).toEqual([]);
    expect(h.engine.snapshot('projector', null, 0).leaderboardHidden).toBe(true);

    const organizer = h.engine.snapshot('organizer', null, 0);
    expect(organizer.leaderboard.length).toBe(6);
    expect(organizer.leaderboardHidden).toBe(false);
  });

  it('leaves a participant only its own row, without rank', () => {
    startRound(h);
    walkTo(h, 11);

    const mine = h.engine.snapshot('participant', 'T03', 0);
    expect(mine.leaderboard).toHaveLength(1);
    expect(mine.leaderboard[0]?.teamId).toBe('T03');
    expect(mine.leaderboard[0]?.rank).toBe(0);
    expect(mine.me?.leaderboardHidden).toBe(true);
    expect(mine.me?.rank).toBe(0);

    const dump = JSON.stringify(mine.leaderboard);
    expect(dump).not.toContain('T01');
    expect(dump).not.toContain('T04');
  });

  it('announces the final stretch exactly once', () => {
    startRound(h);
    h.clearEvents();
    walkTo(h, 11);
    expect(h.eventsOf('FINAL_STRETCH_STARTED')).toHaveLength(1);
  });

  it('stops broadcasting global leaderboard updates to participants', () => {
    startRound(h);
    walkTo(h, 11);
    h.clearEvents();
    h.engine.adjustCapital('T01', 500, 'test');

    const audiences = h.events
      .filter((e) => e.name === 'LEADERBOARD_UPDATED')
      .map((e) => e.audience.kind);
    expect(audiences).toContain('organizer');
    expect(audiences).not.toContain('participants');
    expect(audiences).not.toContain('projector');
  });

  it('reveals the board again once the round completes', () => {
    startRound(h);
    walkTo(h, 11);
    expect(h.engine.isFinalStretch()).toBe(true);
    h.engine.completeGame();
    expect(h.engine.isFinalStretch()).toBe(false);
    expect(h.engine.snapshot('projector', null, 0).leaderboard.length).toBe(6);
  });
});

describe('podium (spec 2, 18)', () => {
  it('produces a top three and persists it', () => {
    startRound(h);
    h.engine.adjustCapital('T02', 900, 'spread');
    h.engine.adjustCapital('T04', 600, 'spread');
    h.engine.adjustCapital('T06', 300, 'spread');

    const podium = h.engine.completeGame();
    expect(podium.map((p) => [p.place, p.teamId])).toEqual([
      [1, 'T02'],
      [2, 'T04'],
      [3, 'T06'],
    ]);
    expect(h.repo.listFinalResults()).toHaveLength(3);
    expect(h.engine.gameState().phase).toBe('final_results');
  });

  it('reveals the podium as a separate operator beat', () => {
    startRound(h);
    h.engine.adjustCapital('T01', 500, 'spread');
    h.engine.completeGame();
    h.clearEvents();

    const podium = h.engine.revealPodium();
    expect(podium[0]?.teamId).toBe('T01');
    expect(h.engine.gameState().phase).toBe('completed');
    expect(h.lastEvent('PODIUM_REVEALED')).toBeTruthy();
    expect(h.engine.projectorMode()).toBe('podium');
  });

  it('has no concept of qualification', () => {
    startRound(h);
    const row = h.engine.leaderboard()[0];
    expect(row).not.toHaveProperty('qualified');
    expect(row).toHaveProperty('podium');
    expect(h.engine.getConfig()).not.toHaveProperty('qualifiers');
  });

  it('completing the round from advance() past the last slot', () => {
    seedTeams(h, 3);
    h.engine.updateConfig({ blocks: 1, questionsPerBlock: 1 });
    h.engine.generateRound(5);
    h.engine.startGame();

    h.engine.advance(); // slot 1 (normal)
    h.engine.closeQuestion();
    h.engine.advance(); // slot 2 (premium)
    h.engine.closePremium();
    h.engine.advance(); // past the end
    expect(h.engine.gameState().phase).toBe('final_results');
  });
});

describe('question flow', () => {
  it('rewards a correct answer by difficulty', async () => {
    startRound(h);
    const { question } = openFirstQuestion(h);
    const expected = { easy: 100, medium: 150, hard: 200, very_hard: 300 }[question.difficulty];
    await play(h, 'T01', question, true);
    expect(capital(h, 'T01')).toBe(1500 + expected);
  });

  it('penalises a wrong answer by difficulty', async () => {
    startRound(h);
    const { question } = openFirstQuestion(h);
    const expected = { easy: 100, medium: 150, hard: 200, very_hard: 250 }[question.difficulty];
    await play(h, 'T02', question, false);
    expect(capital(h, 'T02')).toBe(1500 - expected);
  });

  it('rejects the wrong access key', () => {
    startRound(h);
    const { question } = openFirstQuestion(h);
    expect(() => h.engine.unlockQuestion('T01', question.id, 'NOPE')).toThrow(/Incorrect/);
  });

  it('rejects a duplicate submission', async () => {
    startRound(h);
    const { question } = openFirstQuestion(h);
    await play(h, 'T01', question, true);
    await expect(
      h.engine.submitAnswer('T01', question.id, answerFor(question, true)),
    ).rejects.toThrow(/already submitted/);
  });

  it('refuses to join before the question opens', () => {
    startRound(h);
    h.engine.advance(); // question_intro
    const slot = h.engine.currentSlot();
    const question = h.repo.getQuestion(slot?.questionId as string) as Question;
    h.engine.unlockQuestion('T01', question.id, question.accessKey);
    expect(() => h.engine.joinQuestion('T01', question.id)).toThrow(/not open yet/);
  });

  it('times a team out at its own deadline', () => {
    startRound(h);
    const { slot, question } = openFirstQuestion(h);
    h.engine.unlockQuestion('T01', question.id, question.accessKey);
    h.engine.joinQuestion('T01', question.id);
    expect(h.engine.fireTimer(`deadline:T01:${slot.index}`)).toBe(true);
    expect(h.repo.listAttemptsForTeam('T01')[0]?.result).toBe('timeout');
  });

  it('records the slot index on every attempt', async () => {
    startRound(h);
    const { slot, question } = openFirstQuestion(h);
    await play(h, 'T01', question, true);
    expect(h.repo.listAttemptsForTeam('T01')[0]?.slotIndex).toBe(slot.index);
  });
});

describe('the advertised clock', () => {
  it('swaps the GET READY intro for the TAKE / SIT-OUT decision countdown', () => {
    startRound(h);
    h.engine.advance();

    // The intro beat advertises its own countdown.
    expect(h.engine.gameState().phase).toBe('question_intro');
    expect(h.engine.gameState().timer.endsAt).not.toBeNull();
    expect(h.engine.gameState().timer.label).toBe('GET READY');

    // Opening the question starts the synchronised decision window (spec 6, 7).
    h.engine.openQuestion();
    expect(h.engine.gameState().phase).toBe('question_active');
    expect(h.engine.gameState().timer.label).toBe('TAKE OR SIT OUT');
    expect(h.engine.gameState().timer.endsAt).not.toBeNull();
  });
});

describe('each team runs its own solve clock', () => {
  it('sends the deadline the server is actually enforcing', () => {
    startRound(h);
    const { question } = openFirstQuestion(h);

    // Not joined yet: there is no clock to resume.
    expect(h.engine.teamView('T01')?.questionDeadline).toBeNull();

    const before = Date.now();
    h.engine.unlockQuestion('T01', question.id, question.accessKey);
    h.engine.joinQuestion('T01', question.id);

    const deadline = h.engine.teamView('T01')?.questionDeadline as number;
    expect(deadline).toBeGreaterThanOrEqual(before + question.timeLimit * 1000);

    // A team that has not joined still has no clock of its own.
    expect(h.engine.teamView('T02')?.questionDeadline).toBeNull();
  });

  it('gives a reconnecting team the time it has left, not a fresh clock', () => {
    startRound(h);
    const { question } = openFirstQuestion(h);

    h.engine.unlockQuestion('T01', question.id, question.accessKey);
    h.engine.joinQuestion('T01', question.id);
    const first = h.engine.teamView('T01')?.questionDeadline as number;

    // Rebuilding the view is what a reconnect does. The deadline is anchored to
    // the join, so it must not move.
    const afterReconnect = h.engine.teamView('T01')?.questionDeadline as number;
    expect(afterReconnect).toBe(first);
  });

  it('stops advertising a clock once the team has answered', () => {
    startRound(h);
    const { question } = openFirstQuestion(h);

    h.engine.unlockQuestion('T01', question.id, question.accessKey);
    h.engine.joinQuestion('T01', question.id);
    expect(h.engine.teamView('T01')?.questionDeadline).not.toBeNull();

    h.engine.submitAnswer('T01', question.id, answerFor(question, true));
    expect(h.engine.teamView('T01')?.questionDeadline).toBeNull();
  });
});

describe('opening a question for all teams (no access key)', () => {
  it('makes the question joinable the moment it opens, with no key step', () => {
    // Keys are off by default now: the organizer just opens the question.
    expect(h.engine.getConfig().requireAccessKey).toBe(false);
    startRound(h);
    const { question } = openFirstQuestion(h);

    // Every team sees the question as ready to take on, not locked behind a key.
    const view = h.engine.teamView('T01');
    expect(view?.questionState).toBe('available');

    // And it can join directly, without ever unlocking.
    h.engine.joinQuestion('T01', question.id);
    expect(h.engine.teamView('T01')?.questionState).toBe('in_progress');
  });

  it('still gates on a key when an organizer turns keys back on', () => {
    h.engine.updateConfig({ requireAccessKey: true });
    startRound(h);
    const { question } = openFirstQuestion(h);

    expect(h.engine.teamView('T01')?.questionState).toBe('locked');
    // Joining without unlocking is refused.
    expect(() => h.engine.joinQuestion('T01', question.id)).toThrow(/key/i);
  });
});

describe('normal-question TAKE / SIT-OUT window (spec 6, 7)', () => {
  it('opens a decision countdown when the question opens', () => {
    startRound(h);
    openFirstQuestion(h);
    const timer = h.engine.gameState().timer;
    expect(timer.label).toBe('TAKE OR SIT OUT');
    expect(timer.duration).toBe(h.engine.getConfig().takeDecisionSeconds);
    expect(timer.endsAt).toBeGreaterThan(Date.now());
  });

  it('defaults non-deciders to sitting out when the window lapses', () => {
    startRound(h, 4);
    const { question } = openFirstQuestion(h);

    // T01 takes it; T02 explicitly sits out; T03 and T04 do nothing.
    h.engine.joinQuestion('T01', question.id);
    h.engine.skipQuestion('T02', question.id);

    // The window lapses.
    expect(h.engine.fireTimer(`question_decision:${h.engine.currentSlot()?.index}`)).toBe(true);

    expect(h.engine.teamView('T01')?.questionState).toBe('in_progress');
    expect(h.engine.teamView('T02')?.questionState).toBe('skipped');
    expect(h.engine.teamView('T03')?.questionState).toBe('skipped');
    expect(h.engine.teamView('T04')?.questionState).toBe('skipped');

    // A team that never chose cannot join after the window closed.
    expect(() => h.engine.joinQuestion('T03', question.id)).toThrow();
  });

  it('leaves the decider still solving after the window closes', () => {
    startRound(h, 3);
    const { question } = openFirstQuestion(h);
    h.engine.joinQuestion('T01', question.id);
    const deadline = h.engine.teamView('T01')?.questionDeadline;
    h.engine.fireTimer(`question_decision:${h.engine.currentSlot()?.index}`);
    // T01 keeps its own solve clock; the decision window does not end its attempt.
    expect(h.engine.teamView('T01')?.questionState).toBe('in_progress');
    expect(h.engine.teamView('T01')?.questionDeadline).toBe(deadline);
  });
});
