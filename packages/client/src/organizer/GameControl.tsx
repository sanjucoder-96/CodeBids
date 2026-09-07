/**
 * Game control: the generated round and the operator's forward drive.
 *
 * The whole round is one list of slots. The operator's primary action is a
 * single ADVANCE button whose label always names exactly what happens next, so
 * running the event never requires remembering the state machine.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import type { GamePhase } from '@code-market/shared';
import { PHASE_LABELS } from '@code-market/shared';
import { useStore } from '../lib/store.js';
import { Countdown } from '../ui/Countdown.js';
import { difficultyLabel, domainLabel, slotLabel } from '../lib/format.js';
import { ArrowRightIcon, EyeOffIcon } from '../ui/Icons.js';

export function GameControl() {
  const game = useStore((s) => s.game);
  const sequence = useStore((s) => s.sequence);
  const config = useStore((s) => s.config);
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  async function act(command: string, payload: unknown = {}) {
    setBusy(true);
    try {
      await call(command, payload);
    } catch (error) {
      pushToast({ kind: 'warn', title: error instanceof Error ? error.message : 'Command failed' });
    } finally {
      setBusy(false);
    }
  }

  const phase = (game?.phase ?? 'idle') as GamePhase;
  const paused = phase === 'paused';
  const current = game?.slotIndex ?? 0;
  const currentSlot = sequence.find((s) => s.index === current);
  const nextSlot = sequence.find((s) => s.index === current + 1);

  /** The single most useful next action, named literally. */
  const primary = (() => {
    if (phase === 'idle') {
      return nextSlot
        ? { label: `Open ${slotLabel(nextSlot.blockNumber, nextSlot.positionInBlock, nextSlot.kind)}`, cmd: 'ADVANCE' }
        : { label: 'Start round', cmd: 'START_GAME' };
    }
    if (phase === 'question_intro') return { label: 'Open for all teams', cmd: 'OPEN_QUESTION' };
    if (phase === 'question_active') return { label: 'Close the question', cmd: 'CLOSE_QUESTION' };
    if (phase === 'premium_intro') return { label: 'Start the auction', cmd: 'START_AUCTION' };
    if (phase === 'premium_decision') return { label: 'Skip to the attempt', cmd: 'START_PREMIUM_ATTEMPT' };
    if (phase === 'premium_authorized') return { label: 'Start attempt', cmd: 'START_PREMIUM_ATTEMPT' };
    if (phase === 'premium_result') return { label: 'Start strategy phase', cmd: 'START_STRATEGY' };
    if (phase === 'strategy_phase') return { label: 'Skip to next block', cmd: 'SKIP_STRATEGY' };
    if (phase === 'question_result') {
      return nextSlot
        ? { label: `Next: ${slotLabel(nextSlot.blockNumber, nextSlot.positionInBlock, nextSlot.kind)}`, cmd: 'ADVANCE' }
        : { label: 'Finish the round', cmd: 'COMPLETE_GAME' };
    }
    if (phase === 'final_results') return { label: 'Reveal the podium', cmd: 'REVEAL_PODIUM' };
    return null;
  })();

  const done = sequence.filter((s) => s.state === 'complete').length;
  const progress = sequence.length > 0 ? Math.round((done / sequence.length) * 100) : 0;

  return (
    <section className="panel panel--flush">
      <div className="panel__head">
        <span className="panel__title">
          Round {config.roundNumber} control
          {currentSlot
            ? ` · ${slotLabel(currentSlot.blockNumber, currentSlot.positionInBlock, currentSlot.kind)}`
            : ''}
        </span>
        <div className="row">
          {game?.finalStretch ? (
            <span className="badge badge--premium" title="Leaderboard hidden from projector and teams">
              <EyeOffIcon size={12} /> FINAL STRETCH
            </span>
          ) : null}
          {game?.timer.endsAt ? (
            <Countdown
              endsAt={game.timer.endsAt}
              duration={game.timer.duration}
              label={game.timer.label}
              size="sm"
            />
          ) : null}
          <span className="badge" data-phase={phase}>
            {PHASE_LABELS[phase] ?? phase}
          </span>
        </div>
      </div>

      <div className="panel__body stack">
        {/* --- the one button that matters ------------------------------ */}
        {primary ? (
          <button
            className="btn btn--primary btn--xl btn--block gc__primary"
            onClick={() => act(primary.cmd)}
            disabled={busy || paused}
          >
            {primary.label}
            <ArrowRightIcon size={20} />
          </button>
        ) : null}

        <div className="row wrap">
          {primary?.cmd === 'START_GAME' ? null : (
            <button className="btn" onClick={() => act('START_GAME')} disabled={busy}>
              Start round
            </button>
          )}
          {paused ? (
            <button className="btn btn--gain" onClick={() => act('RESUME_GAME')} disabled={busy}>
              Resume
            </button>
          ) : (
            <button className="btn" onClick={() => act('PAUSE_GAME')} disabled={busy}>
              Pause
            </button>
          )}
          <button className="btn" onClick={() => act('ADVANCE')} disabled={busy || paused}>
            Advance
          </button>
          <button className="btn btn--ghost" onClick={() => act('STOP_TIMER')} disabled={busy}>
            Stop timer
          </button>
          <button className="btn btn--ghost" onClick={() => act('COMPLETE_GAME')} disabled={busy}>
            Complete round
          </button>
          {confirmReset ? (
            <>
              <button
                className="btn btn--loss"
                onClick={async () => {
                  await act('RESET_GAME', { keepTeams: true });
                  setConfirmReset(false);
                }}
                disabled={busy}
              >
                Confirm reset (keep teams)
              </button>
              <button className="btn btn--ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn btn--ghost" onClick={() => setConfirmReset(true)} disabled={busy}>
              Reset round
            </button>
          )}
        </div>

        {/* --- the generated round -------------------------------------- */}
        <div>
          <div className="row-between" style={{ marginBottom: 'var(--sp-2)' }}>
            <span className="label">
              Round sequence · {config.blocks} blocks of {config.questionsPerBlock} + premium
            </span>
            <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              {done}/{sequence.length} complete
            </span>
          </div>

          <div className="gc__progress" aria-hidden="true">
            <motion.div
              className="gc__progress-bar"
              initial={{ width: '0%' }}
              animate={{ width: `${progress}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 30 }}
            />
          </div>

          {sequence.length === 0 ? (
            <div className="empty-state">
              <p className="muted">The round has not been generated yet.</p>
              <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                Start the round to draw three random questions before each premium.
              </p>
            </div>
          ) : (
            <div className="seq">
              {sequence.map((slot) => (
                <motion.button
                  key={slot.index}
                  className="seq__item"
                  data-kind={slot.kind}
                  data-state={slot.state}
                  data-active={slot.index === current}
                  data-blackout={slot.inFinalStretch}
                  onClick={() => act('OPEN_SLOT', { slotIndex: slot.index })}
                  disabled={busy}
                  whileTap={{ scale: 0.97 }}
                  title={`${slot.title} · ${domainLabel(slot.domain)} · ${difficultyLabel(slot.difficulty)} · ${slot.timeLimit}s`}
                >
                  <span className="seq__num num">{slot.index}</span>
                  <span className="seq__kind">
                    {slot.kind === 'premium'
                      ? slot.isFinalPremium
                        ? 'FINAL'
                        : 'PREM'
                      : `Q${slot.positionInBlock}`}
                  </span>
                  <span className="seq__domain">{domainLabel(slot.domain)}</span>
                  <span className="seq__diff" data-difficulty={slot.difficulty}>
                    {difficultyLabel(slot.difficulty)}
                  </span>
                  <span className="seq__time dim">{slot.timeLimit}s</span>
                </motion.button>
              ))}
            </div>
          )}

          <p className="dim" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-2)' }}>
            Three questions are drawn at random before every premium. Keys are on the Questions
            panel; premium winners are authorised automatically over the LAN.
          </p>
        </div>

        {/* --- projector ------------------------------------------------- */}
        <div className="row wrap">
          <span className="label">Projector</span>
          {(['auto', 'leaderboard', 'question', 'auction', 'reclaim', 'strategy', 'final_stretch', 'podium'] as const).map(
            (mode) => (
              <button
                key={mode}
                className="btn btn--sm btn--ghost"
                onClick={() => act('SET_PROJECTOR_MODE', { mode })}
                disabled={busy}
              >
                {mode.replace(/_/g, ' ')}
              </button>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
