/**
 * The decision screen: enter the access key, then commit.
 *
 * The question body is deliberately NOT shown until the team commits - what
 * they see first is the domain, the difficulty, the reward and the penalty.
 * That is the strategic choice the round is built on.
 */

import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { money } from '../lib/format.js';
import { domainLabel, blockLabel, difficultyLabel, typeLabel } from '../lib/format.js';
import { scaleIn } from '../lib/motion.js';
import { sound } from '../lib/sound.js';
import { LockIcon, UnlockIcon } from '../ui/Icons.js';
import { Countdown } from '../ui/Countdown.js';

export function QuestionScreen() {
  const question = useStore((s) => s.question);
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const game = useStore((s) => s.game);
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);

  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justUnlocked, setJustUnlocked] = useState(false);

  if (!question || !me) return null;

  const unlocked = me.questionState === 'available';
  const skipped = me.questionState === 'skipped';
  const symbol = config.currencySymbol;
  // Stake model: taking the question deducts the stake now; a correct answer
  // pays it back as `payout`; a wrong answer forfeits the stake. The team must
  // hold the stake to take it (the server enforces this too).
  const stake = question.stake ?? question.penalty ?? 0;
  const payout = question.reward ?? 0;
  const canAfford = stake === 0 || me.capital >= stake;

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (busy || !question) return;
    setBusy(true);
    setError(null);
    try {
      await call('UNLOCK_QUESTION', { questionId: question.id, accessKey: key.trim() });
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
    if (!question) return;
    setBusy(true);
    try {
      await call('JOIN_QUESTION', { questionId: question.id });
    } catch (err) {
      pushToast({ kind: 'warn', title: err instanceof Error ? err.message : 'Could not join' });
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (!question) return;
    setBusy(true);
    try {
      await call('SKIP_QUESTION', { questionId: question.id });
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
          <div className="eyebrow">{blockLabel(question.blockNumber, question.positionInBlock, config.questionsPerBlock)}</div>
          <h2 className="screen__title">You sat this one out</h2>
          <p className="muted">
            No capital was risked. The next question opens here automatically.
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
        className={`q-card panel ${unlocked ? 'q-card--open' : ''}`}
        animate={justUnlocked ? { scale: [1, 1.02, 1] } : { scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="q-card__head">
          <div>
            <div className="eyebrow">{blockLabel(question.blockNumber, question.positionInBlock, config.questionsPerBlock)}</div>
            <h2 className="q-card__title">{question.title}</h2>
          </div>
          <motion.div
            className="q-card__lock"
            data-unlocked={unlocked}
            animate={unlocked ? { rotate: [0, -14, 0], scale: [1, 1.12, 1] } : {}}
            transition={{ duration: 0.5 }}
            aria-hidden="true"
          >
            {unlocked ? <UnlockIcon /> : <LockIcon />}
          </motion.div>
        </div>

        <div className="q-card__meta">
          <span className="badge badge--accent">{domainLabel(question.domain)}</span>
          <span className="badge">{typeLabel(question.type)}</span>
          <span className="badge" data-difficulty={question.difficulty}>
            {difficultyLabel(question.difficulty)}
          </span>
          <span className="badge">{question.timeLimit}s</span>
        </div>

        <div className="q-card__stakes">
          <div className="stake">
            <span className="stake__label">Stake to take</span>
            <span className="stake__value num">{money(stake, symbol)}</span>
          </div>
          <div className="stake stake--gain">
            <span className="stake__label">If correct</span>
            <span className="stake__value num">+{money(payout, symbol)}</span>
          </div>
          <div className="stake stake--loss">
            <span className="stake__label">If wrong or timed out</span>
            <span className="stake__value num">
              {stake > 0 ? `-${money(stake, symbol)}` : 'No stake'}
            </span>
          </div>
        </div>

        {!unlocked ? (
          <motion.form
            key="key-form"
            onSubmit={unlock}
            className="q-card__unlock"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
              <label className="label" htmlFor="question-key">
                Enter the question key
              </label>
              <div className="q-card__key-row">
                <input
                  id="question-key"
                  className="input input--key"
                  value={key}
                  onChange={(event) => setKey(event.target.value.toUpperCase())}
                  placeholder="Q-0000"
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
                  className="q-card__error"
                  initial={{ x: 0 }}
                  animate={{ x: [0, -7, 7, -4, 0] }}
                  transition={{ duration: 0.32 }}
                  role="alert"
                >
                  {error}
                </motion.p>
              ) : (
                <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                  The key is announced by the organizer when the question opens.
                </p>
              )}
            </motion.form>
        ) : (
          <motion.div
            key="decision"
            className="q-card__decision"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
              <div className="q-card__decision-copy">
                <h3 className="q-card__decision-title">Commit to this question?</h3>
                <p className="muted">
                  {!canAfford
                    ? `You need at least ${money(stake, symbol)} to take this — taking it stakes ${money(stake, symbol)}, and your capital is ${money(me.capital, symbol)}.`
                    : config.questionOptIn
                      ? `Taking it stakes ${money(stake, symbol)} now; a correct answer pays ${money(payout, symbol)} back. Sitting out costs nothing.`
                      : 'Start the question when you are ready.'}
                </p>
              </div>
              <div className="q-card__actions">
                {config.questionOptIn ? (
                  <button className="btn btn--ghost btn--lg" onClick={skip} disabled={busy}>
                    Sit out
                  </button>
                ) : null}
                <button
                  className="btn btn--gain btn--xl"
                  onClick={join}
                  disabled={busy || !canAfford}
                  autoFocus={canAfford}
                  title={canAfford ? undefined : `Not enough capital — you need at least ${money(stake, symbol)}`}
                >
                  Take it on
                </button>
              </div>
              {game?.timer.endsAt && game.timer.label === 'TAKE OR SIT OUT' ? (
                <div className="q-card__decide-timer">
                  <Countdown
                    endsAt={game.timer.endsAt}
                    duration={game.timer.duration}
                    label="Decide within"
                    size="md"
                    tick
                  />
                  <p className="dim" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center' }}>
                    No choice before the timer ends counts as sitting out.
                  </p>
                </div>
              ) : null}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
