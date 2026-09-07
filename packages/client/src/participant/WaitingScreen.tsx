/**
 * The waiting room. A team should never be looking at a blank screen wondering
 * what happens next, so this screen always answers: what is happening right
 * now, and where do I stand?
 *
 * During the final stretch the global board is withheld and the team sees only
 * its own numbers (spec section 11).
 */

import { motion } from 'motion/react';
import type { GamePhase } from '@code-market/shared';
import { useStore } from '../lib/store.js';
import { Leaderboard } from '../ui/Leaderboard.js';
import { money, blockLabel } from '../lib/format.js';
import { fadeUp } from '../lib/motion.js';
import { EyeOffIcon } from '../ui/Icons.js';

const PHASE_COPY: Record<GamePhase, { title: string; body: string }> = {
  idle: {
    title: 'Waiting for the round to begin',
    body: 'Keep this screen open. The first question appears here automatically.',
  },
  question_intro: {
    title: 'Next question incoming',
    body: 'Read the domain, difficulty and time before you commit.',
  },
  question_active: {
    title: 'A question is live',
    body: 'Enter the question key when the organizer announces it.',
  },
  question_result: {
    title: 'Results are settling',
    body: 'The next question opens shortly.',
  },
  premium_intro: {
    title: 'Premium challenge incoming',
    body: 'The auction is about to open. Your bid button appears the moment it does.',
  },
  auction_active: {
    title: 'Premium auction in progress',
    body: 'Tap BID on your screen to raise. The live price is on the projector too.',
  },
  premium_authorized: {
    title: 'A team has won the premium',
    body: 'Watch the projector.',
  },
  premium_decision: {
    title: 'The winner is deciding',
    body: 'They have a few seconds to take the question or sit out. Watch the projector.',
  },
  premium_solving: {
    title: 'The premium is being attempted',
    body: 'Another team won this one. Watch the projector.',
  },
  premium_result: {
    title: 'Premium settled',
    body: 'The strategy phase follows shortly.',
  },
  reclaim: {
    title: 'Reclaim in progress',
    body: 'The next highest original bidder is deciding.',
  },
  strategy_phase: {
    title: 'Strategy phase',
    body: 'Plan your next move.',
  },
  final_results: {
    title: 'Final results',
    body: 'The podium is about to be revealed.',
  },
  completed: {
    title: 'Round complete',
    body: 'Thanks for playing.',
  },
  paused: {
    title: 'Round paused',
    body: 'The organizer has paused the round. Nothing is lost — sit tight.',
  },
};

export function WaitingScreen() {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const leaderboard = useStore((s) => s.leaderboard);
  const changed = useStore((s) => s.changedTeams);
  const question = useStore((s) => s.question);
  const premium = useStore((s) => s.premium);
  const teams = useStore((s) => s.teams);
  const hidden = useStore((s) => s.leaderboardHidden);

  const phase = (game?.phase ?? 'idle') as GamePhase;
  const copy = PHASE_COPY[phase] ?? PHASE_COPY.idle;
  const symbol = config.currencySymbol;

  const attempting = premium?.activeTeamId
    ? teams.find((t) => t.id === premium.activeTeamId)
    : null;

  return (
    <div className="screen waiting">
      <motion.div
        className="panel panel--pad waiting__card"
        variants={fadeUp}
        initial="hidden"
        animate="show"
      >
        <div className="waiting__pulse" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        {question ? (
          <div className="eyebrow">
            {blockLabel(question.blockNumber, question.positionInBlock, config.questionsPerBlock)}
          </div>
        ) : null}

        <h2 className="screen__title">{copy.title}</h2>
        <p className="muted">{copy.body}</p>

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
              <span className="metric__label">Position</span>
              <span className="metric__value num">
                {hidden ? '—' : `#${me.rank || '—'}`}
              </span>
            </div>
            <div className="metric" data-accent>
              <span className="metric__label">Max bid</span>
              <span className="metric__value num">{money(me.maxBid, symbol)}</span>
            </div>
          </div>
        ) : null}
      </motion.div>

      {hidden ? (
        <motion.div
          className="panel panel--pad waiting__sealed"
          variants={fadeUp}
          initial="hidden"
          animate="show"
        >
          <span className="waiting__sealed-icon" aria-hidden="true">
            <EyeOffIcon size={28} />
          </span>
          <h3 className="waiting__sealed-title">STANDINGS SEALED</h3>
          <p className="muted">
            The leaderboard is hidden for the last {config.hideLeaderboardLastQuestions} questions.
            Play your own game — every decision counts.
          </p>
        </motion.div>
      ) : (
        <motion.div className="panel panel--flush" variants={fadeUp} initial="hidden" animate="show">
          <div className="panel__head">
            <span className="panel__title">Live standings</span>
            <span className="badge">Top {config.podiumPlaces} take the podium</span>
          </div>
          <div style={{ padding: 'var(--sp-3)' }}>
            <Leaderboard
              rows={leaderboard}
              currencySymbol={symbol}
              changed={changed}
              meId={me?.teamId ?? null}
              variant="compact"
              maxRows={14}
            />
          </div>
        </motion.div>
      )}
    </div>
  );
}
