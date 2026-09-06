/**
 * The NEXT QUESTION card (spec section 4).
 *
 * Before a question opens, the room is told exactly three things: the domain,
 * the difficulty and the time limit. The body stays sealed - what the team is
 * being asked to price is the RISK, not the question.
 */

import { motion } from 'motion/react';
import { useStore } from '../lib/store.js';
import { Countdown } from '../ui/Countdown.js';
import { money, domainLabel, difficultyLabel, blockLabel } from '../lib/format.js';
import { DomainIcon, TargetIcon, ClockIcon } from '../ui/Icons.js';

export function QuestionIntroScreen() {
  const question = useStore((s) => s.question);
  const game = useStore((s) => s.game);
  const config = useStore((s) => s.config);
  const me = useStore((s) => s.me);

  if (!question) return null;
  const symbol = config.currencySymbol;

  return (
    <div className="screen screen--center">
      <motion.div
        className="intro-card panel"
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      >
        <div className="intro-card__eyebrow">
          {blockLabel(question.blockNumber, question.positionInBlock, config.questionsPerBlock)}
        </div>

        <motion.h2
          className="intro-card__title"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
        >
          NEXT QUESTION
        </motion.h2>

        <div className="intro-card__facts">
          {[
            {
              key: 'domain',
              label: 'Domain',
              value: domainLabel(question.domain),
              icon: <DomainIcon size={20} />,
            },
            {
              key: 'difficulty',
              label: 'Difficulty',
              value: difficultyLabel(question.difficulty),
              icon: <TargetIcon size={20} />,
              tone: question.difficulty,
            },
            {
              key: 'time',
              label: 'Time',
              value: `${question.timeLimit} SEC`,
              icon: <ClockIcon size={20} />,
            },
          ].map((fact, index) => (
            <motion.div
              key={fact.key}
              className="fact"
              data-tone={fact.tone}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 + index * 0.07, type: 'spring', stiffness: 340, damping: 28 }}
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
          className="intro-card__stakes"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <span className="gain">
            Correct <strong className="num">+{money(question.reward ?? 0, symbol)}</strong>
          </span>
          <span className="dim">·</span>
          <span className="loss">
            Wrong{' '}
            <strong className="num">
              {(question.penalty ?? 0) > 0 ? `-${money(question.penalty ?? 0, symbol)}` : 'free'}
            </strong>
          </span>
          {me ? (
            <>
              <span className="dim">·</span>
              <span className="muted">
                You hold <strong className="num">{money(me.capital, symbol)}</strong>
              </span>
            </>
          ) : null}
        </motion.div>

        {game?.timer.endsAt ? (
          <div className="intro-card__timer">
            <Countdown
              endsAt={game.timer.endsAt}
              duration={game.timer.duration}
              label="Opens in"
              size="md"
            />
          </div>
        ) : (
          <p className="muted">The organizer will open this question shortly.</p>
        )}
      </motion.div>
    </div>
  );
}
