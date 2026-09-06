/**
 * Team registration and status (spec sections 30, 37).
 * This is also where the operator finds the printed JOIN CODES.
 */

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';
import { money } from '../lib/format.js';
import type { TeamStats } from '@code-market/shared';

interface TeamRow {
  id: string;
  name: string;
  capital: number;
  startingCapital: number;
  status: string;
  connectionStatus: string;
  joinCode: string;
  seatLabel: string | null;
  volunteer: string | null;
  stats: TeamStats;
}

export function TeamsPanel({ token }: { token: string }) {
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);
  const teams = useStore((s) => s.teams);
  const symbol = useStore((s) => s.config.currencySymbol);

  const [rows, setRows] = useState<TeamRow[]>([]);
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState(false);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/organizer/teams', {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.ok) setRows((await response.json()) as TeamRow[]);
    } catch {
      /* the socket keeps the live view fresh regardless */
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load, teams.length]);

  async function createTeams() {
    const lines = bulk
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    setBusy(true);
    try {
      await call('CREATE_TEAMS', {
        teams: lines.map((line) => {
          const [name, seatLabel, volunteer] = line.split(',').map((p) => p.trim());
          return { name: name ?? line, seatLabel, volunteer };
        }),
      });
      setBulk('');
      pushToast({ kind: 'gain', title: `${lines.length} team(s) created` });
      await load();
    } catch (error) {
      pushToast({ kind: 'warn', title: error instanceof Error ? error.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function adjust(teamId: string) {
    const amount = Number(adjustAmount);
    if (!Number.isFinite(amount) || amount === 0) return;
    setBusy(true);
    try {
      await call('ADJUST_CAPITAL', {
        teamId,
        amount,
        reason: adjustReason.trim() || 'Manual adjustment',
      });
      setAdjusting(null);
      setAdjustAmount('');
      setAdjustReason('');
      await load();
    } catch (error) {
      pushToast({ kind: 'warn', title: error instanceof Error ? error.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function removeTeam(teamId: string) {
    setBusy(true);
    try {
      await call('DELETE_TEAM', { teamId });
      await load();
    } catch (error) {
      pushToast({ kind: 'warn', title: error instanceof Error ? error.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  function printCards() {
    window.print();
  }

  return (
    <div className="organizer__grid">
      <section className="panel panel--flush organizer__col--main">
        <div className="panel__head">
          <span className="panel__title">Teams ({rows.length})</span>
          <div className="row">
            <button className="btn btn--sm btn--ghost" onClick={printCards}>
              Print join codes
            </button>
            <button className="btn btn--sm btn--ghost" onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>

        <div className="teams-table" role="table">
          <div className="teams-table__head" role="row">
            <span>Team</span>
            <span>Join code</span>
            <span>Capital</span>
            <span>Questions</span>
            <span>Premium</span>
            <span>Status</span>
            <span />
          </div>

          {rows.map((row) => (
            <div key={row.id} className="teams-table__row" role="row">
              <span className="teams-table__team">
                <strong>{row.name}</strong>
                <span className="mono dim">{row.id}</span>
                {row.seatLabel ? <span className="dim"> · {row.seatLabel}</span> : null}
              </span>
              <span className="mono teams-table__code">{row.joinCode}</span>
              <span className="num">{money(row.capital, symbol)}</span>
              <span className="num dim" title="Correct of attempted, plus questions sat out">
                {row.stats.correct}/{row.stats.attempted}
                {row.stats.skipped > 0 ? ` · ${row.stats.skipped} out` : ''}
              </span>
              <span className="num dim">
                {row.stats.premiumCorrect}/{row.stats.premiumAttempts} · {row.stats.premiumWins}W
              </span>
              <span>
                <span
                  className={`badge badge--dot ${row.connectionStatus === 'online' ? 'badge--gain' : ''}`}
                >
                  {row.connectionStatus.toUpperCase()}
                </span>
              </span>
              <span className="row">
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => setAdjusting(adjusting === row.id ? null : row.id)}
                >
                  Adjust
                </button>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => removeTeam(row.id)}
                  disabled={busy}
                  title="Remove this team"
                >
                  ✕
                </button>
              </span>

              {adjusting === row.id ? (
                <div className="teams-table__adjust">
                  <input
                    className="input"
                    style={{ width: 130 }}
                    placeholder="+250 or -100"
                    value={adjustAmount}
                    onChange={(event) => setAdjustAmount(event.target.value)}
                    aria-label="Adjustment amount"
                  />
                  <input
                    className="input"
                    placeholder="Reason (recorded in the audit log)"
                    value={adjustReason}
                    onChange={(event) => setAdjustReason(event.target.value)}
                    aria-label="Adjustment reason"
                  />
                  <button className="btn btn--sm btn--primary" onClick={() => adjust(row.id)} disabled={busy}>
                    Apply
                  </button>
                </div>
              ) : null}
            </div>
          ))}

          {rows.length === 0 ? (
            <div className="empty-state">
              <p className="muted">No teams registered yet.</p>
              <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                Add them on the right, or seed demo teams from the Tools tab.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel panel--flush organizer__col--side">
        <div className="panel__head">
          <span className="panel__title">Register teams</span>
        </div>
        <div className="panel__body stack">
          <div className="field">
            <label className="label" htmlFor="bulk-teams">
              One team per line
            </label>
            <textarea
              id="bulk-teams"
              className="textarea"
              value={bulk}
              onChange={(event) => setBulk(event.target.value)}
              placeholder={'CODEFORCE, Row 1, Priya\nALGO KINGS, Row 1, Rahul\nBYTE SQUAD'}
              rows={10}
            />
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              Format: name, seat (optional), volunteer (optional). Team IDs and join codes are
              generated automatically.
            </p>
          </div>
          <button className="btn btn--primary btn--block" onClick={createTeams} disabled={busy || !bulk.trim()}>
            Create teams
          </button>
        </div>
      </section>
    </div>
  );
}
