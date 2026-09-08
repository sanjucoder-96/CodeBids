/**
 * The participant view of a live premium auction (spec sections 6, 11, 13).
 *
 * Bidding is run from the physical bid boards: a team raises its board and the
 * organizer records the bid, which climbs in fixed ₹100 steps. This screen is
 * therefore a live SPECTATOR view - it shows the current bid, who leads, this
 * team's own ceiling and every active bidder, all updating in real time. There
 * is no free-form bid box: the server is the sole authority for the bid ladder.
 */

import { motion, AnimatePresence } from 'motion/react';
import { useStore } from '../lib/store.js';
import { RollingNumber } from '../ui/AnimatedNumber.js';
import { money, domainLabel, difficultyLabel } from '../lib/format.js';
import { fadeUp, staggerChildren } from '../lib/motion.js';
import { DiamondIcon, FlameIcon } from '../ui/Icons.js';

export function AuctionScreen() {
  const auction = useStore((s) => s.auction);
  const me = useStore((s) => s.me);
  const teams = useStore((s) => s.teams);
  const symbol = useStore((s) => s.config.currencySymbol);

  if (!auction || !me) {
    return (
      <div className="screen screen--center">
        <div className="panel panel--pad">
          <div className="eyebrow">Premium</div>
          <h2 className="screen__title">Auction starting shortly</h2>
          <p className="muted">The live bid appears here the moment it opens.</p>
        </div>
      </div>
    );
  }

  const isFinal = auction.preview.isFinalPremium;
  const leader = auction.auction.currentLeaderTeamId;
  const leaderName = leader
    ? (auction.bidders.find((b) => b.teamId === leader)?.teamName ?? leader)
    : null;
  const iAmLeading = leader === me.teamId;
  const myBid = me.myHighestBid;
  const closed = auction.auction.status === 'closed';

  const startingBid = auction.auction.startingBid;
  const currentBid = auction.auction.currentBid;
  const nextBid = auction.nextBid;
  const purse = me.capital;
  /** This team's own ceiling: capital minus the protected reserve. */
  const ceiling = me.maxBid;
  const canReachNext = ceiling >= nextBid;

  const status = closed
    ? iAmLeading
      ? 'YOU WON THIS PREMIUM'
      : 'AUCTION CLOSED'
    : iAmLeading
      ? 'YOU HOLD THE HIGHEST BID'
      : myBid !== null
        ? 'YOU ARE IN THE AUCTION'
        : canReachNext
          ? 'RAISE YOUR BOARD TO BID'
          : 'YOUR PURSE CANNOT REACH THE NEXT BID';

  const statusKind = closed
    ? iAmLeading
      ? 'gain'
      : 'neutral'
    : iAmLeading
      ? 'gain'
      : canReachNext
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
          {currentBid !== null && leader ? (
            <span className="auction__next">
              held by <strong>{leader === me.teamId ? 'YOUR TEAM' : leaderName}</strong>
            </span>
          ) : (
            <span className="auction__next">opens at {money(startingBid, symbol)}</span>
          )}
        </div>

        {/* The three numbers a team needs to read the room (spec sections 3, 4). */}
        <div className="auction__facts">
          <div className="auction__fact">
            <span className="auction__fact-label">Next bid</span>
            <span className="auction__fact-value num">{money(nextBid, symbol)}</span>
          </div>
          <div className="auction__fact" data-accent="true">
            <span className="auction__fact-label">Your purse</span>
            <span className="auction__fact-value num">{money(purse, symbol)}</span>
          </div>
          <div className="auction__fact">
            <span className="auction__fact-label">Your max bid</span>
            <span className="auction__fact-value num">{money(ceiling, symbol)}</span>
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

        {!closed ? (
          <p className="auction__bid-hint dim">
            {canReachNext
              ? 'Raise your physical bid board — the organizer records your bid. Each bid climbs by ₹100.'
              : `Your ceiling is ${money(ceiling, symbol)} (purse minus the reserve), below the next bid.`}
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
                  Raise your board to open at {money(startingBid, symbol)}.
                </p>
              </div>
            ) : null}
          </motion.div>
        </motion.div>

        <motion.div className="panel panel--pad auction__you" variants={fadeUp} initial="hidden" animate="show">
          <span className="panel__title">Your position</span>
          <div className="auction__you-grid">
            <Metric label="Your team" value={teams.find((t) => t.id === me.teamId)?.name ?? me.teamId} />
            <Metric label="Your purse" value={money(me.capital, symbol)} accent />
            <Metric label="Your max bid" value={money(ceiling, symbol)} />
            <Metric label="Your highest bid" value={myBid === null ? '—' : money(myBid, symbol)} />
          </div>

          <div className="auction__strategy">
            <p className="label">Why the ladder matters</p>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              A bid buys two things: the chance to win, and your place as the reclaim bidder. If the
              winner fails, the second-highest bidder alone is offered the same question at their own
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
