/**
 * TAKE or SIT OUT (spec sections 6, 7).
 *
 * The team that won the premium has a fixed window to commit to the question or
 * back out. The deadline is the server's, not this laptop's: the countdown
 * renders against `me.premiumDecisionDeadline`, and the question only becomes
 * active when the server closes the window. No choice before the deadline
 * defaults to SIT OUT.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { money } from '../lib/format.js';
import { Countdown } from '../ui/Countdown.js';
import { CheckIcon, CrossIcon } from '../ui/Icons.js';

export function PremiumDecisionScreen() {
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const call = useStore((s) => s.call);
  const [busy, setBusy] = useState(false);

  if (!me) return null;
  const symbol = config.currencySymbol;
  const risk = me.premiumRisk ?? 0;
  const chosen = me.premiumDecision;

  async function decide(take: boolean) {
    if (busy || chosen) return;
    setBusy(true);
    try {
      await call('PREMIUM_DECISION', { take });
    } catch {
      /* the server rejects a late choice; the countdown explains why */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen screen--center">
      <motion.div
        className="panel panel--premium decide"
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
      >
        <div className="decide__badge">PREMIUM WON</div>
        <h2 className="decide__title">Take it or sit out?</h2>
        <p className="muted decide__lede">
          Take the question and risk your bid of <strong>{money(risk, symbol)}</strong>: a correct
          answer adds it, a wrong answer loses it. Sit out and nothing changes.
        </p>

        <div className="decide__stakes">
          <div className="decide__stake decide__stake--gain">
            <span className="decide__stake-label">If correct</span>
            <span className="decide__stake-value num">{money(me.capital + risk, symbol)}</span>
          </div>
          <div className="decide__stake decide__stake--loss">
            <span className="decide__stake-label">If wrong</span>
            <span className="decide__stake-value num">
              {money(Math.max(0, me.capital - risk), symbol)}
            </span>
          </div>
        </div>

        {chosen ? (
          <motion.div
            className="decide__chosen"
            data-choice={chosen}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            {chosen === 'take' ? 'YOU CHOSE TO TAKE IT' : 'YOU CHOSE TO SIT OUT'}
            <span className="dim decide__chosen-sub">
              The question starts for everyone who took it, together.
            </span>
          </motion.div>
        ) : (
          <div className="decide__actions">
            <button
              className="btn btn--ghost btn--xl decide__sit"
              onClick={() => decide(false)}
              disabled={busy}
            >
              <span aria-hidden="true" style={{ verticalAlign: '-4px', marginRight: 8 }}>
                <CrossIcon size={20} />
              </span>
              Sit out
            </button>
            <button
              className="btn btn--gain btn--xl decide__take"
              onClick={() => decide(true)}
              disabled={busy}
              autoFocus
            >
              <span aria-hidden="true" style={{ verticalAlign: '-4px', marginRight: 8 }}>
                <CheckIcon size={20} />
              </span>
              Take it
            </button>
          </div>
        )}

        {me.premiumDecisionDeadline ? (
          <Countdown
            endsAt={me.premiumDecisionDeadline}
            duration={config.takeDecisionSeconds}
            label="Decide within"
            size="lg"
            tick
          />
        ) : null}

        <p className="dim decide__default">No choice before the timer ends counts as sitting out.</p>
      </motion.div>
    </div>
  );
}
