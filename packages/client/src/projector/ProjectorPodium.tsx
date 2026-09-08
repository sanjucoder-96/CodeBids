/**
 * The closing podium (spec sections 2, 18).
 *
 * A 3-2-1 countdown, then the three places rise in reverse order - third,
 * second, first - so the winner lands last and loudest.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { AnimatedNumber } from '../ui/AnimatedNumber.js';
import { money, placeLabel } from '../lib/format.js';
import { TrophyIcon } from '../ui/Icons.js';
import { prefersReducedMotion } from '../lib/motion.js';

/**
 * Visual height of each plinth, tallest in the middle.
 *
 * Measured against the screen rather than the column: the column also holds the
 * team's name and capital, so a percentage of it was eaten by flex shrink and
 * first and second came out the same height.
 */
const PLINTH_VH = 30;
const PLINTH: Record<number, number> = { 1: 1, 2: 0.72, 3: 0.56 };

/**
 * Height of the plinth for a place, as a CSS length.
 *
 * Exported because getting this wrong is silent: an earlier version built the
 * string as `${fraction}00%`, which turned 0.72 into "0.7200%" and made every
 * plinth the same size.
 */
export function plinthHeight(place: number): string {
  return `${((PLINTH[place] ?? 0.5) * PLINTH_VH).toFixed(1)}vh`;
}

export function ProjectorPodium() {
  const podium = useStore((s) => s.podium);
  const leaderboard = useStore((s) => s.leaderboard);
  const config = useStore((s) => s.config);
  const symbol = config.currencySymbol;

  // A short countdown before the reveal. Skipped under reduced motion.
  const [count, setCount] = useState(() => (prefersReducedMotion() ? 0 : 3));

  useEffect(() => {
    if (count <= 0) return;
    const handle = setTimeout(() => setCount((c) => c - 1), 900);
    return () => clearTimeout(handle);
  }, [count]);

  if (count > 0) {
    return (
      <div className="pj-countdown">
        <motion.div
          key={count}
          className="pj-countdown__digit"
          initial={{ scale: 1.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        >
          {count}
        </motion.div>
        <div className="pj-countdown__label">FINAL RESULTS</div>
      </div>
    );
  }

  const places = podium ?? [];
  // Render order left-to-right is 2nd, 1st, 3rd - the classic podium shape.
  const arranged = [
    places.find((p) => p.place === 2),
    places.find((p) => p.place === 1),
    places.find((p) => p.place === 3),
  ].filter(Boolean) as typeof places;

  // Reveal order is 3rd, 2nd, 1st.
  const revealDelay = (place: number) => ({ 3: 0.1, 2: 0.9, 1: 1.7 })[place] ?? 0;

  return (
    <div className="pj-podium">
      <motion.div
        className="pj-podium__header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span aria-hidden="true">
          <TrophyIcon size={40} />
        </span>
        <h1 className="pj-podium__title">FINAL RESULTS</h1>
        <span className="pj-podium__sub">
          {config.eventName} · {config.roundName} · ROUND {config.roundNumber}
        </span>
      </motion.div>

      {places.length === 0 ? (
        <div className="pj-podium__empty">Awaiting the final standings…</div>
      ) : (
        <div className="pj-podium__stage">
          {arranged.map((entry) => (
            <motion.div
              key={entry.teamId}
              className="pj-plinth"
              data-place={entry.place}
              initial={{ opacity: 0, y: 120 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: revealDelay(entry.place),
                type: 'spring',
                stiffness: 180,
                damping: 20,
              }}
            >
              <motion.div
                className="pj-plinth__medal"
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{
                  delay: revealDelay(entry.place) + 0.25,
                  type: 'spring',
                  stiffness: 320,
                  damping: 16,
                }}
              >
                {placeLabel(entry.place)}
              </motion.div>

              <div className="pj-plinth__team">{entry.name}</div>

              <AnimatedNumber
                className="pj-plinth__capital num"
                value={entry.capital}
                format={(n) => money(n, symbol)}
                duration={1.4}
              />
              <div className={`pj-plinth__delta ${entry.delta >= 0 ? 'gain' : 'loss'}`}>
                {entry.delta >= 0 ? '+' : '-'}
                {money(Math.abs(entry.delta), symbol)}
              </div>

              <motion.div
                className="pj-plinth__block"
                initial={{ height: 0 }}
                animate={{ height: plinthHeight(entry.place) }}
                transition={{ delay: revealDelay(entry.place) + 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="pj-plinth__block-num">{entry.place}</span>
              </motion.div>
            </motion.div>
          ))}
        </div>
      )}

      {leaderboard.length > places.length ? (
        <motion.div
          className="pj-podium__rest"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.6 }}
        >
          {leaderboard
            .filter((row) => row.podium === null)
            .slice(0, 7)
            .map((row) => (
              <span key={row.teamId} className="pj-podium__rest-row">
                <span className="dim num">{row.rank}</span> {row.name}{' '}
                <span className="num">{money(row.capital, symbol)}</span>
              </span>
            ))}
        </motion.div>
      ) : null}
    </div>
  );
}
