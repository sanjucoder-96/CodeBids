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
  { key: 'blocks', label: 'Blocks', help: 'Each block is N questions then a premium.' },
  { key: 'questionsPerBlock', label: 'Questions per block', help: 'Drawn at random.' },
  { key: 'noRepeatWindow', label: 'No-repeat window', help: 'Questions before an item may recur.' },
  { key: 'questionIntroSeconds', label: 'Intro card (s)' },
  { key: 'premiumWindowSeconds', label: 'Premium window (s)', help: 'The whole premium process.' },
  { key: 'premiumSolveSeconds', label: 'Premium solve time (s)' },
  { key: 'strategyWindowSeconds', label: 'Strategy phase (s)' },
  { key: 'hideLeaderboardLastQuestions', label: 'Blackout last N questions' },
  { key: 'podiumPlaces', label: 'Podium places' },
  { key: 'submissionGraceMs', label: 'Submission grace (ms)', help: 'Latency allowance on the deadline.' },
  { key: 'speedBonusMax', label: 'Max speed bonus' },
  { key: 'codeExecutionTimeoutMs', label: 'Code run timeout (ms)' },
];

const TOGGLES: { key: BooleanKey; label: string; help?: string }[] = [
  { key: 'questionOptIn', label: 'Teams must opt in to each question' },
  { key: 'requireAccessKey', label: 'Require the printed key to unlock a question' },
  { key: 'penaltyEnabled', label: 'Wrong answers cost capital' },
  { key: 'timeoutPenalised', label: 'A timeout counts as wrong' },
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
              Reward mode
            </label>
            <select
              id="cfg-reward-mode"
              className="select"
              value={draft.questionReward.mode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  questionReward: { ...draft.questionReward, mode: event.target.value as 'fixed' },
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
              value={draft.questionReward.base}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  questionReward: { ...draft.questionReward, base: Number(event.target.value) },
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
              value={draft.questionPenalty.base}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  questionPenalty: { ...draft.questionPenalty, base: Number(event.target.value) },
                })
              }
            />
          </div>

          <hr className="divider" />

          <div>
            <span className="label">Solve time by difficulty (seconds)</span>
            <div className="config-times">
              {(['easy', 'medium', 'hard', 'very_hard'] as const).map((tier) => (
                <div className="field" key={tier}>
                  <label className="label" htmlFor={`time-${tier}`}>
                    {tier.replace('_', ' ')}
                  </label>
                  <input
                    id={`time-${tier}`}
                    className="input num"
                    type="number"
                    min={5}
                    value={draft.difficultyTimes[tier]}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        difficultyTimes: {
                          ...draft.difficultyTimes,
                          [tier]: Number(event.target.value),
                        },
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <p className="dim" style={{ fontSize: 'var(--fs-2xs)' }}>
              Applied when the question pool is seeded. Never hard-coded in a component.
            </p>
          </div>

          <button className="btn btn--primary btn--block" onClick={save} disabled={busy || !dirty}>
            Save configuration
          </button>
        </div>
      </section>
    </div>
  );
}
