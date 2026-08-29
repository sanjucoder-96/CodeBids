/**
 * The pending events queue (spec section 32).
 * Anything needing operator attention floats to the top.
 */

import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { relativeTime } from '../lib/format.js';

const KIND_LABEL: Record<string, string> = {
  attempting: 'ATTEMPTING',
  submitted: 'SUBMITTED',
  reclaim_offer: 'RECLAIM',
  awaiting_confirm: 'CONFIRM',
  disconnected: 'OFFLINE',
};

export function LiveEventsPanel() {
  const events = useStore((s) => s.liveEvents);
  const attention = events.filter((e) => e.needsAttention).length;

  return (
    <section className="panel panel--flush">
      <div className="panel__head">
        <span className="panel__title">Live events</span>
        {attention > 0 ? (
          <span className="badge badge--premium">{attention} need attention</span>
        ) : (
          <span className="badge badge--gain badge--dot">All clear</span>
        )}
      </div>

      <div className="live-events">
        <AnimatePresence initial={false}>
          {events.map((event) => (
            <motion.div
              key={event.id}
              layout
              className="live-event"
              data-kind={event.kind}
              data-attention={event.needsAttention}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12, transition: { duration: 0.16 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            >
              <span className="live-event__team mono">{event.teamId}</span>
              <span className="live-event__name">{event.teamName}</span>
              <span className="live-event__label">{event.label}</span>
              <span className="live-event__kind">{KIND_LABEL[event.kind] ?? event.kind}</span>
              <span className="live-event__since dim">{relativeTime(event.since)}</span>
            </motion.div>
          ))}
        </AnimatePresence>

        {events.length === 0 ? (
          <div className="empty-state">
            <p className="muted">Nothing needs you right now.</p>
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              Market results settle automatically — volunteers do not report them.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
