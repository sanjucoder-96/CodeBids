/**
 * The waiting room. A team should never be looking at a blank screen wondering
 * what happens next (spec section 21), so this screen always answers: what is
 * happening right now, and what is my position?
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Leaderboard } from '../ui/Leaderboard.js';
import { money, challengeLabel } from '../lib/format.js';
import { fadeUp } from '../lib/motion.js';

const PHASE_COPY: Record<string, { title: string; body: string }> = {
  lobby: {
    title: 'Waiting for the round to begin',
    body: 'Keep this screen open. The first challenge will appear here automatically.',
  },
  market: {
    title: 'A market challenge is live',
    body: 'Enter the challenge key when the organizer announces it.',
  },
  auction: {
    title: 'Premium auction in progress',
    body: 'Raise your paddle to bid. The live price is on the projector.',
  },
  premium_attempt: {
    title: 'A premium is being attempted',
    body: 'Another team won this premium. Watch the projector.',
  },
  premium_reclaim: {
    title: 'Reclaim in progress',
    body: 'The next highest original bidder is deciding.',
  },
  result: {
    title: 'Results are settling',
    body: 'The next challenge opens shortly.',
  },
  paused: {
    title: 'Round paused',
    body: 'The organizer has paused the round. Nothing is lost — sit tight.',
  },
  final: {
    title: 'The final premium is about to begin',
    body: 'This is the last challenge of the round.',
  },
};

export function WaitingScreen() {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const leaderboard = useStore((s) => s.leaderboard);
  const changed = useStore((s) => s.changedTeams);
  const challenge = useStore((s) => s.challenge);
  const premium = useStore((s) => s.premium);
  const teams = useStore((s) => s.teams);

  const phase = game?.phase ?? 'lobby';
  const copy = PHASE_COPY[phase] ?? PHASE_COPY.lobby;
  const symbol = config.currencySymbol;

  const attempting = premium?.activeTeamId
    ? teams.find((t) => t.id === premium.activeTeamId)
    : null;

  return (
    <div className="screen waiting">
      <motion.div className="panel panel--pad waiting__card" variants={fadeUp} initial="hidden" animate="show">
        <div className="waiting__pulse" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        {challenge ? (
          <div className="eyebrow">{challengeLabel(challenge.index, challenge.marketType)}</div>
        ) : null}
        <h2 className="screen__title">{copy?.title}</h2>
        <p className="muted">{copy?.body}</p>

        {attempting ? (
          <div className="waiting__attempt">
            <span className="label">Attempting now</span>
            <span className="waiting__attempt-team">
              <span className="mono">{attempting.id}</span> {attempting.name}
            </span>
            {premium?.activeRisk ? (
              <span className="badge badge--premium">RISK {money(premium.activeRisk, symbol)}</span>
            ) : null}
          </div>
        ) : null}

        {me ? (
          <div className="waiting__stats">
            <div className="metric">
              <span className="metric__label">Capital</span>
              <span className="metric__value num">{money(me.capital, symbol)}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Rank</span>
              <span className="metric__value num">#{me.rank || '—'}</span>
            </div>
            <div className="metric" data-accent>
              <span className="metric__label">Max bid</span>
              <span className="metric__value num">{money(me.maxBid, symbol)}</span>
            </div>
          </div>
        ) : null}
      </motion.div>

      <motion.div className="panel panel--flush" variants={fadeUp} initial="hidden" animate="show">
        <div className="panel__head">
          <span className="panel__title">Live standings</span>
          <span className="badge">Top {config.qualifiers} advance</span>
        </div>
        <div style={{ padding: 'var(--sp-3)' }}>
          <Leaderboard
            rows={leaderboard}
            qualifiers={config.qualifiers}
            currencySymbol={symbol}
            changed={changed}
            meId={me?.teamId ?? null}
            variant="compact"
            maxRows={14}
          />
        </div>
      </motion.div>
    </div>
  );
}
