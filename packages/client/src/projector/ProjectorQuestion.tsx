/**
 * The NEXT QUESTION card on the hall display (spec section 4).
 * Domain, difficulty, time. Never the question itself.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Countdown } from '../ui/Countdown.js';
import { blockLabel, difficultyLabel, domainLabel, money } from '../lib/format.js';

export function ProjectorQuestion() {
  const question = useStore((s) => s.question);
  const game = useStore((s) => s.game);
  const config = useStore((s) => s.config);

  if (!question) return null;
  const symbol = config.currencySymbol;

  return (
    <div className="pj-question">
      <motion.div
        className="pj-question__eyebrow"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {blockLabel(question.blockNumber, question.positionInBlock, config.questionsPerBlock)}
      </motion.div>

      <motion.h1
        className="pj-question__title"
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 240, damping: 22 }}
      >
        NEXT QUESTION
      </motion.h1>

      <div className="pj-question__facts">
        {[
          { key: 'domain', label: 'DOMAIN', value: domainLabel(question.domain).toUpperCase() },
          {
            key: 'difficulty',
            label: 'DIFFICULTY',
            value: difficultyLabel(question.difficulty),
            tone: question.difficulty,
          },
          { key: 'time', label: 'TIME', value: `${question.timeLimit} SEC` },
        ].map((fact, index) => (
          <motion.div
            key={fact.key}
            className="pj-fact"
            data-tone={fact.tone}
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14 + index * 0.1, type: 'spring', stiffness: 300, damping: 26 }}
          >
            <span className="pj-fact__label">{fact.label}</span>
            <span className="pj-fact__value">{fact.value}</span>
          </motion.div>
        ))}
      </div>

      <motion.div
        className="pj-question__stakes"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        <span className="gain">+{money(question.reward ?? 0, symbol)}</span>
        <span className="dim">CORRECT</span>
        <span className="pj-question__divider" aria-hidden="true" />
        <span className="loss">-{money(question.penalty ?? 0, symbol)}</span>
        <span className="dim">WRONG</span>
      </motion.div>

      {game?.timer.endsAt ? (
        <Countdown
          endsAt={game.timer.endsAt}
          duration={game.timer.duration}
          label={game.timer.label}
          size="xl"
        />
      ) : null}
    </div>
  );
}
