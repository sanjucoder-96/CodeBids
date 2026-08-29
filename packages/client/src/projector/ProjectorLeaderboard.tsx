/**
 * The hall leaderboard (spec sections 25, 26).
 *
 * Large typography, minimal clutter, an explicit qualification line, and rows
 * that physically travel when a team overtakes another.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Leaderboard } from '../ui/Leaderboard.js';
import { challengeLabel } from '../lib/format.js';

export function ProjectorLeaderboard() {
  const leaderboard = useStore((s) => s.leaderboard);
  const changed = useStore((s) => s.changedTeams);
  const config = useStore((s) => s.config);
  const game = useStore((s) => s.game);
  const challenge = useStore((s) => s.challenge);
  const teams = useStore((s) => s.teams);

  const online = teams.filter((t) => t.connectionStatus === 'online').length;

  return (
    <div className="pj-leaderboard">
      <header className="pj-header">
        <div>
          <motion.div
            className="pj-header__eyebrow"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {config.eventName}
          </motion.div>
          <motion.h1
            className="pj-header__title"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            {config.roundName}
          </motion.h1>
        </div>

        <div className="pj-header__right">
          {challenge ? (
            <div className="pj-header__chip">
              {challengeLabel(challenge.index, challenge.marketType)}
            </div>
          ) : null}
          {game?.phase === 'paused' ? <div className="pj-header__chip pj-header__chip--warn">PAUSED</div> : null}
          {game?.phase === 'complete' ? (
            <div className="pj-header__chip pj-header__chip--gain">FINAL RESULT</div>
          ) : null}
          <div className="pj-header__meta">
            {online}/{teams.length} online
          </div>
        </div>
      </header>

      <div className="pj-leaderboard__title">LIVE LEADERBOARD</div>

      <div className="pj-leaderboard__board">
        <Leaderboard
          rows={leaderboard}
          qualifiers={config.qualifiers}
          currencySymbol={config.currencySymbol}
          changed={changed}
          variant="projector"
          maxRows={12}
        />
      </div>

      <footer className="pj-footer">
        <span>TOP {config.qualifiers} ADVANCE TO ROUND 3</span>
        {leaderboard.length > 12 ? <span>Showing top 12 of {leaderboard.length} teams</span> : null}
      </footer>
    </div>
  );
}
