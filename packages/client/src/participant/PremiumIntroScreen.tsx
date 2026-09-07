/**
 * The premium preview (spec section 5).
 *
 * Everything the room may know before the bidding opens: which premium, its
 * domain, its difficulty, the clock and the opening bid. The question itself
 * stays sealed until a team wins it.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Countdown } from '../ui/Countdown.js';
import { money, domainLabel, difficultyLabel } from '../lib/format.js';
import { FlameIcon, DiamondIcon, DomainIcon, TargetIcon, ClockIcon } from '../ui/Icons.js';

export function PremiumIntroScreen() {
  const preview = useStore((s) => s.premiumPreview);
  const game = useStore((s) => s.game);
  const config = useStore((s) => s.config);
  const me = useStore((s) => s.me);

  if (!preview) return null;
  const symbol = config.currencySymbol;
  const affordable = (me?.maxBid ?? 0) >= preview.startingBid;

  return (
    <div className="screen screen--center">
      <motion.div
        className="premium-intro panel panel--premium"
        initial={{ opacity: 0, scale: 0.95, y: 18 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 24 }}
      >
        <motion.div
          className="premium-intro__badge"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
        >
          <span aria-hidden="true">
            {preview.isFinalPremium ? <DiamondIcon size={18} /> : <FlameIcon size={18} />}
          </span>
          {preview.isFinalPremium ? 'FINAL PREMIUM' : `PREMIUM #${preview.premiumNumber}`}
        </motion.div>

        <h2 className="premium-intro__title">
          {preview.isFinalPremium ? 'THE LAST VAULT' : 'PREMIUM CHALLENGE'}
        </h2>

        <div className="intro-card__facts">
          {[
            {
              key: 'domain',
              label: 'Domain',
              value: domainLabel(preview.domain),
              icon: <DomainIcon size={20} />,
            },
            {
              key: 'difficulty',
              label: 'Difficulty',
              value: difficultyLabel(preview.difficulty),
              icon: <TargetIcon size={20} />,
              tone: preview.difficulty,
            },
            {
              key: 'time',
              label: 'Time',
              value: `${preview.timeLimit} SEC`,
              icon: <ClockIcon size={20} />,
            },
          ].map((fact, index) => (
            <motion.div
              key={fact.key}
              className="fact"
              data-tone={fact.tone}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 + index * 0.07, type: 'spring', stiffness: 340, damping: 28 }}
            >
              <span className="fact__icon" aria-hidden="true">
                {fact.icon}
              </span>
              <span className="fact__label">{fact.label}</span>
              <span className="fact__value">{fact.value}</span>
            </motion.div>
          ))}
        </div>

        <motion.div
          className="premium-intro__bid"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.36, type: 'spring', stiffness: 300, damping: 22 }}
        >
          <span className="label">Starting bid</span>
          <span className="premium-intro__bid-value num">{money(preview.startingBid, symbol)}</span>
          <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
            increments of {money(preview.increment, symbol)}
          </span>
        </motion.div>

        <div className="premium-intro__you">
          <div className="metric">
            <span className="metric__label">Your capital</span>
            <span className="metric__value num">{money(me?.capital ?? 0, symbol)}</span>
          </div>
          <div className="metric" data-accent>
            <span className="metric__label">Your max bid</span>
            <span className="metric__value num">{money(me?.maxBid ?? 0, symbol)}</span>
          </div>
        </div>

        <div className="premium-intro__status" data-ok={affordable}>
          {affordable
            ? 'RAISE YOUR PADDLE WHEN THE AUCTIONEER CALLS YOUR PRICE'
            : 'YOU CANNOT REACH THE OPENING BID THIS ROUND'}
        </div>

        {game?.timer.endsAt ? (
          <Countdown
            endsAt={game.timer.endsAt}
            duration={game.timer.duration}
            label="Premium window"
            size="sm"
          />
        ) : null}
      </motion.div>
    </div>
  );
}
