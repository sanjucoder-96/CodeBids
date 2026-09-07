/**
 * The participant view of a live premium auction (spec sections 2-5).
 *
 * Each team enters its bid AMOUNT on its own laptop and submits it. The server
 * is the authority: it validates the minimum (₹200), the team's purse, and the
 * receipt order that breaks ties (first valid bid at a price wins). Every
 * surface — this screen, the other teams' screens and the projector — updates
 * in real time. The organizer can still record a bid for a team whose laptop
 * has died, so the room is never blocked.
 */

import { useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '../lib/store.js';
import { RollingNumber } from '../ui/AnimatedNumber.js';
import { money, domainLabel, difficultyLabel } from '../lib/format.js';
import { fadeUp, staggerChildren } from '../lib/motion.js';
import { DiamondIcon, FlameIcon, GavelIcon } from '../ui/Icons.js';

export function AuctionScreen() {
  const auction = useStore((s) => s.auction);
  const me = useStore((s) => s.me);
  const teams = useStore((s) => s.teams);
  const call = useStore((s) => s.call);
  const symbol = useStore((s) => s.config.currencySymbol);
  const [bidText, setBidText] = useState('');
  const [bidding, setBidding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!auction || !me) {
    return (
      <div className="screen screen--center">
        <div className="panel panel--pad">
          <div className="eyebrow">Premium</div>
          <h2 className="screen__title">Auction starting shortly</h2>
          <p className="muted">Your bid box appears here the moment it opens.</p>
        </div>
      </div>
    );
  }

  const isFinal = auction.preview.isFinalPremium;
  const leader = auction.auction.currentLeaderTeamId;
  const iAmLeading = leader === me.teamId;
  const myBid = me.myHighestBid;
  const closed = auction.auction.status === 'closed';

  const startingBid = auction.auction.startingBid;
  const currentBid = auction.auction.currentBid;
  const purse = me.capital;
  /** The lowest amount the server will accept right now. */
  const minAcceptable = currentBid === null ? startingBid : currentBid + 1;
  const canReach = purse >= minAcceptable;

  const parsed = /^\d+$/.test(bidText.trim()) ? Number.parseInt(bidText.trim(), 10) : null;
  const localReason =
    parsed === null
      ? null
      : parsed < minAcceptable
        ? `Bid at least ${money(minAcceptable, symbol)}`
        : parsed > purse
          ? `That is more than your purse of ${money(purse, symbol)}`
          : null;
  const canSubmit = !closed && !iAmLeading && parsed !== null && localReason === null && !bidding;

  async function submitBid(event: FormEvent) {
    event.preventDefault();
    if (parsed === null || bidding) return;
    setBidding(true);
    setError(null);
    try {
      const result = (await call('PLACE_BID', { amount: parsed })) as
        | { accepted: boolean; message?: string }
        | undefined;
      if (result && result.accepted === false) {
        setError(result.message ?? 'Bid rejected');
      } else {
        setBidText('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bid rejected');
    } finally {
      setBidding(false);
    }
  }

  const status = closed
    ? iAmLeading
      ? 'YOU WON THIS PREMIUM'
      : 'AUCTION CLOSED'
    : iAmLeading
      ? 'YOU HOLD THE HIGHEST BID'
      : myBid !== null
        ? 'YOU ARE IN THE AUCTION'
        : canReach
          ? 'ENTER YOUR BID'
          : 'YOUR PURSE CANNOT REACH THE NEXT BID';

  const statusKind = closed
    ? iAmLeading
      ? 'gain'
      : 'neutral'
    : iAmLeading
      ? 'gain'
      : canReach
        ? 'accent'
        : 'loss';

  return (
    <div className={`screen auction ${isFinal ? 'auction--final' : ''}`}>
      <motion.div className="auction__hero panel panel--premium" variants={fadeUp} initial="hidden" animate="show">
        <div className="auction__hero-head">
          <span className="eyebrow premium-text">
            <span aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }}>
              {isFinal ? <DiamondIcon size={15} /> : <FlameIcon size={15} />}
            </span>
            {isFinal ? 'FINAL PREMIUM' : `PREMIUM #${auction.preview.premiumNumber}`}
          </span>
          <span className="badge badge--premium">{domainLabel(auction.preview.domain)}</span>
          <span className="badge" data-difficulty={auction.preview.difficulty}>
            {difficultyLabel(auction.preview.difficulty)}
          </span>
        </div>

        <div className="auction__bid">
          <span className="label">Current bid</span>
          <RollingNumber
            className="auction__bid-value num"
            value={auction.auction.currentBid ?? 0}
            format={(n) => (auction.auction.currentBid === null ? '—' : money(n, symbol))}
          />
          {currentBid !== null && auction.auction.currentLeaderTeamId ? (
            <span className="auction__next">
              held by <strong>{auction.auction.currentLeaderTeamId}</strong>
            </span>
          ) : null}
        </div>

        {/* Two numbers a team needs before it bids (spec sections 2, 9). */}
        <div className="auction__facts">
          <div className="auction__fact">
            <span className="auction__fact-label">Minimum bid</span>
            <span className="auction__fact-value num">{money(startingBid, symbol)}</span>
          </div>
          <div className="auction__fact" data-accent="true">
            <span className="auction__fact-label">Your purse</span>
            <span className="auction__fact-value num">{money(purse, symbol)}</span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={status}
            className="auction__status"
            data-kind={statusKind}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {status}
          </motion.div>
        </AnimatePresence>

        {/* --- the bid box: each team enters its own amount (spec 3) -------- */}
        {!closed && !iAmLeading ? (
          <form className="auction__bidform" onSubmit={submitBid}>
            <div className="auction__bidform-row">
              <span className="auction__bidform-prefix">{symbol}</span>
              <input
                className="input auction__bidinput num"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={bidText}
                onChange={(event) => {
                  setBidText(event.target.value.replace(/[^\d]/g, ''));
                  setError(null);
                }}
                placeholder={String(minAcceptable)}
                aria-label="Your bid amount"
                disabled={!canReach}
              />
              <motion.button
                type="submit"
                className="btn btn--premium btn--lg auction__bidsubmit"
                disabled={!canSubmit}
                whileTap={canSubmit ? { scale: 0.97 } : undefined}
              >
                <span aria-hidden="true" style={{ verticalAlign: '-4px', marginRight: 6 }}>
                  <GavelIcon size={18} />
                </span>
                {bidding ? 'BIDDING…' : 'BID'}
              </motion.button>
            </div>
            {error ?? localReason ? (
              <motion.p
                className="auction__bid-error"
                role="alert"
                initial={{ x: 0 }}
                animate={{ x: [0, -6, 6, -3, 0] }}
                transition={{ duration: 0.3 }}
              >
                {error ?? localReason}
              </motion.p>
            ) : (
              <p className="auction__bid-hint dim">
                {canReach
                  ? `Enter at least ${money(minAcceptable, symbol)}. Highest bid wins.`
                  : `Your purse is ${money(purse, symbol)} — below the next bid.`}
              </p>
            )}
          </form>
        ) : null}

        {auction.auction.status === 'going_once' || auction.auction.status === 'going_twice' ? (
          <motion.div
            className="auction__call"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            key={auction.auction.status}
          >
            {auction.auction.status === 'going_once' ? 'GOING ONCE…' : 'GOING TWICE…'}
          </motion.div>
        ) : null}
      </motion.div>

      <div className="auction__grid">
        <motion.div className="panel panel--flush" variants={fadeUp} initial="hidden" animate="show">
          <div className="panel__head">
            <span className="panel__title">Active bidders</span>
            <span className="badge">{auction.bidders.length}</span>
          </div>
          <motion.div className="bidders" variants={staggerChildren()} initial="hidden" animate="show">
            <AnimatePresence initial={false}>
              {auction.bidders.map((bidder, index) => (
                <motion.div
                  key={bidder.teamId}
                  layout
                  className="bidder"
                  data-leader={bidder.isLeader}
                  data-me={bidder.teamId === me.teamId}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                >
                  <span className="bidder__rank num">{index + 1}</span>
                  <span className="bidder__team">
                    <span className="bidder__id mono">{bidder.teamId}</span>
                    <span className="bidder__name">{bidder.teamName}</span>
                  </span>
                  <span className="bidder__amount num">{money(bidder.amount, symbol)}</span>
                  {bidder.isLeader ? <span className="badge badge--premium">LEADING</span> : null}
                  {bidder.teamId === me.teamId ? <span className="badge badge--accent">YOU</span> : null}
                </motion.div>
              ))}
            </AnimatePresence>
            {auction.bidders.length === 0 ? (
              <div className="empty-state">
                <p className="muted">No bids yet.</p>
                <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
                  Be the first to open at {money(startingBid, symbol)}.
                </p>
              </div>
            ) : null}
          </motion.div>
        </motion.div>

        <motion.div className="panel panel--pad auction__you" variants={fadeUp} initial="hidden" animate="show">
          <span className="panel__title">Your position</span>
          <div className="auction__you-grid">
            <Metric label="Your team" value={me.teamId} />
            <Metric label="Your purse" value={money(me.capital, symbol)} accent />
            <Metric label="Minimum bid" value={money(startingBid, symbol)} />
            <Metric label="Your highest bid" value={myBid === null ? '—' : money(myBid, symbol)} />
          </div>

          <div className="auction__strategy">
            <p className="label">Why the ladder matters</p>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              A bid buys two things: the chance to win, and your place in the reclaim order. If the
              winner fails, the next-highest original bidder is offered the same question at their own
              bid — no second auction.
            </p>
          </div>

          {teams.length > 0 ? (
            <p className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              {teams.filter((t) => t.connectionStatus === 'online').length} of {teams.length} teams online.
            </p>
          ) : null}
        </motion.div>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="metric" data-accent={accent}>
      <span className="metric__label">{label}</span>
      <span className="metric__value num">{value}</span>
    </div>
  );
}
