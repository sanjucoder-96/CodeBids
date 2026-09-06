/**
 * The question keys (spec section 12).
 *
 * The operator reads a key aloud before every normal question, so the one that
 * matters is the one open right now. That key gets its own card at the top,
 * large enough to read off a laptop screen while looking at the room. The rest
 * of the pool sits underneath as a reference table.
 *
 * Premium keys are listed for completeness but are never read out: the server
 * unlocks a premium for the auction winner itself. The table says so rather
 * than leaving the operator to wonder.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { difficultyLabel, domainLabel, slotLabel } from '../lib/format.js';
import { KeyIcon } from '../ui/Icons.js';
import type { Difficulty, Domain, QuestionKind } from '@code-market/shared';

interface QuestionRow {
  id: string;
  kind: QuestionKind;
  title: string;
  domain: Domain;
  difficulty: Difficulty;
  timeLimit: number;
  accessKey: string;
}

type Filter = 'in_round' | 'normal' | 'premium' | 'all';

const FILTERS: [Filter, string][] = [
  ['in_round', 'This round'],
  ['normal', 'Normal'],
  ['premium', 'Premium'],
  ['all', 'Whole pool'],
];

export function QuestionsPanel({ token }: { token: string }) {
  const sequence = useStore((s) => s.sequence);
  const game = useStore((s) => s.game);
  const requireKey = useStore((s) => s.config.requireAccessKey);

  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [filter, setFilter] = useState<Filter>('in_round');
  const [search, setSearch] = useState('');
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/organizer/questions', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setRows((await response.json()) as QuestionRow[]);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Where each question sits in the generated round, if it was drawn at all. */
  const slotFor = useMemo(
    () => new Map(sequence.map((slot) => [slot.questionId, slot])),
    [sequence],
  );

  const open = rows.find((row) => row.id === game?.currentQuestionId) ?? null;
  const openSlot = open ? slotFor.get(open.id) : undefined;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (filter === 'in_round') return slotFor.has(row.id);
        if (filter === 'normal') return row.kind === 'normal';
        if (filter === 'premium') return row.kind === 'premium';
        return true;
      })
      .filter((row) => {
        if (!term) return true;
        return (
          row.id.toLowerCase().includes(term) ||
          row.title.toLowerCase().includes(term) ||
          row.accessKey.toLowerCase().includes(term) ||
          domainLabel(row.domain).toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        // Round order first, so the table reads the way the event runs.
        const sa = slotFor.get(a.id)?.index ?? Number.MAX_SAFE_INTEGER;
        const sb = slotFor.get(b.id)?.index ?? Number.MAX_SAFE_INTEGER;
        if (sa !== sb) return sa - sb;
        return a.id.localeCompare(b.id);
      });
  }, [rows, filter, search, slotFor]);

  return (
    <section className="panel panel--flush organizer__col--main">
      <div className="panel__head">
        <span className="panel__title">Question keys</span>
        <button className="btn btn--ghost btn--sm" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="panel__body stack">
        {failed ? (
          <div className="empty-state">
            <p className="muted">Could not load the question keys.</p>
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              Sign out and back in if this persists.
            </p>
          </div>
        ) : null}

        {/* --- the key that matters right now --------------------------- */}
        {open ? (
          <motion.div
            key={open.id}
            className="qkey"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24 }}
          >
            <div className="qkey__meta">
              <span className="qkey__label">
                {openSlot
                  ? `${slotLabel(openSlot.blockNumber, openSlot.positionInBlock, openSlot.kind)} · NOW OPEN`
                  : 'NOW OPEN'}
              </span>
              <span className="qkey__title">{open.title}</span>
              <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                {domainLabel(open.domain)} · {difficultyLabel(open.difficulty)} · {open.timeLimit}s
              </span>
            </div>

            {open.kind === 'premium' ? (
              <div className="qkey__none">
                <span className="qkey__none-title">No key to read</span>
                <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                  The winner is authorised automatically.
                </span>
              </div>
            ) : (
              <div className="qkey__value">
                <span aria-hidden="true" className="qkey__icon">
                  <KeyIcon size={22} />
                </span>
                <span className="qkey__code mono">{open.accessKey}</span>
              </div>
            )}
          </motion.div>
        ) : (
          <div className="empty-state">
            <p className="muted">No question is open.</p>
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              The key for the open question appears here, ready to read aloud.
            </p>
          </div>
        )}

        {!requireKey ? (
          <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
            Keys are currently switched off in Config, so teams are not asked for one.
          </p>
        ) : null}

        {/* --- the reference table -------------------------------------- */}
        <div className="row wrap">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              className="btn btn--sm btn--ghost"
              data-active={filter === value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
          <input
            className="input input--sm qtable__search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a key, title or domain"
            aria-label="Filter questions"
          />
        </div>

        {visible.length === 0 ? (
          <div className="empty-state">
            <p className="muted">
              {filter === 'in_round'
                ? 'The round has not been generated yet.'
                : 'Nothing matches that search.'}
            </p>
          </div>
        ) : (
          <div className="qtable" role="table" aria-label="Question keys">
            <div className="qtable__head" role="row">
              <span>Slot</span>
              <span>Question</span>
              <span>Domain</span>
              <span>Difficulty</span>
              <span>Time</span>
              <span>Key</span>
            </div>

            {visible.map((row) => {
              const slot = slotFor.get(row.id);
              return (
                <div
                  key={row.id}
                  className="qtable__row"
                  role="row"
                  data-open={row.id === open?.id}
                  data-state={slot?.state ?? 'unused'}
                >
                  <span className="mono dim">
                    {slot ? slotLabel(slot.blockNumber, slot.positionInBlock, slot.kind) : '—'}
                  </span>
                  <span className="qtable__title">
                    <strong>{row.title}</strong>
                    <span className="mono dim"> {row.id}</span>
                  </span>
                  <span className="dim">{domainLabel(row.domain)}</span>
                  <span className="qtable__diff" data-difficulty={row.difficulty}>
                    {difficultyLabel(row.difficulty)}
                  </span>
                  <span className="num dim">{row.timeLimit}s</span>
                  <span className="mono qtable__key">
                    {row.kind === 'premium' ? (
                      <span className="dim" title="The winner is authorised automatically">
                        not read aloud
                      </span>
                    ) : (
                      row.accessKey
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
