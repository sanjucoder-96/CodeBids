/**
 * The final premium title card (spec section 29).
 *
 * Same rules, different weight. This is the only screen in the product that is
 * allowed to be purely ceremonial - it holds for the few seconds before the
 * last auction opens.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { money } from '../lib/format.js';

export function ProjectorFinal() {
  const config = useStore((s) => s.config);
  const challenge = useStore((s) => s.challenge);
  const leaderboard = useStore((s) => s.leaderboard);
  const symbol = config.currencySymbol;

  const leader = leaderboard[0];

  return (
    <div className="pj-final">
      <motion.div
        className="pj-final__rule"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />

      <motion.div
        className="pj-final__diamond"
        initial={{ opacity: 0, scale: 0.4, rotate: -20 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.15 }}
      >
        💎
      </motion.div>

      <motion.h1
        className="pj-final__title"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, type: 'spring', stiffness: 240, damping: 24 }}
      >
        FINAL PREMIUM
      </motion.h1>

      <motion.div
        className="pj-final__sub"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        LAST MARKET · CHALLENGE #{String(challenge?.index ?? 12).padStart(2, '0')}
      </motion.div>

      <motion.div
        className="pj-final__bid"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.66, type: 'spring', stiffness: 260, damping: 22 }}
      >
        <span className="pj-final__bid-label">OPENING BID</span>
        <span className="pj-final__bid-value num">
          {money(config.finalPremiumStartingBid, symbol)}
        </span>
      </motion.div>

      {leader ? (
        <motion.div
          className="pj-final__leader"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.82 }}
        >
          CURRENT LEADER · <strong>{leader.name}</strong> ·{' '}
          <span className="num">{money(leader.capital, symbol)}</span>
        </motion.div>
      ) : null}

      <motion.div
        className="pj-final__rule"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
