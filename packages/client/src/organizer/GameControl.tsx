/**
 * Game control: the round sequence and the global controls (spec section 30).
 * The challenge strip is the operator's map of the whole round.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Countdown } from '../ui/Countdown.js';
import { challengeLabel } from '../lib/format.js';

export function GameControl() {
  const game = useStore((s) => s.game);
  const challengeIndex = useStore((s) => s.challengeIndex);
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

  const paused = game?.phase === 'paused';
  const current = game?.currentChallengeId;

  return (
    <section className="panel panel--flush">
      <div className="panel__head">
        <span className="panel__title">Game control</span>
        <div className="row">
          {game?.timer.endsAt ? (
            <Countdown
              endsAt={game.timer.endsAt}
              duration={game.timer.duration}
              label={game.timer.label}
              size="sm"
            />
          ) : null}
          <span className="badge" data-phase={game?.phase}>
            {(game?.phase ?? 'lobby').replace(/_/g, ' ').toUpperCase()}
          </span>
        </div>
      </div>

      <div className="panel__body stack">
        <div className="row wrap">
          <button className="btn btn--primary" onClick={() => act('START_GAME')} disabled={busy}>
            Start round
          </button>
          {paused ? (
            <button className="btn btn--gain" onClick={() => act('RESUME_GAME')} disabled={busy}>
              Resume
            </button>
          ) : (
            <button className="btn" onClick={() => act('PAUSE_GAME')} disabled={busy}>
              Pause
            </button>
          )}
          <button className="btn" onClick={() => act('STOP_TIMER')} disabled={busy}>
            Stop timer
          </button>
          <button
            className="btn"
            onClick={() => act('START_TIMER', { seconds: 60, label: 'MARKET' })}
            disabled={busy}
          >
            +60s timer
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

        <div>
          <span className="label">Round sequence</span>
          <div className="seq">
            {challengeIndex.map((challenge) => {
              const active = challenge.id === current;
              return (
                <motion.button
                  key={challenge.id}
                  className="seq__item"
                  data-type={challenge.marketType}
                  data-state={challenge.state}
                  data-active={active}
                  onClick={() => act('OPEN_CHALLENGE', { challengeId: challenge.id })}
                  disabled={busy}
                  whileTap={{ scale: 0.97 }}
                  title={`${challenge.title} — key ${challenge.accessKey}`}
                >
                  <span className="seq__num num">{String(challenge.index).padStart(2, '0')}</span>
                  <span className="seq__type">
                    {challenge.marketType === 'final_premium'
                      ? 'FINAL'
                      : challenge.marketType === 'premium'
                        ? 'PREM'
                        : 'MKT'}
                  </span>
                  <span className="seq__key mono">{challenge.accessKey}</span>
                  <span className="seq__stats dim">
                    {challenge.attempts > 0 ? `${challenge.correct}/${challenge.attempts}` : '—'}
                  </span>
                </motion.button>
              );
            })}
          </div>
          <p className="dim" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-2)' }}>
            Read the key aloud when you open a market challenge. Premium keys are only a fallback —
            the winner is authorised automatically over the LAN.
          </p>
        </div>

        {current ? (
          <div className="row wrap">
            <span className="badge badge--accent">
              OPEN: {challengeLabel(
                challengeIndex.find((c) => c.id === current)?.index ?? 0,
                challengeIndex.find((c) => c.id === current)?.marketType ?? 'market',
              )}
            </span>
            <button
              className="btn btn--sm"
              onClick={() => act('CLOSE_CHALLENGE', { challengeId: current })}
              disabled={busy}
            >
              Close challenge
            </button>
            <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              Closing resolves anyone still mid-attempt as a timeout.
            </span>
          </div>
        ) : null}

        <div className="row wrap">
          <span className="label">Projector</span>
          {(['auto', 'leaderboard', 'auction', 'reclaim', 'final'] as const).map((mode) => (
            <button
              key={mode}
              className="btn btn--sm btn--ghost"
              onClick={() => act('SET_PROJECTOR_MODE', { mode })}
              disabled={busy}
            >
              {mode}
            </button>
          ))}
          <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
            Auto follows the round. Qualification line at top {config.qualifiers}.
          </span>
        </div>
      </div>
    </section>
  );
}
