/**
 * The live solving screen. One question, one clock, one submit.
 *
 * The clock is server-authoritative: the deadline derives from the join
 * timestamp on the server, and a late submission is rejected there too - the
 * client timer is a display, not a gate.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { isAnswerComplete, type SubmissionValue } from '@code-market/shared';
import { useStore } from '../lib/store.js';
import { AnswerInput } from './AnswerInputs.js';
import { Countdown } from '../ui/Countdown.js';
import { blockLabel, difficultyLabel, domainLabel, money, typeLabel } from '../lib/format.js';
import { fadeUp } from '../lib/motion.js';

export function ChallengeScreen() {
  const question = useStore((s) => s.question);
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);
  const serverNow = useStore((s) => s.serverNow);

  const [answer, setAnswer] = useState<SubmissionValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A new question must never inherit the previous answer.
  useEffect(() => {
    setAnswer(null);
    setConfirming(false);
  }, [question?.id]);

  /*
   * The clock belongs to this team, not to the round: it starts when the team
   * joins. The server sends the deadline it is actually enforcing, so a
   * reconnecting team resumes with the time it has left. Falling back to the
   * round's global timer was wrong in both directions - an expired intro clock
   * showed 00:00 on a question that had just opened, and a team that rejoined
   * got a fresh full clock.
   */
  const deadline = useMemo(() => {
    if (!question) return null;
    if (me?.questionDeadline) return me.questionDeadline;
    return serverNow() + question.timeLimit * 1000;
    // Recomputed only when the question or the served deadline changes; the
    // countdown ticks itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id, me?.questionDeadline]);

  if (!question || !me) return null;

  const symbol = config.currencySymbol;
  const premium = question.kind === 'premium';
  const complete = isAnswerComplete(question.type, answer, {
    items: question.question.items?.length,
    pairs: question.question.left?.length,
  });

  async function submit() {
    if (!answer || busy || !question) return;
    setBusy(true);
    try {
      await call('SUBMIT_ANSWER', { questionId: question.id, submission: answer });
    } catch (error) {
      pushToast({
        kind: 'warn',
        title: error instanceof Error ? error.message : 'Submission failed',
      });
      setBusy(false);
      setConfirming(false);
    }
  }

  const risk = premium ? (me.premiumRisk ?? 0) : (question.penalty ?? 0);
  const gain = premium ? (me.premiumRisk ?? 0) : (question.reward ?? 0);

  return (
    <div className={`screen challenge ${premium ? 'challenge--premium' : ''}`}>
      <div className="challenge__bar">
        <div className="challenge__ident">
          <span className={`eyebrow ${premium ? 'premium-text' : ''}`}>
            {premium
              ? 'PREMIUM CHALLENGE'
              : blockLabel(question.blockNumber, question.positionInBlock, config.questionsPerBlock)}
          </span>
          <h2 className="challenge__title">{question.title}</h2>
          <div className="row wrap" style={{ gap: 'var(--sp-2)' }}>
            <span className="badge badge--accent">{domainLabel(question.domain)}</span>
            <span className="badge">{typeLabel(question.type)}</span>
            <span className="badge" data-difficulty={question.difficulty}>
              {difficultyLabel(question.difficulty)}
            </span>
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

        <Countdown
          endsAt={deadline}
          duration={question.timeLimit}
          label="Time left"
          size="lg"
          tick
        />
      </div>

      <motion.div className="challenge__body" variants={fadeUp} initial="hidden" animate="show">
        <div className="panel panel--pad challenge__question">
          <p className="challenge__prompt">{question.question.prompt}</p>
          {question.question.code ? (
            <pre className="code-block" tabIndex={0} aria-label="Code listing">
              {question.question.code}
            </pre>
          ) : null}
          {question.question.hint ? (
            <p className="challenge__hint">
              <span className="label">Hint</span> {question.question.hint}
            </p>
          ) : null}
        </div>

        <div className="panel panel--pad challenge__answer">
          <AnswerInput
            question={question}
            value={answer}
            onChange={setAnswer}
            disabled={busy || me.questionState === 'submitted'}
          />

          <div className="challenge__submit">
            {confirming ? (
              <motion.div
                className="challenge__confirm"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <p className="muted">
                  Submit final answer? You cannot change it
                  {risk > 0 ? `, and a wrong answer costs ${money(risk, symbol)}` : ''}.
                </p>
                <div className="row">
                  <button
                    className="btn btn--ghost"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                  >
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
                disabled={!complete || busy || me.questionState === 'submitted'}
              >
                {me.questionState === 'submitted' ? 'Submitted — awaiting result' : 'Submit answer'}
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
