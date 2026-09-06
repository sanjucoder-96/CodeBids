/**
 * The Strategy Phase on the hall display (spec section 10).
 * A deliberate, calm beat between blocks - not a loading screen.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Countdown } from '../ui/Countdown.js';
import { BrainIcon } from '../ui/Icons.js';

export function ProjectorStrategy() {
  const game = useStore((s) => s.game);
  const config = useStore((s) => s.config);
  const teams = useStore((s) => s.teams);

  const online = teams.filter((t) => t.connectionStatus === 'online').length;

  return (
    <div className="pj-strategy">
      <motion.span
        className="pj-strategy__icon"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        aria-hidden="true"
      >
        <BrainIcon size={72} />
      </motion.span>

      <motion.h1
        className="pj-strategy__title"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, type: 'spring', stiffness: 240, damping: 22 }}
      >
        STRATEGY PHASE
      </motion.h1>

      <motion.p
        className="pj-strategy__lede"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        REVIEW YOUR CAPITAL · PLAN YOUR NEXT BID
      </motion.p>

      {game?.timer.endsAt ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.42, type: 'spring', stiffness: 260, damping: 22 }}
        >
          <Countdown
            endsAt={game.timer.endsAt}
            duration={game.timer.duration}
            label="NEXT BLOCK IN"
            size="xl"
          />
        </motion.div>
      ) : null}

      <div className="pj-strategy__meta">
        {config.strategyWindowSeconds} SECOND WINDOW · {online}/{teams.length} TEAMS ONLINE
      </div>
    </div>
  );
}
