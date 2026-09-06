/**
 * Simulation / demo mode (spec section 42).
 *
 * Its real job is to let you SEE the animations before the event: seed a field,
 * fire a rank climb, run a reclaim chain, and watch the projector.
 */

import { useState } from 'react';
import { useStore } from '../lib/store.js';

const SCENARIOS = [
  {
    id: 'market_round',
    label: 'Market round',
    help: 'Every team answers the open question. Requires a normal question to be open.',
  },
  {
    id: 'premium_auction',
    label: 'Premium auction',
    help: 'Full auction with outbids, a winner, and an attempt. Requires a premium to be open.',
  },
  {
    id: 'reclaim_chain',
    label: 'Forced reclaim chain',
    help: 'Winner fails, the ladder walks: decline, then accept. Best way to rehearse the reclaim screens.',
  },
  {
    id: 'rank_swap',
    label: 'Rank climb',
    help: 'Drives the last-placed team to first in steps. This is the leaderboard animation test.',
  },
  {
    id: 'chaos',
    label: 'Chaos mode',
    help: 'Rapid overlapping capital changes to stress-test layout animation.',
  },
  {
    id: 'full_round',
    label: 'Full round',
    help: 'End-to-end dry run of the whole generated sequence. Takes a couple of minutes.',
  },
] as const;

export function SimulationPanel() {
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);
  const teams = useStore((s) => s.teams);

  const [count, setCount] = useState(20);
  const [replace, setReplace] = useState(false);
  const [intensity, setIntensity] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

  async function seed() {
    setBusy('seed');
    try {
      await call('SIM_SEED_TEAMS', { count, replace });
      pushToast({ kind: 'gain', title: `Seeded ${count} teams` });
    } catch (error) {
      pushToast({ kind: 'warn', title: error instanceof Error ? error.message : 'Failed' });
    } finally {
      setBusy(null);
    }
  }

  async function run(scenario: string) {
    setBusy(scenario);
    try {
      const result = (await call('SIM_RUN', { scenario, intensity })) as
        | { actions: number; notes: string[] }
        | undefined;
      pushToast({
        kind: 'info',
        title: `${scenario} finished`,
        detail: result ? `${result.actions} actions · ${result.notes.slice(-1)[0] ?? ''}` : undefined,
      });
    } catch (error) {
      pushToast({ kind: 'warn', title: error instanceof Error ? error.message : 'Failed' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel panel--flush">
      <div className="panel__head">
        <span className="panel__title">Simulation &amp; rehearsal</span>
        <span className="badge">{teams.length} teams</span>
      </div>

      <div className="panel__body stack">
        <div className="sim-warning">
          Simulated actions run through the real engine and are written to the real database. Use
          them before the event, then <strong>Reset round</strong> before the teams arrive.
        </div>

        <div className="row wrap">
          <div className="field" style={{ width: 140 }}>
            <label className="label" htmlFor="sim-count">
              Teams to seed
            </label>
            <input
              id="sim-count"
              className="input num"
              type="number"
              min={1}
              max={60}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </div>
          <label className="toggle" style={{ marginTop: 22 }}>
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            <span className="toggle__label">Replace existing teams</span>
          </label>
          <button className="btn btn--primary" onClick={seed} disabled={busy !== null} style={{ marginTop: 18 }}>
            {busy === 'seed' ? <span className="spinner" /> : null}
            Seed teams
          </button>
        </div>

        <div className="field" style={{ maxWidth: 320 }}>
          <label className="label" htmlFor="sim-intensity">
            Intensity ({intensity.toFixed(1)}×)
          </label>
          <input
            id="sim-intensity"
            type="range"
            min={0.5}
            max={3}
            step={0.5}
            value={intensity}
            onChange={(event) => setIntensity(Number(event.target.value))}
          />
        </div>

        <div className="sim-grid">
          {SCENARIOS.map((scenario) => (
            <div key={scenario.id} className="sim-card">
              <div className="sim-card__label">{scenario.label}</div>
              <p className="sim-card__help dim">{scenario.help}</p>
              <button
                className="btn btn--block"
                onClick={() => run(scenario.id)}
                disabled={busy !== null || teams.length === 0}
              >
                {busy === scenario.id ? <span className="spinner" /> : null}
                Run
              </button>
            </div>
          ))}
        </div>

        <button className="btn btn--ghost" onClick={() => call('SIM_STOP', {})}>
          Stop running simulation
        </button>
      </div>
    </section>
  );
}
