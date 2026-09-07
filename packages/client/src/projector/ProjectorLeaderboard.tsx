/**
 * The hall leaderboard (spec sections 16, 17).
 *
 * Large typography, minimal clutter, the podium line, and rows that physically
 * travel when a team overtakes another.
 *
 * The board must fit the screen it is projected on: a row the hall cannot see
 * is worse than a smaller one. The rows share the available height and the type
 * steps down as the field grows.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Leaderboard } from '../ui/Leaderboard.js';
import { FitToViewport } from './FitToViewport.js';
import { slotLabel } from '../lib/format.js';

/** As many rows as stay legible from the back of a hall. */
export const MAX_PROJECTOR_ROWS = 10;

export function ProjectorLeaderboard() {
  const leaderboard = useStore((s) => s.leaderboard);
  const changed = useStore((s) => s.changedTeams);
  const config = useStore((s) => s.config);
  const game = useStore((s) => s.game);
  const question = useStore((s) => s.question);
  const teams = useStore((s) => s.teams);

  const online = teams.filter((t) => t.connectionStatus === 'online').length;
  const shown = Math.min(leaderboard.length, MAX_PROJECTOR_ROWS);
  const density = shown <= 6 ? 'roomy' : 'normal';

  return (
    <FitToViewport>
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
          {question ? (
            <div className="pj-header__chip">
              {slotLabel(question.blockNumber, question.positionInBlock, question.kind)}
            </div>
          ) : null}
          {game?.phase === 'paused' ? <div className="pj-header__chip pj-header__chip--warn">PAUSED</div> : null}
          {game?.phase === 'completed' ? (
            <div className="pj-header__chip pj-header__chip--gain">FINAL RESULT</div>
          ) : null}
          <div className="pj-header__meta">
            {online}/{teams.length} online
          </div>
        </div>
      </header>

      <div className="pj-leaderboard__title">LIVE LEADERBOARD</div>

      <div className="pj-leaderboard__board" data-density={density}>
        <Leaderboard
          rows={leaderboard}
          currencySymbol={config.currencySymbol}
          changed={changed}
          variant="projector"
          maxRows={MAX_PROJECTOR_ROWS}
        />
      </div>

      <footer className="pj-footer">
        <span>TOP {config.podiumPlaces} TAKE THE PODIUM</span>
        {leaderboard.length > MAX_PROJECTOR_ROWS ? (
          <span>
            Showing top {MAX_PROJECTOR_ROWS} of {leaderboard.length} teams
          </span>
        ) : null}
      </footer>
      </div>
    </FitToViewport>
  );
}
