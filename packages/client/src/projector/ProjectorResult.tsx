/**
 * The short beat between a premium closing and returning to the leaderboard
 * (spec section 27: "then animate back to leaderboard").
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { money } from '../lib/format.js';
import { ProjectorLeaderboard } from './ProjectorLeaderboard.js';

export function ProjectorResult() {
  const premium = useStore((s) => s.premium);
  const auction = useStore((s) => s.auction);
  const teams = useStore((s) => s.teams);
  const symbol = useStore((s) => s.config.currencySymbol);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setExpired(true), 6000);
    return () => clearTimeout(handle);
  }, [auction?.auction.id]);

  const winner = auction?.auction.winnerTeamId;
  if (expired || !winner) return <ProjectorLeaderboard />;

  const team = teams.find((t) => t.id === winner);
  const outcome = premium?.outcome;

  return (
    <div className="pj-result">
      <motion.div
        className="pj-result__card"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        <div className="pj-result__label">
          {outcome === 'won_first' || outcome === 'won_reclaim'
            ? 'PREMIUM CLAIMED'
            : outcome === 'lost' || outcome === 'no_takers'
              ? 'PREMIUM CLOSED'
              : 'AUCTION SETTLED'}
        </div>
        <div className="pj-result__team">{team?.name ?? winner}</div>
        <div className="pj-result__amount num">
          {money(auction?.auction.winningAmount ?? 0, symbol)}
        </div>
      </motion.div>
    </div>
  );
}
