/**
 * Shared motion vocabulary (spec sections 22, 26, 43).
 *
 * Everything animated in the app pulls its timing from here so the whole event
 * moves with one rhythm. Durations are tuned for a live audience: fast enough
 * that the operator never waits, slow enough that a row moving up the
 * leaderboard is legible from the back of the hall.
 */

import type { Transition, Variants } from 'motion/react';

export const SPRING_SNAPPY: Transition = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 };
export const SPRING_SOFT: Transition = { type: 'spring', stiffness: 260, damping: 28 };

/**
 * The leaderboard row spring. Deliberately a touch slower and heavier than the
 * UI default: rows should feel like they carry weight when they overtake.
 */
export const SPRING_ROW: Transition = { type: 'spring', stiffness: 420, damping: 38, mass: 1 };

export const EASE_OUT: Transition = { duration: 0.24, ease: [0.22, 1, 0.36, 1] };
export const EASE_SLOW: Transition = { duration: 0.42, ease: [0.22, 1, 0.36, 1] };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: EASE_OUT },
  exit: { opacity: 0, y: -8, transition: { duration: 0.16 } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: EASE_OUT },
  exit: { opacity: 0, transition: { duration: 0.16 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: SPRING_SNAPPY },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.16 } },
};

/** Card unlock: locked plate swings away, content expands (spec section 22). */
export const unlockCard: Variants = {
  locked: { opacity: 1, scale: 1 },
  unlocking: {
    scale: [1, 1.03, 1],
    transition: { duration: 0.55, times: [0, 0.4, 1], ease: [0.22, 1, 0.36, 1] },
  },
};

export const revealContent: Variants = {
  hidden: { opacity: 0, height: 0 },
  show: {
    opacity: 1,
    height: 'auto',
    transition: { height: { duration: 0.34, ease: [0.22, 1, 0.36, 1] }, opacity: { delay: 0.12 } },
  },
};

/** Stagger helper for lists that appear together. */
export function staggerChildren(stagger = 0.045, delayChildren = 0.03): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: stagger, delayChildren } },
  };
}

/** The dramatic full-screen moment used for WON / UNLOCKED / RECLAIM. */
export const dramaticReveal: Variants = {
  hidden: { opacity: 0, scale: 0.86, filter: 'blur(8px)' },
  show: {
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
  exit: { opacity: 0, scale: 1.06, filter: 'blur(6px)', transition: { duration: 0.28 } },
};

/** Reads the OS reduced-motion preference (spec section 46). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Collapse a transition to an instant one when the user asked for reduced
 * motion. Layout animation still runs (rows must not teleport confusingly) but
 * it completes immediately.
 */
export function respectMotion(transition: Transition): Transition {
  return prefersReducedMotion() ? { duration: 0 } : transition;
}
