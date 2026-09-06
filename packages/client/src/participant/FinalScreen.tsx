/**
 * End of round (spec section 2). This round decides the winners, so the closing
 * screen is a result, not a qualification notice.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Leaderboard } from '../ui/Leaderboard.js';
import { money, placeLabel } from '../lib/format.js';
import { dramaticReveal, fadeUp } from '../lib/motion.js';
import { TrophyIcon, MedalIcon } from '../ui/Icons.js';

export function FinalScreen() {
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const leaderboard = useStore((s) => s.leaderboard);
  const podium = useStore((s) => s.podium);
  const symbol = config.currencySymbol;

  if (!me) return null;

  const myRow = leaderboard.find((r) => r.teamId === me.teamId);
  const myPlace = podium?.find((p) => p.teamId === me.teamId)?.place ?? myRow?.podium ?? null;
  const profit = me.capital - (myRow?.startingCapital ?? config.startingCapital);

  return (
    <div className="screen final">
      <motion.div
        className={`panel panel--pad final__card ${myPlace ? 'panel--premium' : ''}`}
        variants={dramaticReveal}
        initial="hidden"
        animate="show"
      >
        <div className="eyebrow">Round {config.roundNumber} complete</div>

        <motion.span
          className="final__icon"
          data-place={myPlace ?? undefined}
          initial={{ scale: 0.5, opacity: 0, rotate: -12 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 18 }}
          aria-hidden="true"
        >
          {myPlace ? <TrophyIcon size={40} /> : <MedalIcon size={40} />}
        </motion.span>

        <h2 className="final__verdict" data-place={myPlace ?? undefined}>
          {myPlace ? `${placeLabel(myPlace).toUpperCase()} PLACE` : 'ROUND COMPLETE'}
        </h2>

        <div className="final__grid">
          <div className="metric">
            <span className="metric__label">Final rank</span>
            <span className="metric__value num">#{myRow?.rank ?? me.rank}</span>
          </div>
          <div className="metric" data-accent>
            <span className="metric__label">Final capital</span>
            <span className="metric__value num">{money(me.capital, symbol)}</span>
          </div>
          <div className="metric">
            <span className="metric__label">Profit / loss</span>
            <span className={`metric__value num ${profit >= 0 ? 'gain' : 'loss'}`}>
              {profit >= 0 ? '+' : '-'}
              {money(Math.abs(profit), symbol)}
            </span>
          </div>
        </div>

        <div className="final__stats">
          <Stat label="Questions correct" value={`${me.stats.correct}/${me.stats.attempted}`} />
          <Stat label="Premium wins" value={String(me.stats.premiumWins)} />
          <Stat
            label="Premium correct"
            value={`${me.stats.premiumCorrect}/${me.stats.premiumAttempts}`}
          />
          <Stat label="Total earned" value={money(me.stats.totalEarned, symbol)} />
          <Stat label="Total lost" value={money(me.stats.totalLost, symbol)} />
        </div>
      </motion.div>

      <motion.div className="panel panel--flush" variants={fadeUp} initial="hidden" animate="show">
        <div className="panel__head">
          <span className="panel__title">Final standings</span>
          <span className="badge badge--premium">Top {config.podiumPlaces} win</span>
        </div>
        <div style={{ padding: 'var(--sp-3)' }}>
          <Leaderboard
            rows={leaderboard}
            currencySymbol={symbol}
            meId={me.teamId}
            variant="full"
          />
        </div>
      </motion.div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="final__stat">
      <span className="final__stat-label">{label}</span>
      <span className="final__stat-value num">{value}</span>
    </div>
  );
}
