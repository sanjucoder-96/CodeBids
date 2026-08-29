/**
 * Global overlays: connection status, toasts, and the full-screen "flash"
 * used for the headline moments (spec sections 22, 59).
 */

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { dramaticReveal, fadeUp } from '../lib/motion.js';
import { money } from '../lib/format.js';

export function ConnectionBanner() {
  const connection = useStore((s) => s.connection);
  if (connection === 'open' || connection === 'idle') return null;

  const text =
    connection === 'connecting'
      ? 'Connecting to the game server…'
      : connection === 'reconnecting'
        ? 'Connection lost — reconnecting automatically. Your progress is safe on the server.'
        : 'Disconnected.';

  return (
    <motion.div
      className="conn-banner"
      data-state={connection}
      initial={{ y: -40 }}
      animate={{ y: 0 }}
      exit={{ y: -40 }}
      role="status"
      aria-live="polite"
    >
      <span className="spinner" aria-hidden="true" />
      {text}
    </motion.div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  return (
    <div className="toasts" role="log" aria-live="polite" aria-label="Notifications">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className="toast"
            data-kind={toast.kind}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            exit="exit"
            layout
            onClick={() => dismiss(toast.id)}
          >
            <span className="toast__bar" aria-hidden="true" />
            <span>
              <span className="toast__title">{toast.title}</span>
              {toast.detail ? <span className="toast__detail">{toast.detail}</span> : null}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const FLASH_DURATION: Record<string, number> = {
  auction_won: 3200,
  premium_unlocked: 3000,
  reclaim: 2600,
  correct: 2400,
  wrong: 2200,
  timeout: 2200,
  outbid: 1800,
  qualified: 2400,
  rank_up: 1600,
};

export function Flash() {
  const flash = useStore((s) => s.flash);
  const clear = useStore((s) => s.clearFlash);
  const symbol = useStore((s) => s.config.currencySymbol);

  useEffect(() => {
    if (!flash) return;
    const handle = setTimeout(clear, FLASH_DURATION[flash.kind] ?? 2400);
    return () => clearTimeout(handle);
  }, [flash, clear]);

  return (
    <AnimatePresence>
      {flash ? (
        <motion.div
          key={flash.id}
          className="flash"
          data-kind={flash.kind}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          role="status"
          aria-live="assertive"
        >
          <motion.div
            className="flash__card"
            variants={dramaticReveal}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <div className="flash__title">{flash.title}</div>
            {flash.subtitle ? <div className="flash__subtitle">{flash.subtitle}</div> : null}
            {flash.amount !== undefined ? (
              <motion.div
                className="flash__amount"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18, type: 'spring', stiffness: 320, damping: 26 }}
              >
                {flash.kind === 'correct' || flash.kind === 'wrong' || flash.kind === 'timeout'
                  ? `${flash.amount >= 0 ? '+' : ''}${money(flash.amount, symbol)}`
                  : money(flash.amount, symbol)}
              </motion.div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
