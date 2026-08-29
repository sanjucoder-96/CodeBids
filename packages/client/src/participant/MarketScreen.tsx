/**
 * The market screen: enter the access key, then make the risk decision
 * (spec sections 9, 10, 22).
 *
 * The question body is deliberately NOT shown until the team commits - what
 * they see first is the category, the difficulty, the reward and the penalty.
 * That is the strategic choice the round is built on.
 */

import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { money } from '../lib/format.js';
import { categoryLabel, challengeLabel, typeLabel } from '../lib/format.js';
import { scaleIn } from '../lib/motion.js';
import { sound } from '../lib/sound.js';
import { LockIcon, UnlockIcon } from '../ui/Icons.js';

export function MarketScreen() {
  const challenge = useStore((s) => s.challenge);
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);

  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justUnlocked, setJustUnlocked] = useState(false);

  if (!challenge || !me) return null;

  const unlocked = me.challengeState === 'available' || me.challengeState === 'joined';
  const skipped = me.challengeState === 'skipped';
  const symbol = config.currencySymbol;

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (busy || !challenge) return;
    setBusy(true);
    setError(null);
    try {
      await call('UNLOCK_CHALLENGE', { challengeId: challenge.id, accessKey: key.trim() });
      sound.play('premium_unlock');
      setJustUnlocked(true);
      setTimeout(() => setJustUnlocked(false), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect key');
      sound.play('wrong');
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!challenge) return;
    setBusy(true);
    try {
      await call('JOIN_CHALLENGE', { challengeId: challenge.id });
    } catch (err) {
      pushToast({ kind: 'warn', title: err instanceof Error ? err.message : 'Could not join' });
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (!challenge) return;
    setBusy(true);
    try {
      await call('SKIP_CHALLENGE', { challengeId: challenge.id });
      pushToast({ kind: 'info', title: 'Sat this one out', detail: 'No capital risked.' });
    } catch (err) {
      pushToast({ kind: 'warn', title: err instanceof Error ? err.message : 'Could not skip' });
    } finally {
      setBusy(false);
    }
  }

  if (skipped) {
    return (
      <div className="screen screen--center">
        <motion.div className="panel panel--pad" variants={scaleIn} initial="hidden" animate="show">
          <div className="eyebrow">{challengeLabel(challenge.index, challenge.marketType)}</div>
          <h2 className="screen__title">You sat this one out</h2>
          <p className="muted">
            No capital was risked. The next challenge will open here automatically.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="screen">
      {/*
        Deliberately NOT a variant tree.

        Nesting variant-driven children (especially a height 0 -> auto reveal)
        inside a variant-driven parent proved fragile: when the child's variant
        did not resolve, the form stayed at height 0 inside an overflow:hidden
        container, which left the key input rendered but unclickable. A
        participant who cannot type their key is a dead round, so this screen
        animates with explicit values only and never gates an interactive
        control behind an animation completing.
      */}
      <motion.div
        className={`market-card panel ${unlocked ? 'market-card--open' : ''}`}
        animate={justUnlocked ? { scale: [1, 1.02, 1] } : { scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="market-card__head">
          <div>
            <div className="eyebrow">{challengeLabel(challenge.index, challenge.marketType)}</div>
            <h2 className="market-card__title">{challenge.title}</h2>
          </div>
          <motion.div
            className="market-card__lock"
            data-unlocked={unlocked}
            animate={unlocked ? { rotate: [0, -14, 0], scale: [1, 1.12, 1] } : {}}
            transition={{ duration: 0.5 }}
            aria-hidden="true"
          >
            {unlocked ? <UnlockIcon /> : <LockIcon />}
          </motion.div>
        </div>

        <div className="market-card__meta">
          <span className="badge badge--accent">{categoryLabel(challenge.category)}</span>
          <span className="badge">{typeLabel(challenge.type)}</span>
          <span className="badge" data-difficulty={challenge.difficulty}>
            {challenge.difficulty.toUpperCase()}
          </span>
          <span className="badge">{challenge.timeLimit}s</span>
        </div>

        <div className="market-card__stakes">
          <div className="stake stake--gain">
            <span className="stake__label">If correct</span>
            <span className="stake__value num">+{money(challenge.reward ?? 0, symbol)}</span>
          </div>
          <div className="stake stake--loss">
            <span className="stake__label">If wrong or timed out</span>
            <span className="stake__value num">
              {(challenge.penalty ?? 0) > 0 ? `-${money(challenge.penalty ?? 0, symbol)}` : 'No penalty'}
            </span>
          </div>
          <div className="stake">
            <span className="stake__label">Your capital</span>
            <span className="stake__value num">{money(me.capital, symbol)}</span>
          </div>
        </div>

        {!unlocked ? (
          <motion.form
            key="key-form"
            onSubmit={unlock}
            className="market-card__unlock"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
              <label className="label" htmlFor="challenge-key">
                Enter the challenge key
              </label>
              <div className="market-card__key-row">
                <input
                  id="challenge-key"
                  className="input input--key"
                  value={key}
                  onChange={(event) => setKey(event.target.value.toUpperCase())}
                  placeholder="MKT-0000"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={16}
                  autoFocus
                />
                <button
                  className="btn btn--primary btn--lg"
                  type="submit"
                  disabled={busy || key.trim().length === 0}
                >
                  Unlock
                </button>
              </div>
              {error ? (
                <motion.p
                  className="market-card__error"
                  initial={{ x: 0 }}
                  animate={{ x: [0, -7, 7, -4, 0] }}
                  transition={{ duration: 0.32 }}
                  role="alert"
                >
                  {error}
                </motion.p>
              ) : (
                <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                  The key is announced by the organizer when the challenge opens.
                </p>
              )}
            </motion.form>
        ) : (
          <motion.div
            key="decision"
            className="market-card__decision"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
              <div className="market-card__decision-copy">
                <h3 className="market-card__decision-title">Take the trade?</h3>
                <p className="muted">
                  {config.marketOptIn
                    ? 'Joining starts your clock and reveals the question. Sitting out costs nothing.'
                    : 'Start the challenge when you are ready.'}
                </p>
              </div>
              <div className="market-card__actions">
                {config.marketOptIn ? (
                  <button className="btn btn--ghost btn--lg" onClick={skip} disabled={busy}>
                    Sit out
                  </button>
                ) : null}
                <button className="btn btn--gain btn--xl" onClick={join} disabled={busy} autoFocus>
                  Enter the trade
                </button>
              </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
