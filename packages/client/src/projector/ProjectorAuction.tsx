/**
 * The auction on the big screen (spec sections 12, 27).
 *
 * Shows exactly what the room needs: which premium, the current bid, and who is
 * still in. The bid uses a strong roll transition so a raise is unmistakable
 * from the back of the hall.
 */

import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { RollingNumber } from '../ui/AnimatedNumber.js';
import { money, categoryLabel } from '../lib/format.js';

export function ProjectorAuction() {
  const auction = useStore((s) => s.auction);
  const config = useStore((s) => s.config);
  const symbol = config.currencySymbol;

  if (!auction) return null;

  const isFinal = auction.challenge.marketType === 'final_premium';
  const status = auction.auction.status;
  const closed = status === 'closed';
  const number = String(auction.challenge.index).padStart(2, '0');

  if (closed && auction.auction.winnerTeamId) {
    return <SoldCard
      teamId={auction.auction.winnerTeamId}
      teamName={
        auction.bidders.find((b) => b.teamId === auction.auction.winnerTeamId)?.teamName ?? ''
      }
      amount={auction.auction.winningAmount ?? 0}
      symbol={symbol}
    />;
  }

  return (
    <div className={`pj-auction ${isFinal ? 'pj-auction--final' : ''}`}>
      <header className="pj-auction__head">
        <motion.div
          className="pj-auction__label"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {isFinal ? '💎 FINAL PREMIUM' : '🔥 PREMIUM'} #{number}
        </motion.div>
        <div className="pj-auction__category">{categoryLabel(auction.challenge.category)}</div>
      </header>

      <div className="pj-auction__bid">
        <div className="pj-auction__bid-label">CURRENT BID</div>
        <RollingNumber
          className="pj-auction__bid-value num"
          value={auction.auction.currentBid ?? auction.auction.startingBid}
          format={(n) =>
            auction.auction.currentBid === null
              ? `${money(auction.auction.startingBid, symbol)}`
              : money(n, symbol)
          }
        />
        <div className="pj-auction__next">
          {auction.auction.currentBid === null ? 'OPENING BID' : `NEXT ${money(auction.nextBid, symbol)}`}
        </div>
      </div>

      <AnimatePresence>
        {status === 'going_once' || status === 'going_twice' ? (
          <motion.div
            key={status}
            className="pj-auction__call"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            {status === 'going_once' ? 'GOING ONCE…' : 'GOING TWICE…'}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <section className="pj-auction__bidders">
        <div className="pj-auction__bidders-label">ACTIVE BIDDERS</div>
        <div className="pj-bidder-grid">
          <AnimatePresence initial={false}>
            {auction.bidders.map((bidder) => (
              <motion.div
                key={bidder.teamId}
                layout
                className="pj-bidder"
                data-leader={bidder.isLeader}
                initial={{ opacity: 0, scale: 0.8, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.75, transition: { duration: 0.22 } }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              >
                <span className="pj-bidder__id">{bidder.teamId}</span>
                <span className="pj-bidder__amount num">{money(bidder.amount, symbol)}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {auction.bidders.length === 0 ? (
          <div className="pj-auction__empty">AWAITING THE FIRST PADDLE</div>
        ) : null}
      </section>
    </div>
  );
}

function SoldCard({
  teamId,
  teamName,
  amount,
  symbol,
}: {
  teamId: string;
  teamName: string;
  amount: number;
  symbol: string;
}) {
  return (
    <motion.div
      className="pj-sold"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
    >
      <motion.div
        className="pj-sold__hammer"
        initial={{ rotate: -28, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 14 }}
      >
        🔨
      </motion.div>
      <div className="pj-sold__word">SOLD</div>
      <motion.div
        className="pj-sold__team"
        initial={{ opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, type: 'spring', stiffness: 280, damping: 24 }}
      >
        {teamName || teamId}
      </motion.div>
      <div className="pj-sold__id">{teamId}</div>
      <motion.div
        className="pj-sold__amount num"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.34, type: 'spring', stiffness: 300, damping: 20 }}
      >
        {money(amount, symbol)}
      </motion.div>
    </motion.div>
  );
}
