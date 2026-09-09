/**
 * Result screen: what happened, what it paid or cost, and where the team now
 * stands. The global board is withheld during the final stretch.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { AnimatedNumber } from '../ui/AnimatedNumber.js';
import { Leaderboard } from '../ui/Leaderboard.js';
import { money, slotLabel, domainLabel, difficultyLabel } from '../lib/format.js';
import { fadeUp, scaleIn } from '../lib/motion.js';
import { CheckIcon, CrossIcon, ClockIcon, EyeOffIcon } from '../ui/Icons.js';

export function ResultScreen() {
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const leaderboard = useStore((s) => s.leaderboard);
  const changed = useStore((s) => s.changedTeams);
  const sequence = useStore((s) => s.sequence);
  const question = useStore((s) => s.question);
  const hidden = useStore((s) => s.leaderboardHidden);

  if (!me) return null;
  const result = me.lastResult;
  const symbol = config.currencySymbol;

  // With no result yet the card is neutral. Falling through to 'wrong' painted
  // the waiting headline in the loss red, which reads as a failure.
  const kind = !result
    ? 'idle'
    : result.result === 'correct'
      ? 'correct'
      : result.result === 'timeout'
        ? 'timeout'
        : result.result === 'skipped'
          ? 'skipped'
          : 'wrong';

  // A premium is a BID the team staked on the question, so its result reads as
  // winning or losing the bid rather than a plain correct/incorrect.
  const premium = question?.kind === 'premium';
  const headline = premium
    ? kind === 'correct'
      ? 'WON THE BID'
      : kind === 'skipped'
        ? 'SAT OUT'
        : 'LOST THE BID'
    : kind === 'correct'
      ? 'CORRECT'
      : kind === 'timeout'
        ? "TIME'S UP"
        : kind === 'skipped'
          ? 'SAT OUT'
          : 'INCORRECT';

  const icon =
    kind === 'correct' ? <CheckIcon size={30} /> : kind === 'timeout' ? <ClockIcon size={30} /> : <CrossIcon size={30} />;

  // The sequence is organizer-only, so fall back to the live question.
  const slot = sequence.find((s) => s.questionId === result?.questionId);
  const label = slot
    ? slotLabel(slot.blockNumber, slot.positionInBlock, slot.kind)
    : question
      ? slotLabel(question.blockNumber, question.positionInBlock, question.kind)
      : (result?.questionId ?? '');

  return (
    <div className="screen result">
      <motion.div
        className={`panel panel--pad result__card result__card--${kind}`}
        variants={scaleIn}
        initial="hidden"
        animate="show"
      >
        {result ? (
          <>
            <div className="eyebrow">{label}</div>

            <motion.span
              className="result__icon"
              data-kind={kind}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 20 }}
              aria-hidden="true"
            >
              {icon}
            </motion.span>

            <motion.h2
              className="result__headline"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            >
              {headline}
            </motion.h2>

            {question ? (
              <div className="row wrap" style={{ justifyContent: 'center' }}>
                <span className="badge badge--accent">{domainLabel(question.domain)}</span>
                <span className="badge" data-difficulty={question.difficulty}>
                  {difficultyLabel(question.difficulty)}
                </span>
              </div>
            ) : null}

            {kind === 'correct' && result.delta > 0 ? (
              <motion.div
                className="result__delta num"
                data-sign="up"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.14, type: 'spring', stiffness: 300, damping: 22 }}
              >
                +{money(result.delta, symbol)}
              </motion.div>
            ) : (kind === 'wrong' || kind === 'timeout') && result.stake > 0 ? (
              <motion.div
                className="result__delta num"
                data-sign="down"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.14, type: 'spring', stiffness: 300, damping: 22 }}
              >
                -{money(result.stake, symbol)}
              </motion.div>
            ) : (
              <p className="muted">No capital changed hands.</p>
            )}

            {result.stake > 0 ? (
              <p className="result__bid-note muted">
                {kind === 'correct'
                  ? `You staked ${money(result.stake, symbol)} — ${money(result.delta, symbol)} paid back.`
                  : `Your ${money(result.stake, symbol)} ${premium ? 'bid' : 'stake'} is forfeited.`}
              </p>
            ) : null}

            <div className="result__capital">
              <span className="label">Capital now</span>
              <AnimatedNumber
                className="result__capital-value num"
                value={me.capital}
                format={(n) => money(n, symbol)}
                duration={1.2}
              />
            </div>

            {result.detail ? <p className="result__detail muted">{result.detail}</p> : null}

            {result.explanation ? (
              <motion.div
                className="result__explanation"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.32 }}
              >
                <span className="label">Why</span>
                <p>{result.explanation}</p>
              </motion.div>
            ) : null}
          </>
        ) : (
          <>
            <h2 className="result__headline">Standing by</h2>
            <p className="muted">The next question opens here automatically.</p>
          </>
        )}
      </motion.div>

      {hidden ? (
        <motion.div
          className="panel panel--pad waiting__sealed"
          variants={fadeUp}
          initial="hidden"
          animate="show"
        >
          <span className="waiting__sealed-icon" aria-hidden="true">
            <EyeOffIcon size={28} />
          </span>
          <h3 className="waiting__sealed-title">STANDINGS SEALED</h3>
          <p className="muted">
            You can still see your own capital. Global standings return at the final reveal.
          </p>
          <div className="metric" data-accent style={{ marginTop: 'var(--sp-4)' }}>
            <span className="metric__label">Your capital</span>
            <span className="metric__value num">{money(me.capital, symbol)}</span>
          </div>
        </motion.div>
      ) : (
        <motion.div className="panel panel--flush" variants={fadeUp} initial="hidden" animate="show">
          <div className="panel__head">
            <span className="panel__title">Live standings</span>
            <span className="badge badge--accent">
              Rank #{me.rank} of {me.totalTeams}
            </span>
          </div>
          <div style={{ padding: 'var(--sp-3)' }}>
            <Leaderboard
              rows={leaderboard}
              currencySymbol={symbol}
              changed={changed}
              meId={me.teamId}
              variant="compact"
              maxRows={12}
            />
          </div>
        </motion.div>
      )}
    </div>
  );
}
