/**
 * The live challenge screen. One question, one clock, one submit.
 *
 * The clock is server-authoritative: the deadline is derived from the join
 * timestamp on the server, and a late submission is rejected there too - the
 * client timer is a display, not a gate.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { isAnswerComplete, isPremiumType, type SubmissionValue } from '@code-market/shared';
import { useStore } from '../lib/store.js';
import { AnswerInput } from './AnswerInputs.js';
import { Countdown } from '../ui/Countdown.js';
import { challengeLabel, categoryLabel, money, typeLabel } from '../lib/format.js';
import { fadeUp } from '../lib/motion.js';

export function ChallengeScreen() {
  const challenge = useStore((s) => s.challenge);
  const me = useStore((s) => s.me);
  const game = useStore((s) => s.game);
  const symbol = useStore((s) => s.config.currencySymbol);
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);
  const serverNow = useStore((s) => s.serverNow);

  const [answer, setAnswer] = useState<SubmissionValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A new challenge must never inherit the previous answer.
  useEffect(() => {
    setAnswer(null);
    setConfirming(false);
  }, [challenge?.id]);

  const deadline = useMemo(() => {
    if (!challenge) return null;
    if (game?.timer.endsAt) return game.timer.endsAt;
    return serverNow() + challenge.timeLimit * 1000;
    // Recomputed only when the challenge changes; the countdown ticks itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge?.id, game?.timer.endsAt]);

  if (!challenge || !me) return null;

  const premium = isPremiumType(challenge.marketType);
  const complete = isAnswerComplete(challenge.type, answer, {
    items: challenge.question.items?.length,
    pairs: challenge.question.left?.length,
  });

  async function submit() {
    if (!answer || busy || !challenge) return;
    setBusy(true);
    try {
      await call('SUBMIT_ANSWER', { challengeId: challenge.id, submission: answer });
    } catch (error) {
      pushToast({
        kind: 'warn',
        title: error instanceof Error ? error.message : 'Submission failed',
      });
      setBusy(false);
      setConfirming(false);
    }
  }

  const risk = premium ? (me.premiumRisk ?? 0) : (challenge.penalty ?? 0);
  const gain = premium ? (me.premiumRisk ?? 0) : (challenge.reward ?? 0);

  return (
    <div className={`screen challenge ${premium ? 'challenge--premium' : ''}`}>
      <div className="challenge__bar">
        <div className="challenge__ident">
          <span className={`eyebrow ${premium ? 'premium-text' : ''}`}>
            {challengeLabel(challenge.index, challenge.marketType)}
          </span>
          <h2 className="challenge__title">{challenge.title}</h2>
          <div className="row wrap" style={{ gap: 'var(--sp-2)' }}>
            <span className="badge badge--accent">{categoryLabel(challenge.category)}</span>
            <span className="badge">{typeLabel(challenge.type)}</span>
            <span className="badge">{challenge.difficulty.toUpperCase()}</span>
          </div>
        </div>

        <div className="challenge__stakes">
          <div className="stake stake--gain">
            <span className="stake__label">Win</span>
            <span className="stake__value num">+{money(gain, symbol)}</span>
          </div>
          <div className="stake stake--loss">
            <span className="stake__label">Lose</span>
            <span className="stake__value num">{risk > 0 ? `-${money(risk, symbol)}` : '—'}</span>
          </div>
        </div>

        <Countdown endsAt={deadline} duration={challenge.timeLimit} label="Time left" size="lg" tick />
      </div>

      <motion.div className="challenge__body" variants={fadeUp} initial="hidden" animate="show">
        <div className="panel panel--pad challenge__question">
          <p className="challenge__prompt">{challenge.question.prompt}</p>
          {challenge.question.code ? (
            <pre className="code-block" tabIndex={0} aria-label="Code listing">
              {challenge.question.code}
            </pre>
          ) : null}
          {challenge.question.hint ? (
            <p className="challenge__hint">
              <span className="label">Hint</span> {challenge.question.hint}
            </p>
          ) : null}
        </div>

        <div className="panel panel--pad challenge__answer">
          <AnswerInput
            challenge={challenge}
            value={answer}
            onChange={setAnswer}
            disabled={busy || me.challengeState === 'submitted'}
          />

          <div className="challenge__submit">
            {confirming ? (
              <motion.div
                className="challenge__confirm"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <p className="muted">
                  Submit final answer? You cannot change it, and {risk > 0 ? `a wrong answer costs ${money(risk, symbol)}` : 'this is your only attempt'}.
                </p>
                <div className="row">
                  <button className="btn btn--ghost" onClick={() => setConfirming(false)} disabled={busy}>
                    Keep working
                  </button>
                  <button className="btn btn--gain btn--lg" onClick={submit} disabled={busy} autoFocus>
                    {busy ? <span className="spinner" /> : null}
                    Confirm submission
                  </button>
                </div>
              </motion.div>
            ) : (
              <button
                className="btn btn--primary btn--xl btn--block"
                onClick={() => setConfirming(true)}
                disabled={!complete || busy || me.challengeState === 'submitted'}
              >
                {me.challengeState === 'submitted' ? 'Submitted — awaiting result' : 'Submit answer'}
              </button>
            )}
            {!complete && !confirming ? (
              <p className="dim" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center' }}>
                Complete your answer to enable submission.
              </p>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
