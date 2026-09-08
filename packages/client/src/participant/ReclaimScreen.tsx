/**
 * The reclaim decision (spec section 16).
 *
 * A very short window, a very clear choice. The deadline is server-owned: if it
 * lapses the server auto-declines and moves to the next bidder, so this screen
 * only has to make the choice obvious and fast.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { money } from '../lib/format.js';
import { dramaticReveal } from '../lib/motion.js';
import { sound } from '../lib/sound.js';
import { AlertIcon } from '../ui/Icons.js';

export function ReclaimScreen() {
  const me = useStore((s) => s.me);
  const premium = useStore((s) => s.premium);
  const symbol = useStore((s) => s.config.currencySymbol);
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);
  const serverNow = useStore((s) => s.serverNow);
  const config = useStore((s) => s.config);

  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);

  const offer = me?.reclaimOffer ?? null;

  useEffect(() => {
    if (!offer) return;
    const update = () => setRemaining(Math.max(0, offer.deadline - serverNow()));
    update();
    const handle = setInterval(update, 80);
    return () => clearInterval(handle);
  }, [offer, serverNow]);

  useEffect(() => {
    if (offer) sound.play('reclaim');
  }, [offer?.questionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!offer || !me) return null;

  const seconds = Math.ceil(remaining / 1000);
  const total = config.reclaimDecisionWindow * 1000;
  const progress = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const failed = premium?.failedTeamId;

  async function respond(accept: boolean) {
    if (busy || !offer) return;
    setBusy(true);
    try {
      await call('RECLAIM_RESPONSE', { questionId: offer.questionId, accept });
    } catch (error) {
      pushToast({
        kind: 'warn',
        title: error instanceof Error ? error.message : 'Could not send your answer',
      });
      setBusy(false);
    }
  }

  return (
    <div className="screen screen--center">
      <motion.div
        className="panel panel--premium reclaim"
        variants={dramaticReveal}
        initial="hidden"
        animate="show"
      >
        <div className="reclaim__banner">
          <span aria-hidden="true">
            <AlertIcon size={18} />
          </span>
          TAKE OR SIT OUT
        </div>

        {failed ? (
          <p className="reclaim__context">
            <span className="mono">{failed}</span> failed. You were the second-highest bidder, so the
            question is offered to you — and to you alone.
          </p>
        ) : null}

        <h2 className="reclaim__title">Take the question, or sit out?</h2>

        <div className="reclaim__risk">
          <span className="label">Your original bid becomes your risk</span>
          <motion.span
            className="reclaim__amount num"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.16, type: 'spring', stiffness: 320, damping: 22 }}
          >
            {money(offer.risk, symbol)}
          </motion.span>
        </div>

        <div className="reclaim__outcomes">
          <span className="gain num">
            Correct → {money(me.capital + offer.risk, symbol)}
          </span>
          <span className="dim">·</span>
          <span className="loss num">
            Wrong → {money(Math.max(0, me.capital - offer.risk), symbol)}
          </span>
        </div>

        <div className="reclaim__timer" data-critical={seconds <= 2}>
          <div className="reclaim__timer-value num">{seconds}</div>
          <div className="reclaim__timer-track">
            <motion.div
              className="reclaim__timer-bar"
              style={{ transform: `scaleX(${progress})` }}
              transition={{ duration: 0.08, ease: 'linear' }}
            />
          </div>
          <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
            No choice before the timer ends counts as sitting out, and the premium closes.
          </p>
        </div>

        <div className="reclaim__actions">
          <button
            className="btn btn--ghost btn--xl"
            onClick={() => respond(false)}
            disabled={busy}
          >
            Sit out
          </button>
          <button
            className="btn btn--premium btn--xl"
            onClick={() => respond(true)}
            disabled={busy}
            autoFocus
          >
            {busy ? <span className="spinner" /> : null}
            Take it
          </button>
        </div>
      </motion.div>
    </div>
  );
}
