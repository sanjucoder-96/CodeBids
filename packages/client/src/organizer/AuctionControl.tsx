/**
 * The auction operator interface (spec section 13).
 *
 * Design constraints, taken literally from the spec:
 *  - "Clicking a team should be extremely fast."
 *  - "Do NOT make operator type team IDs."
 *  - the system validates, records, broadcasts and updates the projector.
 *
 * So: one big grid of team tiles. One click = one bid at the next call. Teams
 * that cannot afford the next call are visibly and functionally disabled BEFORE
 * the operator clicks, using the ceiling the server broadcasts. Keyboard
 * shortcuts are offered as optional acceleration, never as the only route.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { RollingNumber } from '../ui/AnimatedNumber.js';
import { money, domainLabel, difficultyLabel } from '../lib/format.js';

export function AuctionControl() {
  const auction = useStore((s) => s.auction);
  const teams = useStore((s) => s.teams);
  const sequence = useStore((s) => s.sequence);
  const preview = useStore((s) => s.premiumPreview);
  const game = useStore((s) => s.game);
  const symbol = useStore((s) => s.config.currencySymbol);
  const call = useStore((s) => s.call);
  const pushToast = useStore((s) => s.pushToast);

  const [busy, setBusy] = useState(false);
  const [customBid, setCustomBid] = useState('');

  const premiumSlots = useMemo(
    () => sequence.filter((s) => s.kind === 'premium'),
    [sequence],
  );

  const act = useCallback(
    async (command: string, payload: unknown) => {
      setBusy(true);
      try {
        await call(command, payload);
      } catch (error) {
        pushToast({
          kind: 'warn',
          title: error instanceof Error ? error.message : 'Command failed',
        });
      } finally {
        setBusy(false);
      }
    },
    [call, pushToast],
  );

  const open =
    auction &&
    (auction.auction.status === 'open' ||
      auction.auction.status === 'going_once' ||
      auction.auction.status === 'going_twice');

  // Optional keyboard acceleration (spec section 13).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === '1') void act('CALL_AUCTION', { call: 'once' });
      else if (event.key === '2') void act('CALL_AUCTION', { call: 'twice' });
      else if (event.key === 'Enter' && event.shiftKey) void act('CLOSE_AUCTION', {});
      else if (event.key === 'Backspace') {
        event.preventDefault();
        void act('UNDO_BID', {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, act]);

  if (!auction) {
    return (
      <section className="panel panel--flush">
        <div className="panel__head">
          <span className="panel__title">Auction control</span>
        </div>
        <div className="panel__body">
          {preview ? (
            <>
              <p className="muted" style={{ marginBottom: 'var(--sp-4)' }}>
                {preview.isFinalPremium ? 'FINAL PREMIUM' : `Premium #${preview.premiumNumber}`} ·{' '}
                {domainLabel(preview.domain)} · {difficultyLabel(preview.difficulty)} ·{' '}
                {preview.timeLimit}s · opens at {money(preview.startingBid, symbol)}
              </p>
              <button
                className="btn btn--premium btn--xl"
                disabled={busy}
                onClick={() => act('START_AUCTION', {})}
              >
                Start the auction
              </button>
            </>
          ) : premiumSlots.length === 0 ? (
            <p className="muted">The round has not been generated yet.</p>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: 'var(--sp-4)' }}>
                Advance to a premium slot to open its auction. The projector switches itself.
              </p>
              <div className="row wrap">
                {premiumSlots.map((slot) => (
                  <button
                    key={slot.index}
                    className={`btn ${slot.isFinalPremium ? 'btn--premium' : ''}`}
                    disabled={busy || slot.state === 'complete'}
                    onClick={() => act('OPEN_SLOT', { slotIndex: slot.index })}
                  >
                    {slot.isFinalPremium ? 'FINAL PREMIUM' : `Block ${slot.blockNumber} premium`}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  const leader = auction.auction.currentLeaderTeamId;
  const closed = auction.auction.status === 'closed';
  const isFinal = auction.preview.isFinalPremium;

  return (
    <section className={`panel panel--flush auction-ctl ${isFinal ? 'panel--premium' : ''}`}>
      <div className="panel__head">
        <span className="panel__title">
          {isFinal ? 'FINAL PREMIUM' : `PREMIUM #${auction.preview.premiumNumber}`} ·{' '}
          {domainLabel(auction.preview.domain)} · {difficultyLabel(auction.preview.difficulty)}
        </span>
        <span className={`badge ${closed ? '' : 'badge--premium'}`}>
          {auction.auction.status.replace(/_/g, ' ').toUpperCase()}
        </span>
      </div>

      <div className="auction-ctl__bids">
        <div className="auction-ctl__bid">
          <span className="label">Current bid</span>
          <RollingNumber
            className="auction-ctl__bid-value num"
            value={auction.auction.currentBid ?? 0}
            format={(n) => (auction.auction.currentBid === null ? '—' : money(n, symbol))}
          />
        </div>
        <div className="auction-ctl__bid auction-ctl__bid--next">
          <span className="label">Next call</span>
          <span className="auction-ctl__bid-value num">{money(auction.nextBid, symbol)}</span>
        </div>
        <div className="auction-ctl__bid">
          <span className="label">Leader</span>
          <span className="auction-ctl__bid-value auction-ctl__leader">
            {leader ?? '—'}
          </span>
        </div>
        <div className="auction-ctl__bid">
          <span className="label">Bidders</span>
          <span className="auction-ctl__bid-value num">{auction.bidders.length}</span>
        </div>
      </div>

      {!closed ? (
        <>
          <div className="auction-ctl__hint">
            Click a team to record a bid at <strong>{money(auction.nextBid, symbol)}</strong>. Greyed
            teams cannot legally reach that price.
            <span className="auction-ctl__keys">
              <kbd>1</kbd> going once <kbd>2</kbd> going twice <kbd>⌫</kbd> undo{' '}
              <kbd>⇧↵</kbd> close
            </span>
          </div>

          <div className="team-grid" role="group" aria-label="Record a bid">
            {teams.map((team) => {
              const isLeader = team.id === leader;
              // The tile reflects the amount that WOULD be recorded, so a custom
              // amount immediately re-greys the teams that cannot reach it.
              const target = customBid.trim() === '' ? auction.nextBid : Number(customBid);
              const affordable = team.maxBid >= target;
              const inAuction = auction.bidders.some((b) => b.teamId === team.id);
              return (
                <motion.button
                  key={team.id}
                  className="team-tile"
                  data-leader={isLeader}
                  data-in={inAuction}
                  data-poor={!affordable}
                  disabled={busy || isLeader || !affordable || team.status !== 'active'}
                  onClick={async () => {
                    const override = customBid.trim() === '' ? undefined : Number(customBid);
                    await act(
                      'PLACE_BID',
                      override === undefined
                        ? { teamId: team.id }
                        : { teamId: team.id, amount: override },
                    );
                    setCustomBid('');
                  }}
                  whileTap={{ scale: 0.96 }}
                  title={
                    isLeader
                      ? 'Already the highest bidder'
                      : affordable
                        ? `Bid ${money(target, symbol)} for ${team.name}`
                        : `Max bid ${money(team.maxBid, symbol)} — cannot reach ${money(target, symbol)}`
                  }
                >
                  <span className="team-tile__id">{team.id}</span>
                  <span className="team-tile__max num">{money(team.maxBid, symbol)}</span>
                  {isLeader ? <span className="team-tile__flag">LEADING</span> : null}
                  {team.connectionStatus === 'offline' ? (
                    <span className="team-tile__off" title="Disconnected">
                      ○
                    </span>
                  ) : null}
                </motion.button>
              );
            })}
          </div>

          <div className="auction-ctl__actions">
            <div className="row">
              <input
                className="input"
                style={{ width: 130 }}
                placeholder="Custom ₹"
                value={customBid}
                inputMode="numeric"
                onChange={(event) => setCustomBid(event.target.value.replace(/[^0-9]/g, ''))}
                aria-label="Custom bid amount"
              />
              <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                then click a team
              </span>
            </div>
            <div className="row">
              <button className="btn btn--ghost" onClick={() => act('UNDO_BID', {})} disabled={busy}>
                Undo bid
              </button>
              <button
                className="btn"
                onClick={() => act('CALL_AUCTION', { call: 'once' })}
                disabled={busy}
              >
                Going once
              </button>
              <button
                className="btn"
                onClick={() => act('CALL_AUCTION', { call: 'twice' })}
                disabled={busy}
              >
                Going twice
              </button>
              <button
                className="btn btn--premium btn--lg"
                onClick={() => act('CLOSE_AUCTION', {})}
                disabled={busy}
              >
                SOLD — close auction
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="panel__body">
          <div className="auction-ctl__sold">
            {auction.auction.winnerTeamId ? (
              <>
                <span className="eyebrow">Sold to</span>
                <span className="auction-ctl__sold-team">{auction.auction.winnerTeamId}</span>
                <span className="auction-ctl__sold-amount num">
                  {money(auction.auction.winningAmount ?? 0, symbol)}
                </span>
              </>
            ) : (
              <span className="muted">Closed with no bids.</span>
            )}
          </div>
        </div>
      )}

      <div className="auction-ctl__history">
        <span className="label">Bid history</span>
        <div className="auction-ctl__history-rows">
          <AnimatePresence initial={false}>
            {[...auction.history].reverse().slice(0, 10).map((bid) => (
              <motion.div
                key={bid.id}
                layout
                className="auction-ctl__history-row"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
              >
                <span className="mono">#{bid.sequenceNumber}</span>
                <span className="mono">{bid.teamId}</span>
                <span className="num">{money(bid.amount, symbol)}</span>
                <span className="dim">
                  {new Date(bid.timestamp).toLocaleTimeString('en-GB', { hour12: false })}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
          {auction.history.length === 0 ? <p className="dim">No bids recorded yet.</p> : null}
        </div>
      </div>

      {game?.phase === 'paused' ? (
        <div className="auction-ctl__paused">Round is paused — resume to accept bids.</div>
      ) : null}
    </section>
  );
}
