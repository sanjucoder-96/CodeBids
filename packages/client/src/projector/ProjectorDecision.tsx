/**
 * TAKE OR SIT OUT on the big screen (spec sections 6, 7, 12).
 *
 * The room sees the winning team, the 15-second countdown to the authoritative
 * server deadline, and — as it happens — whether the team has taken the
 * question or sat out. The countdown here only displays the server's deadline;
 * it never decides anything.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { money } from '../lib/format.js';
import { BoltIcon } from '../ui/Icons.js';

export function ProjectorDecision() {
  const premium = useStore((s) => s.premium);
  const teams = useStore((s) => s.teams);
  const config = useStore((s) => s.config);
  const serverNow = useStore((s) => s.serverNow);
  const [remaining, setRemaining] = useState(0);

  const deadline = premium?.decisionDeadline ?? null;

  useEffect(() => {
    if (!deadline) return;
    const update = () => setRemaining(Math.max(0, deadline - serverNow()));
    update();
    const handle = setInterval(update, 80);
    return () => clearInterval(handle);
  }, [deadline, serverNow]);

  if (!premium) return null;

  const symbol = config.currencySymbol;
  const winner = premium.activeTeamId;
  const name = winner ? (teams.find((t) => t.id === winner)?.name ?? winner) : '';
  const seconds = Math.ceil(remaining / 1000);
  const decision = winner ? premium.decisions[winner] : undefined;

  return (
    <div className="pj-decision">
      <motion.div
        className="pj-decision__eyebrow"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span aria-hidden="true">
          <BoltIcon size={30} />
        </span>
        PREMIUM WON
      </motion.div>

      <motion.div
        className="pj-decision__team"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        <span className="pj-decision__team-name">{name}</span>
        <span className="pj-decision__team-risk num">{money(premium.activeRisk ?? 0, symbol)} at stake</span>
      </motion.div>

      {decision ? (
        <motion.div
          className="pj-decision__result"
          data-choice={decision}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 20 }}
        >
          {decision === 'take' ? 'TAKES THE QUESTION' : 'SITS OUT'}
        </motion.div>
      ) : (
        <>
          <motion.h1
            className="pj-decision__title"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
          >
            TAKE OR SIT OUT
          </motion.h1>
          <div className="pj-decision__countdown" data-critical={seconds <= 5}>
            {seconds}
          </div>
        </>
      )}
    </div>
  );
}
