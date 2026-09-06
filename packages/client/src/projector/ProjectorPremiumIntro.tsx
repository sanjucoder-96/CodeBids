/**
 * The premium announcement on the hall display (spec section 5).
 *
 * This is the beat between "a premium is next" and the first paddle. The room
 * learns which premium it is, what it is about, how hard it is, how long the
 * winner gets and where the bidding opens - and nothing else. The question
 * itself stays sealed until a team has paid for it.
 *
 * Without this view the projector went blank here: the auction screen has
 * nothing to draw before an auction exists.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Countdown } from '../ui/Countdown.js';
import { money, domainLabel, difficultyLabel } from '../lib/format.js';
import { DiamondIcon, FlameIcon } from '../ui/Icons.js';

export function ProjectorPremiumIntro() {
  const preview = useStore((s) => s.premiumPreview);
  const game = useStore((s) => s.game);
  const config = useStore((s) => s.config);

  if (!preview) return null;
  const symbol = config.currencySymbol;

  const facts = [
    { key: 'domain', label: 'DOMAIN', value: domainLabel(preview.domain).toUpperCase(), tone: 'none' },
    {
      key: 'difficulty',
      label: 'DIFFICULTY',
      value: difficultyLabel(preview.difficulty),
      tone: preview.difficulty,
    },
    { key: 'time', label: 'SOLVE TIME', value: `${preview.timeLimit} SEC`, tone: 'none' },
  ];

  return (
    <div className="pj-question pj-premium-intro">
      <motion.div
        className="pj-question__eyebrow pj-premium-intro__eyebrow"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span aria-hidden="true">
          {preview.isFinalPremium ? <DiamondIcon size={26} /> : <FlameIcon size={26} />}
        </span>
        {preview.isFinalPremium ? 'FINAL PREMIUM' : `PREMIUM #${preview.premiumNumber}`}
      </motion.div>

      <motion.h1
        className="pj-question__title pj-premium-intro__title"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {preview.isFinalPremium ? 'THE LAST VAULT' : 'PREMIUM UP FOR AUCTION'}
      </motion.h1>

      <div className="pj-question__facts">
        {facts.map((fact, index) => (
          <motion.div
            key={fact.key}
            className="pj-fact"
            data-tone={fact.tone}
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 + index * 0.08 }}
          >
            <span className="pj-fact__label">{fact.label}</span>
            <span className="pj-fact__value">{fact.value}</span>
          </motion.div>
        ))}
      </div>

      <motion.div
        className="pj-premium-intro__bid"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <span className="pj-premium-intro__bid-label">BIDDING OPENS AT</span>
        <span className="pj-premium-intro__bid-value num">
          {money(preview.startingBid, symbol)}
        </span>
        <span className="pj-premium-intro__bid-step">
          raises of {money(preview.increment, symbol)}
        </span>
      </motion.div>

      {game?.timer.endsAt ? (
        <Countdown
          endsAt={game.timer.endsAt}
          duration={game.timer.duration}
          label={game.timer.label}
          size="lg"
        />
      ) : null}
    </div>
  );
}
