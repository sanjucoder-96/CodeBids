/**
 * Result screen: what happened, what it cost or paid, and where the team now
 * stands (spec sections 21, 22).
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { AnimatedNumber } from '../ui/AnimatedNumber.js';
import { Leaderboard } from '../ui/Leaderboard.js';
import { money, challengeLabel } from '../lib/format.js';
import { fadeUp, scaleIn } from '../lib/motion.js';

export function ResultScreen() {
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const leaderboard = useStore((s) => s.leaderboard);
  const changed = useStore((s) => s.changedTeams);
  const challengeIndex = useStore((s) => s.challengeIndex);

  if (!me) return null;
  const result = me.lastResult;
  const symbol = config.currencySymbol;

  const kind =
    result?.result === 'correct'
      ? 'correct'
      : result?.result === 'timeout'
        ? 'timeout'
        : result?.result === 'skipped'
          ? 'skipped'
          : 'wrong';

  const headline =
    kind === 'correct'
      ? 'CORRECT'
      : kind === 'timeout'
        ? "TIME'S UP"
        : kind === 'skipped'
          ? 'SAT OUT'
          : 'INCORRECT';

  const label = challengeIndex.find((c) => c.id === result?.challengeId);

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
            <div className="eyebrow">
              {label ? challengeLabel(label.index, label.marketType) : result.challengeId}
            </div>
            <motion.h2
              className="result__headline"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            >
              {headline}
            </motion.h2>

            {result.delta !== 0 ? (
              <motion.div
                className="result__delta num"
                data-sign={result.delta > 0 ? 'up' : 'down'}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.14, type: 'spring', stiffness: 300, damping: 22 }}
              >
                {result.delta > 0 ? '+' : '-'}
                {money(Math.abs(result.delta), symbol)}
              </motion.div>
            ) : (
              <p className="muted">No capital changed hands.</p>
            )}

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
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
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
            <p className="muted">The next challenge will open here automatically.</p>
          </>
        )}
      </motion.div>

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
            qualifiers={config.qualifiers}
            currencySymbol={symbol}
            changed={changed}
            meId={me.teamId}
            variant="compact"
            maxRows={12}
          />
        </div>
      </motion.div>
    </div>
  );
}
