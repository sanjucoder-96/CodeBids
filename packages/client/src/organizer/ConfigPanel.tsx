/**
 * Live configuration (spec section 47).
 *
 * Every economy number in the round is editable here and nowhere else. Changes
 * are validated on the server; an invalid value is rejected and the previous
 * value is kept, so a typo mid-event cannot break the economy.
 */

import { useEffect, useState } from 'react';
import type { GameConfig } from '@code-market/shared';
import { useStore } from '../lib/store.js';

type NumericKey = {
  [K in keyof GameConfig]: GameConfig[K] extends number ? K : never;
}[keyof GameConfig];

type BooleanKey = {
  [K in keyof GameConfig]: GameConfig[K] extends boolean ? K : never;
}[keyof GameConfig];

const NUMBER_FIELDS: { key: NumericKey; label: string; help?: string }[] = [
  { key: 'startingCapital', label: 'Starting capital', help: 'Every team begins here.' },
  {
    key: 'protectedReserve',
    label: 'Protected reserve',
    help: 'Max bid = capital − reserve. Not a flat bid cap.',
  },
  { key: 'capitalFloor', label: 'Capital floor', help: 'Capital can never drop below this.' },
  { key: 'premiumStartingBid', label: 'Premium opening bid' },
  { key: 'premiumBidIncrement', label: 'Premium increment' },
  { key: 'finalPremiumStartingBid', label: 'Final premium opening bid' },
  { key: 'finalPremiumBidIncrement', label: 'Final premium increment' },
  { key: 'reclaimDecisionWindow', label: 'Reclaim window (s)', help: 'Accept-or-decline countdown.' },
  { key: 'defaultMarketTimeLimit', label: 'Default market time (s)' },
  { key: 'defaultPremiumTimeLimit', label: 'Default premium time (s)' },
  { key: 'qualifiers', label: 'Qualifiers for Round 3' },
  { key: 'submissionGraceMs', label: 'Submission grace (ms)', help: 'Latency allowance on the deadline.' },
  { key: 'speedBonusMax', label: 'Max speed bonus' },
  { key: 'codeExecutionTimeoutMs', label: 'Code run timeout (ms)' },
];

const TOGGLES: { key: BooleanKey; label: string; help?: string }[] = [
  { key: 'marketOptIn', label: 'Teams must opt in to market challenges' },
  { key: 'requireAccessKeyForMarket', label: 'Require the printed key to unlock a market challenge' },
  { key: 'marketPenaltyEnabled', label: 'Wrong market answers cost capital' },
  { key: 'marketTimeoutPenalised', label: 'A market timeout counts as wrong' },
  { key: 'speedBonusEnabled', label: 'Award a speed bonus' },
  { key: 'reclaimAutoDecline', label: 'Auto-decline a reclaim when the window lapses' },
  { key: 'revealExplanations', label: 'Show explanations after a result' },
  { key: 'soundEnabled', label: 'Sound cues enabled globally' },
  {
    key: 'codeExecutionEnabled',
    label: 'Enable the local code runner',
    help: 'Requires python / g++ / javac on this machine. No OS sandbox — see the README.',
  },
];

export function ConfigPanel() {
  const config = useStore((s) => s.config);
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);

  const [draft, setDraft] = useState<GameConfig>(config);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(config), [config]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  async function save() {
    setBusy(true);
    try {
      const result = (await call('UPDATE_CONFIG', { patch: draft })) as
        | { ok: boolean; errors: string[] }
        | undefined;
      if (result && !result.ok) {
        pushToast({ kind: 'warn', title: 'Some values were rejected', detail: result.errors.join('; ') });
      } else {
        pushToast({ kind: 'gain', title: 'Configuration saved' });
      }
    } catch (error) {
      pushToast({ kind: 'warn', title: error instanceof Error ? error.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="organizer__grid">
      <section className="panel panel--flush organizer__col--main">
        <div className="panel__head">
          <span className="panel__title">Economy &amp; timing</span>
          <div className="row">
            {dirty ? <span className="badge badge--premium">Unsaved changes</span> : null}
            <button className="btn btn--ghost btn--sm" onClick={() => setDraft(config)} disabled={!dirty}>
              Revert
            </button>
            <button className="btn btn--primary btn--sm" onClick={save} disabled={busy || !dirty}>
              Save
            </button>
          </div>
        </div>

        <div className="panel__body config-grid">
          {NUMBER_FIELDS.map((field) => (
            <div className="field" key={field.key}>
              <label className="label" htmlFor={`cfg-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`cfg-${field.key}`}
                className="input num"
                type="number"
                value={draft[field.key]}
                onChange={(event) =>
                  setDraft({ ...draft, [field.key]: Number(event.target.value) } as GameConfig)
                }
              />
              {field.help ? (
                <span className="dim" style={{ fontSize: 'var(--fs-2xs)' }}>
                  {field.help}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="panel panel--flush organizer__col--side">
        <div className="panel__head">
          <span className="panel__title">Rules</span>
        </div>
        <div className="panel__body stack">
          {TOGGLES.map((toggle) => (
            <label className="toggle" key={toggle.key}>
              <input
                type="checkbox"
                checked={draft[toggle.key]}
                onChange={(event) =>
                  setDraft({ ...draft, [toggle.key]: event.target.checked } as GameConfig)
                }
              />
              <span>
                <span className="toggle__label">{toggle.label}</span>
                {toggle.help ? <span className="toggle__help dim">{toggle.help}</span> : null}
              </span>
            </label>
          ))}

          <hr className="divider" />

          <div className="field">
            <label className="label" htmlFor="cfg-reward-mode">
              Market reward mode
            </label>
            <select
              id="cfg-reward-mode"
              className="select"
              value={draft.marketReward.mode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  marketReward: { ...draft.marketReward, mode: event.target.value as 'fixed' },
                })
              }
            >
              <option value="difficulty">Scale by difficulty</option>
              <option value="fixed">Fixed amount</option>
              <option value="percent">Percent of capital</option>
            </select>
          </div>

          <div className="field">
            <label className="label" htmlFor="cfg-reward-base">
              Reward base
            </label>
            <input
              id="cfg-reward-base"
              className="input num"
              type="number"
              value={draft.marketReward.base}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  marketReward: { ...draft.marketReward, base: Number(event.target.value) },
                })
              }
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="cfg-penalty-base">
              Penalty base
            </label>
            <input
              id="cfg-penalty-base"
              className="input num"
              type="number"
              value={draft.marketPenalty.base}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  marketPenalty: { ...draft.marketPenalty, base: Number(event.target.value) },
                })
              }
            />
          </div>

          <button className="btn btn--primary btn--block" onClick={save} disabled={busy || !dirty}>
            Save configuration
          </button>
        </div>
      </section>
    </div>
  );
}
