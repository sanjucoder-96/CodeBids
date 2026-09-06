/**
 * "YOU WON" - the moment between winning the auction and the question opening
 * (spec section 22). Also covers waiting while the operator starts the attempt.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { money, blockLabel } from '../lib/format.js';
import { CheckIcon } from '../ui/Icons.js';
import { dramaticReveal } from '../lib/motion.js';

export function PremiumScreen() {
  const premium = useStore((s) => s.premium);
  const question = useStore((s) => s.question);
  const me = useStore((s) => s.me);
  const config = useStore((s) => s.config);
  const symbol = config.currencySymbol;

  if (!premium || !me) return null;

  const risk = me.premiumRisk ?? premium.activeRisk ?? 0;
  const isReclaim = premium.attemptNumber >= 1 && premium.stage === 'sold';
  const potential = me.capital + risk;
  const downside = Math.max(0, me.capital - risk);

  return (
    <div className="screen screen--center">
      <motion.div
        className="panel panel--premium premium-hero"
        variants={dramaticReveal}
        initial="hidden"
        animate="show"
      >
        <motion.div
          className="premium-hero__badge"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 20 }}
        >
          {isReclaim ? 'RECLAIM ACCEPTED' : 'YOU WON'}
        </motion.div>

        <h2 className="premium-hero__title">
          {question
            ? blockLabel(question.blockNumber, question.positionInBlock, config.questionsPerBlock)
            : 'PREMIUM CHALLENGE'}
        </h2>
        <p className="premium-hero__subtitle">
          <span aria-hidden="true">
            <CheckIcon size={14} />
          </span>
          UNLOCKED FOR YOUR TEAM
        </p>

        <motion.div
          className="premium-hero__risk"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, type: 'spring', stiffness: 300, damping: 24 }}
        >
          <span className="label">Your risk</span>
          <span className="premium-hero__amount num">{money(risk, symbol)}</span>
        </motion.div>

        <div className="premium-hero__outcomes">
          <div className="outcome outcome--gain">
            <span className="outcome__label">If correct</span>
            <span className="outcome__value num">{money(potential, symbol)}</span>
            <span className="outcome__delta">+{money(risk, symbol)}</span>
          </div>
          <div className="outcome outcome--loss">
            <span className="outcome__label">If wrong</span>
            <span className="outcome__value num">{money(downside, symbol)}</span>
            <span className="outcome__delta">-{money(risk, symbol)}</span>
          </div>
        </div>

        <div className="premium-hero__wait">
          <span className="spinner" />
          <span className="muted">
            Waiting for the organizer to open the question. Stay at your machine.
          </span>
        </div>
      </motion.div>
    </div>
  );
}
