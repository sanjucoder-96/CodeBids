/**
 * The Strategy Phase (spec section 10).
 *
 * 40 seconds after every premium. This is a real game state, not a loading
 * screen: the team reviews its capital, sees what its bidding power now buys,
 * and reads what is coming next.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { AnimatedNumber } from '../ui/AnimatedNumber.js';
import { Countdown } from '../ui/Countdown.js';
import { delta, money } from '../lib/format.js';
import { BrainIcon, ChartIcon, TrendUpIcon } from '../ui/Icons.js';

export function StrategyScreen() {
  const me = useStore((s) => s.me);
  const game = useStore((s) => s.game);
  const config = useStore((s) => s.config);
  const hidden = useStore((s) => s.leaderboardHidden);

  if (!me) return null;
  const symbol = config.currencySymbol;
  const profit = me.stats.totalEarned - me.stats.totalLost;
  const accuracy =
    me.stats.attempted > 0 ? Math.round((me.stats.correct / me.stats.attempted) * 100) : 0;

  return (
    <div className="screen screen--center">
      <motion.div
        className="strategy panel"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 250, damping: 24 }}
      >
        <motion.div
          className="strategy__badge"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span aria-hidden="true">
            <BrainIcon size={18} />
          </span>
          STRATEGY PHASE
        </motion.div>

        <h2 className="strategy__title">Plan your next move</h2>
        <p className="muted strategy__lede">
          Review your position before the next block. Nothing is at stake for the next{' '}
          {config.strategyWindowSeconds} seconds.
        </p>

        <motion.div
          className="strategy__capital"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.12, type: 'spring', stiffness: 300, damping: 22 }}
        >
          <span className="label">Your capital</span>
          <AnimatedNumber
            className="strategy__capital-value num"
            value={me.capital}
            format={(n) => money(n, symbol)}
            duration={1}
          />
          <span
            className={`strategy__capital-delta ${profit > 0 ? 'gain' : profit < 0 ? 'loss' : 'dim'}`}
          >
            {delta(profit, symbol)} this round
          </span>
        </motion.div>

        <div className="strategy__grid">
          <Card
            icon={<TrendUpIcon size={18} />}
            label="Bidding power"
            value={money(me.maxBid, symbol)}
            hint={`capital − ${money(config.protectedReserve, symbol)} reserve`}
            accent
          />
          <Card
            icon={<ChartIcon size={18} />}
            label="Accuracy"
            value={`${accuracy}%`}
            hint={`${me.stats.correct} of ${me.stats.attempted} correct`}
          />
          <Card
            icon={<TrendUpIcon size={18} />}
            label="Premium record"
            value={`${me.stats.premiumCorrect}/${me.stats.premiumAttempts}`}
            hint={`${me.stats.premiumWins} auction${me.stats.premiumWins === 1 ? '' : 's'} won`}
          />
          {!hidden && me.rank > 0 ? (
            <Card
              icon={<ChartIcon size={18} />}
              label="Position"
              value={`#${me.rank}`}
              hint={`of ${me.totalTeams} teams`}
            />
          ) : (
            <Card
              icon={<ChartIcon size={18} />}
              label="Position"
              value="HIDDEN"
              hint="standings are sealed for the finale"
            />
          )}
        </div>

        {game?.timer.endsAt ? (
          <div className="strategy__timer">
            <Countdown
              endsAt={game.timer.endsAt}
              duration={game.timer.duration}
              label="Next block in"
              size="lg"
            />
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}

function Card({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="strategy__card" data-accent={accent}>
      <span className="strategy__card-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="strategy__card-label">{label}</span>
      <span className="strategy__card-value num">{value}</span>
      <span className="strategy__card-hint">{hint}</span>
    </div>
  );
}
