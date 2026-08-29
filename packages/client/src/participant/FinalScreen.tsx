/** End of round: the team's final position and whether they advance. */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Leaderboard } from '../ui/Leaderboard.js';
import { money } from '../lib/format.js';
import { dramaticReveal, fadeUp } from '../lib/motion.js';

export function FinalScreen() {
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const leaderboard = useStore((s) => s.leaderboard);
  const symbol = config.currencySymbol;

  if (!me) return null;
  const profit = me.capital - (leaderboard.find((r) => r.teamId === me.teamId)?.startingCapital ?? config.startingCapital);

  return (
    <div className="screen final">
      <motion.div
        className={`panel panel--pad final__card ${me.qualified ? 'panel--gain' : ''}`}
        variants={dramaticReveal}
        initial="hidden"
        animate="show"
      >
        <div className="eyebrow">Round 2 complete</div>
        <h2 className="final__verdict" data-qualified={me.qualified}>
          {me.qualified ? 'YOU QUALIFY FOR ROUND 3' : 'ROUND 2 COMPLETE'}
        </h2>

        <div className="final__grid">
          <div className="metric">
            <span className="metric__label">Final rank</span>
            <span className="metric__value num">#{me.rank}</span>
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
          <Stat label="Market correct" value={`${me.stats.marketCorrect}/${me.stats.marketAttempted}`} />
          <Stat label="Premium wins" value={String(me.stats.premiumWins)} />
          <Stat label="Premium correct" value={`${me.stats.premiumCorrect}/${me.stats.premiumAttempts}`} />
          <Stat label="Total earned" value={money(me.stats.totalEarned, symbol)} />
          <Stat label="Total lost" value={money(me.stats.totalLost, symbol)} />
        </div>
      </motion.div>

      <motion.div className="panel panel--flush" variants={fadeUp} initial="hidden" animate="show">
        <div className="panel__head">
          <span className="panel__title">Final standings</span>
          <span className="badge badge--gain">Top {config.qualifiers} advance</span>
        </div>
        <div style={{ padding: 'var(--sp-3)' }}>
          <Leaderboard
            rows={leaderboard}
            qualifiers={config.qualifiers}
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
