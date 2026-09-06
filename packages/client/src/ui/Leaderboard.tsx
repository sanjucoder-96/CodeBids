/**
 * The live leaderboard (spec sections 25, 26, 43).
 *
 * Engineering rules this component exists to honour:
 *
 *  - Rows are keyed by TEAM ID, never by array index, so React reconciles the
 *    same DOM node across a reorder.
 *  - Reordering uses Motion's `layout` animation (a FLIP under the hood): the
 *    row physically travels to its new position instead of the list
 *    re-rendering in place.
 *  - Capital counts up/down with AnimatedNumber; the row stays visually stable
 *    while the number changes.
 *  - Three updates in quick succession retarget the same springs - no
 *    duplicated rows, no flicker (the server also coalesces bursts).
 *  - Podium places (1/2/3) get a medal treatment that is not colour-only: the
 *    rank number itself carries the marker.
 */

import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { LeaderboardRow } from '@code-market/shared';
import { AnimatedNumber } from './AnimatedNumber.js';
import { SPRING_ROW, respectMotion } from '../lib/motion.js';
import { money } from '../lib/format.js';

interface Props {
  rows: LeaderboardRow[];
  currencySymbol: string;
  /** Team ids whose capital just changed - drives the highlight pulse. */
  changed?: string[];
  variant?: 'compact' | 'full' | 'projector';
  /** Highlight the viewer's own row. */
  meId?: string | null;
  maxRows?: number;
  /** Mark the podium places with a medal treatment. */
  showPodium?: boolean;
}

interface RowMovement {
  direction: 'up' | 'down' | null;
  amount: number;
  at: number;
}

export function Leaderboard({
  rows,
  currencySymbol,
  changed = [],
  variant = 'full',
  meId = null,
  maxRows,
  showPodium = true,
}: Props) {
  const movements = useRankMovement(rows);
  const visible = maxRows ? rows.slice(0, maxRows) : rows;

  return (
    <div className={`lb lb--${variant}`} role="table" aria-label="Live leaderboard">
      <div className="lb__head" role="row">
        <span className="lb__h lb__h--rank" role="columnheader">
          #
        </span>
        <span className="lb__h lb__h--team" role="columnheader">
          Team
        </span>
        <span className="lb__h lb__h--delta" role="columnheader">
          P/L
        </span>
        <span className="lb__h lb__h--capital" role="columnheader">
          Capital
        </span>
      </div>

      <div className="lb__body">
        <AnimatePresence initial={false}>
          {visible.map((row) => (
            <div key={row.teamId} className="lb__slot">
              <LeaderRow
                row={row}
                movement={movements.get(row.teamId)}
                highlighted={changed.includes(row.teamId)}
                isMe={row.teamId === meId}
                currencySymbol={currencySymbol}
                variant={variant}
                showPodium={showPodium}
              />
            </div>
          ))}
        </AnimatePresence>

        {rows.length === 0 ? (
          <div className="empty-state">
            <p className="muted">No teams on the board yet.</p>
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              Teams appear here as soon as the organizer registers them.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const LeaderRow = memo(function LeaderRow({
  row,
  movement,
  highlighted,
  isMe,
  currencySymbol,
  variant,
  showPodium,
}: {
  row: LeaderboardRow;
  movement: RowMovement | undefined;
  highlighted: boolean;
  isMe: boolean;
  currencySymbol: string;
  variant: 'compact' | 'full' | 'projector';
  showPodium: boolean;
}) {
  const gain = row.delta > 0;
  const loss = row.delta < 0;

  return (
    <motion.div
      layout="position"
      layoutId={`lb-${row.teamId}`}
      role="row"
      className="lb__row"
      data-podium={showPodium && row.podium ? row.podium : undefined}
      data-me={isMe}
      data-offline={row.connectionStatus === 'offline'}
      data-highlight={highlighted}
      data-rank={row.rank}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
      transition={respectMotion(SPRING_ROW)}
    >
      {/* A brief wash of colour when this row just changed. */}
      <AnimatePresence>
        {highlighted ? (
          <motion.span
            className="lb__flash"
            data-kind={gain ? 'gain' : loss ? 'loss' : 'neutral'}
            initial={{ opacity: 0.55 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
            aria-hidden="true"
          />
        ) : null}
      </AnimatePresence>

      <span className="lb__rank" role="cell">
        <span className="lb__rank-num num">{row.rank}</span>
        {showPodium && row.podium ? (
          <span className="lb__medal" aria-label={`Place ${row.podium}`}>
            {row.podium}
          </span>
        ) : null}
        <AnimatePresence>
          {movement?.direction ? (
            <motion.span
              key={movement.at}
              className="lb__move"
              data-dir={movement.direction}
              initial={{ opacity: 0, y: movement.direction === 'up' ? 6 : -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24 }}
            >
              {movement.direction === 'up' ? '▲' : '▼'} {movement.amount}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>

      <span className="lb__team" role="cell">
        <span className="lb__team-name">{row.name}</span>
        <span className="lb__team-meta">
          <span className="lb__team-id mono">{row.teamId}</span>
          {row.connectionStatus === 'offline' ? (
            <span className="lb__offline" title="Disconnected">
              OFFLINE
            </span>
          ) : null}
          {isMe ? <span className="lb__you">YOU</span> : null}
        </span>
      </span>

      <span className={`lb__delta num ${gain ? 'gain' : loss ? 'loss' : 'dim'}`} role="cell">
        {row.delta === 0 ? '—' : `${gain ? '+' : '-'}${currencySymbol}${Math.abs(row.delta)}`}
      </span>

      <span className="lb__capital num" role="cell">
        <AnimatedNumber
          value={row.capital}
          format={(n) => money(n, currencySymbol)}
          duration={variant === 'projector' ? 1 : 0.75}
        />
      </span>
    </motion.div>
  );
});

/**
 * Track rank movement across renders so the row can show a transient ▲1 / ▼2.
 * The indicator fades after a moment rather than persisting, so the board stays
 * calm between updates.
 */
function useRankMovement(rows: LeaderboardRow[]): Map<string, RowMovement> {
  const previous = useRef(new Map<string, number>());
  const [movements, setMovements] = useState(new Map<string, RowMovement>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const next = new Map(movements);
    let dirty = false;

    for (const row of rows) {
      const before = previous.current.get(row.teamId);
      if (before !== undefined && before !== row.rank) {
        next.set(row.teamId, {
          direction: before > row.rank ? 'up' : 'down',
          amount: Math.abs(before - row.rank),
          at: Date.now(),
        });
        dirty = true;

        const existing = timers.current.get(row.teamId);
        if (existing) clearTimeout(existing);
        timers.current.set(
          row.teamId,
          setTimeout(() => {
            setMovements((current) => {
              const copy = new Map(current);
              copy.delete(row.teamId);
              return copy;
            });
            timers.current.delete(row.teamId);
          }, 3200),
        );
      }
      previous.current.set(row.teamId, row.rank);
    }

    if (dirty) setMovements(next);
    // `movements` is deliberately not a dependency: including it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  useEffect(() => {
    const handles = timers.current;
    return () => {
      for (const handle of handles.values()) clearTimeout(handle);
      handles.clear();
    };
  }, []);

  return movements;
}
