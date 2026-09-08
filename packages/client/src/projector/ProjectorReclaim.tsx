/**
 * The reclaim moment on the big screen (spec section 28).
 *
 * Dramatic, but short: who failed, who is next, what they risk, and whether
 * they took it. The auction ladder is shown alongside so the room understands
 * WHY that team is next - the strategic payoff of having bid.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { money } from '../lib/format.js';

export function ProjectorReclaim() {
  const premium = useStore((s) => s.premium);
  const teams = useStore((s) => s.teams);
  const config = useStore((s) => s.config);
  const serverNow = useStore((s) => s.serverNow);
  const [remaining, setRemaining] = useState(0);

  const deadline = premium?.offerDeadline ?? null;

  useEffect(() => {
    if (!deadline) return;
    const update = () => setRemaining(Math.max(0, deadline - serverNow()));
    update();
    const handle = setInterval(update, 80);
    return () => clearInterval(handle);
  }, [deadline, serverNow]);

  if (!premium) return null;

  const name = (id: string | null) => (id ? (teams.find((t) => t.id === id)?.name ?? id) : '');
  const symbol = config.currencySymbol;
  const seconds = Math.ceil(remaining / 1000);
  const accepted = premium.ladder.find((e) => e.state === 'accepted');
  const offered = premium.offerTeamId;

  return (
    <div className="pj-reclaim">
      <motion.div
        className="pj-reclaim__banner"
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        ⚠️ PREMIUM RECLAIM
      </motion.div>

      {premium.failedTeamId ? (
        <motion.div
          className="pj-reclaim__failed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.12 }}
        >
          <span className="pj-reclaim__failed-team">{name(premium.failedTeamId)}</span> FAILED
        </motion.div>
      ) : null}

      <AnimatePresence mode="wait">
        {offered ? (
          <motion.div
            key={`offer-${offered}`}
            className="pj-reclaim__offer"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.06 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24 }}
          >
            <div className="pj-reclaim__next-label">SECOND BIDDER · TAKE OR SIT OUT</div>
            <div className="pj-reclaim__team">{name(offered)}</div>
            <div className="pj-reclaim__risk num">{money(premium.offerRisk ?? 0, symbol)} RISK</div>

            <div className="pj-reclaim__countdown" data-critical={seconds <= 5}>
              <div className="pj-reclaim__countdown-value num">{seconds}</div>
              <div className="pj-reclaim__countdown-label">SECONDS</div>
            </div>
          </motion.div>
        ) : accepted ? (
          <motion.div
            key={`accepted-${accepted.teamId}`}
            className="pj-reclaim__resolved"
            data-kind="accepted"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          >
            <div className="pj-reclaim__resolved-team">{name(accepted.teamId)}</div>
            <div className="pj-reclaim__resolved-word">ACCEPTED</div>
            <div className="pj-reclaim__risk num">{money(accepted.amount, symbol)} AT RISK</div>
          </motion.div>
        ) : (
          <motion.div
            key="closed"
            className="pj-reclaim__resolved"
            data-kind="closed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="pj-reclaim__resolved-word">
              {premium.outcome === 'no_takers' ? 'NO TAKERS' : 'PREMIUM CLOSED'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="pj-ladder">
        <div className="pj-ladder__label">ORIGINAL AUCTION ORDER</div>
        <div className="pj-ladder__rows">
          {premium.ladder.map((entry, index) => (
            <motion.div
              key={entry.teamId}
              layout
              className="pj-ladder__row"
              data-state={entry.state}
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.06, type: 'spring', stiffness: 360, damping: 30 }}
            >
              <span className="pj-ladder__medal">
                {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`}
              </span>
              <span className="pj-ladder__team">{name(entry.teamId)}</span>
              <span className="pj-ladder__amount num">{money(entry.amount, symbol)}</span>
              <span className="pj-ladder__state">{stateLabel(entry.state)}</span>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}

function stateLabel(state: string): string {
  switch (state) {
    case 'winner':
      return 'WON';
    case 'failed':
      return 'FAILED';
    case 'offered':
      return 'DECIDING';
    case 'accepted':
      return 'ACCEPTED';
    case 'declined':
      return 'DECLINED';
    case 'expired':
      return 'NO ANSWER';
    case 'skipped':
      return '—';
    default:
      return 'IN LINE';
  }
}
