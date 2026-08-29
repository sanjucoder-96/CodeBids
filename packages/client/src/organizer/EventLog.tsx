/**
 * The audit trail (spec section 35). This is the dispute-resolution surface:
 * every bid, every result, every capital change, with a timestamp.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AuditEntry } from '@code-market/shared';
import { useStore } from '../lib/store.js';
import { timeOfDay } from '../lib/format.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'capital', label: 'Capital', match: /CAPITAL|RESULT/ },
  { id: 'auction', label: 'Auction', match: /AUCTION|BID/ },
  { id: 'premium', label: 'Premium', match: /PREMIUM|RECLAIM/ },
  { id: 'system', label: 'System', match: /GAME|CONFIG|TEAM|CHALLENGE/ },
] as const;

export function EventLog({ token }: { token: string }) {
  const live = useStore((s) => s.audit);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/organizer/audit?limit=1000', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) setHistory((await response.json()) as AuditEntry[]);
    } catch {
      /* live entries still stream over the socket */
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = useMemo(() => {
    const seen = new Set<number>();
    const merged = [...history, ...live].filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
    const active = FILTERS.find((f) => f.id === filter);
    const needle = query.trim().toLowerCase();

    return merged
      .filter((entry) => (active && 'match' in active && active.match ? active.match.test(entry.action) : true))
      .filter((entry) =>
        needle
          ? `${entry.action} ${entry.teamId ?? ''} ${entry.challengeId ?? ''} ${JSON.stringify(entry.metadata)}`
              .toLowerCase()
              .includes(needle)
          : true,
      )
      .sort((a, b) => b.id - a.id)
      .slice(0, 400);
  }, [history, live, filter, query]);

  return (
    <div className="organizer__grid organizer__grid--single">
      <section className="panel panel--flush">
        <div className="panel__head">
          <span className="panel__title">Event log ({entries.length})</span>
          <div className="row wrap">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                className="btn btn--sm btn--ghost"
                data-active={filter === option.id}
                onClick={() => setFilter(option.id)}
                aria-pressed={filter === option.id}
              >
                {option.label}
              </button>
            ))}
            <input
              className="input"
              style={{ width: 220 }}
              placeholder="Search team, action…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search the event log"
            />
            <button className="btn btn--sm btn--ghost" onClick={() => void load()}>
              Reload
            </button>
          </div>
        </div>

        <div className="log">
          <AnimatePresence initial={false}>
            {entries.map((entry) => (
              <motion.div
                key={entry.id}
                layout
                className="log__row"
                data-action={entry.action}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                <span className="log__time mono">{timeOfDay(entry.timestamp)}</span>
                <span className="log__team mono">{entry.teamId ?? '—'}</span>
                <span className="log__action">{entry.action}</span>
                <span className="log__challenge mono dim">{entry.challengeId ?? ''}</span>
                <span className="log__meta dim">{summarise(entry.metadata)}</span>
              </motion.div>
            ))}
          </AnimatePresence>

          {entries.length === 0 ? (
            <div className="empty-state">
              <p className="muted">No entries match this filter.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function summarise(metadata: Record<string, unknown>): string {
  const keys = Object.keys(metadata);
  if (keys.length === 0) return '';
  return keys
    .slice(0, 5)
    .map((key) => `${key}=${formatValue(metadata[key])}`)
    .join('  ');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 40);
  return String(value).slice(0, 40);
}
