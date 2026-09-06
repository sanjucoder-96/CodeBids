/**
 * The suspense card (spec sections 11, 18).
 *
 * For the last four normal questions the global board is sealed. The hall sees
 * this instead - deliberately sparse, so the tension does the work.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Countdown } from '../ui/Countdown.js';
import { BoltIcon, EyeOffIcon } from '../ui/Icons.js';

export function ProjectorFinalStretch() {
  const config = useStore((s) => s.config);
  const game = useStore((s) => s.game);
  const question = useStore((s) => s.question);

  const remaining = Math.max(
    1,
    (game?.totalSlots ?? 0) - (game?.slotIndex ?? 0) + 1,
  );

  return (
    <div className="pj-stretch">
      <motion.div
        className="pj-stretch__bolts"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        aria-hidden="true"
      >
        <BoltIcon size={44} />
        <BoltIcon size={44} />
      </motion.div>

      <motion.h1
        className="pj-stretch__title"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      >
        FINAL STRETCH
      </motion.h1>

      <motion.div
        className="pj-stretch__sealed"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
      >
        <span aria-hidden="true">
          <EyeOffIcon size={34} />
        </span>
        LEADERBOARD SEALED
      </motion.div>

      <motion.p
        className="pj-stretch__lede"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55 }}
      >
        THE LAST {config.hideLeaderboardLastQuestions} QUESTIONS ARE PLAYED BLIND
      </motion.p>

      {question ? (
        <motion.div
          className="pj-stretch__now"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          {remaining} SLOT{remaining === 1 ? '' : 'S'} LEFT IN THE ROUND
        </motion.div>
      ) : null}

      {game?.timer.endsAt ? (
        <Countdown
          endsAt={game.timer.endsAt}
          duration={game.timer.duration}
          label={game.timer.label}
          size="lg"
        />
      ) : null}
    </div>
  );
}
