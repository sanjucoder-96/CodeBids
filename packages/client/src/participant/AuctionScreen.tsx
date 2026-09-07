/**
 * The participant view of a live auction.
 *
 * Teams bid from their own laptop: one tap raises to the next call, the server
 * validates it against the team's ceiling (capital - reserve), and every
 * surface — this screen, the other teams' screens and the projector — updates
 * in real time. The organizer can still record a bid on a team's behalf if a
 * laptop has died, so the room is never blocked.
 */

import { useState } from 'react';
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
  const [bidding, setBidding] = useState(false);

  if (!auction || !me) {
    return (
      <div className="screen screen--center">
        <div className="panel panel--pad">
          <div className="eyebrow">Premium</div>
          <h2 className="screen__title">Auction starting shortly</h2>
          <p className="muted">The bidding button appears here the moment it opens.</p>
        </div>
      </div>
    );
  }

  const isFinal = auction.preview.isFinalPremium;
  const leader = auction.auction.currentLeaderTeamId;
  const iAmLeading = leader === me.teamId;
  const myBid = me.myHighestBid;
  const nextBid = auction.nextBid;
  const canAfford = me.maxBid >= nextBid;
  const closed = auction.auction.status === 'closed';
  const canBid = !closed && !iAmLeading && canAfford;

  async function placeBid() {
    if (!canBid || bidding) return;
    setBidding(true);
    try {
      // No amount: the server bids exactly the next call for this team.
      await call('PLACE_BID', {});
    } catch {
      /* a rejection arrives as its own toast from the server */
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
        : canAfford
          ? 'TAP TO ENTER THE BIDDING'
          : 'YOU CANNOT REACH THE NEXT BID';

  const statusKind = closed
    ? iAmLeading
      ? 'gain'
      : 'neutral'
    : iAmLeading
      ? 'gain'
      : canAfford
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
          {!closed ? (
            <span className="auction__next">
              Next call <strong className="num">{money(nextBid, symbol)}</strong>
            </span>
          ) : null}
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

        {/* --- the bid button: the whole point of the screen --------------- */}
        {!closed ? (
          <motion.button
            type="button"
            className="auction__bid-btn"
            data-state={iAmLeading ? 'leading' : canAfford ? 'ready' : 'blocked'}
            onClick={placeBid}
            disabled={!canBid || bidding}
            whileTap={canBid ? { scale: 0.97 } : undefined}
          >
            <span aria-hidden="true" className="auction__bid-btn-icon">
              <GavelIcon size={22} />
            </span>
            {iAmLeading
              ? 'YOU ARE WINNING'
              : !canAfford
                ? `MAX BID ${money(me.maxBid, symbol)}`
                : bidding
                  ? 'BIDDING…'
                  : `BID ${money(nextBid, symbol)}`}
          </motion.button>
        ) : null}

        {!closed && canBid ? (
          <p className="auction__bid-hint dim">
            One tap raises to {money(nextBid, symbol)}. You can bid again if you are outbid.
          </p>
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
                  Be the first to open at {money(auction.auction.startingBid, symbol)}.
                </p>
              </div>
            ) : null}
          </motion.div>
        </motion.div>

        <motion.div className="panel panel--pad auction__you" variants={fadeUp} initial="hidden" animate="show">
          <span className="panel__title">Your position</span>
          <div className="auction__you-grid">
            <Metric label="Your team" value={me.teamId} />
            <Metric label="Your capital" value={money(me.capital, symbol)} />
            <Metric label="Your max bid" value={money(me.maxBid, symbol)} accent />
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
