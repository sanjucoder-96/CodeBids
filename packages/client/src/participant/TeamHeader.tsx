/**
 * The persistent participant header: capital, rank, max bid and the clock.
 * These four numbers must be visible on every screen (spec section 21).
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { AnimatedNumber } from '../ui/AnimatedNumber.js';
import { Countdown } from '../ui/Countdown.js';
import { money } from '../lib/format.js';
import { sound } from '../lib/sound.js';
import { useState } from 'react';

export function TeamHeader({ onLogout }: { onLogout: () => void }) {
  const me = useStore((s) => s.me);
  const teams = useStore((s) => s.teams);
  const game = useStore((s) => s.game);
  const symbol = useStore((s) => s.config.currencySymbol);
  const config = useStore((s) => s.config);
  const [muted, setMuted] = useState(() => sound.isMuted());

  const team = teams.find((t) => t.id === me?.teamId);
  if (!me) return null;

  const toggleMute = () => {
    const next = !muted;
    sound.setMuted(next);
    setMuted(next);
    if (!next) sound.play('bid');
  };

  return (
    <header className="pheader">
      <div className="container pheader__inner">
        <div className="pheader__identity">
          <div className="pheader__mark">CODE MARKET</div>
          <div className="pheader__team">
            <span className="pheader__team-name">{team?.name ?? me.teamId}</span>
          </div>
        </div>

        <div className="pheader__stats">
          <Stat label="Capital" emphasis>
            <AnimatedNumber
              className="num"
              value={me.capital}
              format={(n) => money(n, symbol)}
              duration={1}
            />
          </Stat>

          <Stat label={me.leaderboardHidden ? 'Position' : 'Rank'}>
            <motion.span
              key={me.leaderboardHidden ? 'hidden' : me.rank}
              className="num"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              {me.leaderboardHidden ? '—' : `#${me.rank || '—'}`}
            </motion.span>
            <span className="pheader__stat-sub dim">
              {me.leaderboardHidden ? 'sealed' : `of ${me.totalTeams}`}
            </span>
          </Stat>

          <Stat label="Max bid">
            <AnimatedNumber
              className="num"
              value={me.maxBid}
              format={(n) => money(n, symbol)}
              duration={0.6}
            />
            <span className="pheader__stat-sub dim">reserve {money(config.protectedReserve, symbol)}</span>
          </Stat>

          {me.leaderboardHidden ? (
            <span className="badge badge--dot" title="Standings are sealed for the finale">
              STANDINGS SEALED
            </span>
          ) : me.podium !== null ? (
            <span className="badge badge--premium badge--dot" title="Currently on the podium">
              PODIUM
            </span>
          ) : (
            <span className="badge badge--dot" title="Chasing the podium">
              CHASING
            </span>
          )}
        </div>

        <div className="pheader__right">
          {game?.timer.endsAt ? (
            <Countdown
              endsAt={game.timer.endsAt}
              duration={game.timer.duration}
              label={game.timer.label}
              size="sm"
            />
          ) : null}
          <button
            className="btn btn--ghost btn--sm"
            onClick={toggleMute}
            aria-pressed={muted}
            title={muted ? 'Sound is off' : 'Sound is on'}
          >
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={onLogout}>
            Leave
          </button>
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  children,
  emphasis,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="pheader__stat" data-emphasis={emphasis}>
      <span className="pheader__stat-label">{label}</span>
      <span className="pheader__stat-value">{children}</span>
    </div>
  );
}
