/**
 * Premium and reclaim control (spec sections 14-17, 31).
 *
 * The operator sees the whole ladder, who is authorised, what they risk, and
 * gets large unambiguous buttons for the two things that can happen next.
 */

import { useState } from 'react';
import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { money } from '../lib/format.js';

export function PremiumControl() {
  const premium = useStore((s) => s.premium);
  const teams = useStore((s) => s.teams);
  const config = useStore((s) => s.config);
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  async function act(command: string, payload: unknown = {}) {
    setBusy(true);
    try {
      await call(command, payload);
    } catch (error) {
      pushToast({ kind: 'warn', title: error instanceof Error ? error.message : 'Command failed' });
    } finally {
      setBusy(false);
    }
  }

  if (!premium || premium.stage === 'idle') return null;

  const symbol = config.currencySymbol;
  const name = (id: string | null) => (id ? (teams.find((t) => t.id === id)?.name ?? id) : '—');
  const attempting = premium.stage === 'attempt_1' || premium.stage === 'attempt_2';
  const canStart = premium.stage === 'sold' && premium.activeTeamId !== null;
  const offering = premium.stage === 'reclaim_offer';

  return (
    <section className="panel panel--flush panel--premium">
      <div className="panel__head">
        <span className="panel__title">Premium control · {premium.questionId}</span>
        <span className="badge badge--premium">
          {premium.stage.replace(/_/g, ' ').toUpperCase()}
          {premium.attemptNumber > 0 ? ` · ATTEMPT ${premium.attemptNumber}/2` : ''}
        </span>
      </div>

      <div className="panel__body stack">
        {premium.activeTeamId ? (
          <div className="prem-active">
            <div>
              <span className="label">Authorised team</span>
              <div className="prem-active__team">
                <span className="mono">{premium.activeTeamId}</span> {name(premium.activeTeamId)}
              </div>
            </div>
            <div>
              <span className="label">Risk</span>
              <div className="prem-active__risk num">{money(premium.activeRisk ?? 0, symbol)}</div>
            </div>
          </div>
        ) : null}

        {canStart && premium.attemptNumber === 0 ? (
          <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
            The winning bidder must attempt this premium — there is no sit-out for the winner.
          </p>
        ) : null}

        <div className="row wrap">
          {canStart ? (
            <button className="btn btn--premium btn--xl" onClick={() => act('START_PREMIUM_ATTEMPT')} disabled={busy}>
              Start attempt {premium.attemptNumber + 1} of 2
            </button>
          ) : null}

          {attempting ? (
            <>
              <button
                className="btn btn--gain btn--lg"
                onClick={() => act('FORCE_PREMIUM_RESULT', { result: 'correct' })}
                disabled={busy}
              >
                Record CORRECT
              </button>
              <button
                className="btn btn--loss btn--lg"
                onClick={() => act('FORCE_PREMIUM_RESULT', { result: 'wrong' })}
                disabled={busy}
              >
                Record WRONG
              </button>
              <button
                className="btn btn--lg"
                onClick={() => act('FORCE_PREMIUM_RESULT', { result: 'timeout' })}
                disabled={busy}
              >
                Record TIMEOUT
              </button>
              <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                Only needed if the team cannot submit from their laptop — a normal submission
                settles automatically.
              </span>
            </>
          ) : null}

          {offering ? (
            <>
              <span className="badge badge--premium">
                OFFERED TO {premium.offerTeamId} · {money(premium.offerRisk ?? 0, symbol)}
              </span>
              <button
                className="btn btn--gain"
                onClick={() => act('RESOLVE_RECLAIM', { teamId: premium.offerTeamId, accept: true })}
                disabled={busy}
              >
                They accepted
              </button>
              <button
                className="btn"
                onClick={() => act('RESOLVE_RECLAIM', { teamId: premium.offerTeamId, accept: false })}
                disabled={busy}
              >
                They declined
              </button>
            </>
          ) : null}

          {premium.stage !== 'closed' ? (
            <button className="btn btn--ghost" onClick={() => act('CLOSE_PREMIUM')} disabled={busy}>
              Close premium
            </button>
          ) : (
            <span className="badge">
              OUTCOME: {(premium.outcome ?? 'closed').replace(/_/g, ' ').toUpperCase()}
            </span>
          )}
        </div>

        {premium.ladder.length > 0 ? (
          <div>
            <span className="label">Reclaim ladder — original auction order</span>
            <div className="ladder">
              {premium.ladder.map((entry, index) => (
                <motion.div
                  key={entry.teamId}
                  layout
                  className="ladder__row"
                  data-state={entry.state}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.04 }}
                >
                  <span className="ladder__pos">{index + 1}</span>
                  <span className="ladder__team mono">{entry.teamId}</span>
                  <span className="ladder__name">{name(entry.teamId)}</span>
                  <span className="ladder__amount num">{money(entry.amount, symbol)}</span>
                  <span className="ladder__state">{entry.state.toUpperCase()}</span>
                  {/* Only the second bidder (rank 2) can ever be offered a reclaim (spec 7). */}
                  {entry.rank === 2 && entry.state === 'pending' && premium.attemptNumber < 2 && !offering ? (
                    <button
                      className="btn btn--sm"
                      onClick={() => act('OFFER_RECLAIM', { teamId: entry.teamId })}
                      disabled={busy}
                    >
                      Offer
                    </button>
                  ) : null}
                </motion.div>
              ))}
            </div>
            <p className="dim" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-2)' }}>
              There is never a second auction. Only the second bidder can reclaim, at their own
              original bid — never a third bidder. Maximum two attempts.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
