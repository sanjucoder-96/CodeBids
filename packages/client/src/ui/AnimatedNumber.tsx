/**
 * Animated number transitions (spec section 22).
 *
 * A capital change never snaps: it counts. Rapid consecutive updates are
 * handled by retargeting the SAME spring rather than restarting it, so three
 * quick payouts read as one continuous climb instead of a stutter
 * (spec section 43: "queue or merge number transitions sensibly").
 */

import { useEffect, useRef, useState } from 'react';
import { animate, useMotionValue } from 'motion/react';
import { prefersReducedMotion } from '../lib/motion.js';

interface Props {
  value: number;
  /** Wraps the number, e.g. (n) => `₹${n.toLocaleString('en-IN')}` */
  format?: (value: number) => string;
  className?: string;
  duration?: number;
  /** Below this delta, skip the animation entirely (avoids jitter). */
  threshold?: number;
  'aria-label'?: string;
}

export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  className,
  duration = 0.85,
  threshold = 0,
  ...rest
}: Props) {
  const motionValue = useMotionValue(value);
  const [display, setDisplay] = useState(() => format(value));
  const previous = useRef(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;

    if (Math.abs(value - from) <= threshold || prefersReducedMotion()) {
      motionValue.set(value);
      setDisplay(format(value));
      return;
    }

    // Retarget the running animation instead of starting a competing one.
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setDisplay(format(latest)),
    });
    return () => controls.stop();
    // `format` is intentionally excluded: callers usually pass an inline arrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, threshold, motionValue]);

  return (
    <span className={className} {...rest}>
      {display}
    </span>
  );
}

/**
 * A number that flips with a vertical roll - used for the auction's CURRENT BID
 * where the spec asks for "a strong number transition" (spec section 27).
 */
export function RollingNumber({
  value,
  format = (n) => String(n),
  className,
}: {
  value: number;
  format?: (value: number) => string;
  className?: string;
}) {
  const [state, setState] = useState({ current: value, previous: value, key: 0 });

  useEffect(() => {
    setState((s) => (s.current === value ? s : { current: value, previous: s.current, key: s.key + 1 }));
  }, [value]);

  const rising = state.current >= state.previous;

  return (
    <span className={`rolling-number ${className ?? ''}`} data-rising={rising}>
      <span key={state.key} className="rolling-number__value">
        {format(state.current)}
      </span>
    </span>
  );
}
