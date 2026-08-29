/**
 * Server-synchronised countdown.
 *
 * The deadline is a server wall-clock timestamp; the client corrects for clock
 * skew with the offset measured by the socket, so twenty laptops with twenty
 * slightly wrong clocks all show the same number.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { clock } from '../lib/format.js';
import { sound } from '../lib/sound.js';
import { useStore } from '../lib/store.js';

interface Props {
  /** Server timestamp (ms) at which the clock hits zero. */
  endsAt: number | null;
  /** Total duration in seconds, for the progress ring. */
  duration?: number | null;
  label?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  onExpire?: () => void;
  /** Audible ticks over the last 5 seconds. */
  tick?: boolean;
}

export function Countdown({ endsAt, duration, label, size = 'md', onExpire, tick = false }: Props) {
  const serverNow = useStore((s) => s.serverNow);
  const [remaining, setRemaining] = useState(() => (endsAt ? Math.max(0, endsAt - serverNow()) : 0));
  const firedRef = useRef(false);
  const lastTickRef = useRef(-1);

  useEffect(() => {
    firedRef.current = false;
    if (!endsAt) {
      setRemaining(0);
      return;
    }
    const update = () => {
      const left = Math.max(0, endsAt - serverNow());
      setRemaining(left);
      if (tick) {
        const seconds = Math.ceil(left / 1000);
        if (seconds <= 5 && seconds > 0 && seconds !== lastTickRef.current) {
          lastTickRef.current = seconds;
          sound.play('tick');
        }
      }
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
    };
    update();
    const handle = setInterval(update, 100);
    return () => clearInterval(handle);
  }, [endsAt, serverNow, onExpire, tick]);

  const total = (duration ?? 0) * 1000;
  const progress = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const seconds = remaining / 1000;
  const urgency = seconds <= 10 ? 'critical' : seconds <= 30 ? 'warn' : 'normal';

  const text = useMemo(() => clock(remaining), [remaining]);

  if (!endsAt) return null;

  return (
    <div className={`countdown countdown--${size}`} data-urgency={urgency} role="timer" aria-live="off">
      {label ? <div className="countdown__label">{label}</div> : null}
      <div className="countdown__value num" aria-label={`${Math.ceil(seconds)} seconds remaining`}>
        {text}
      </div>
      <div className="countdown__track">
        <div className="countdown__bar" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </div>
  );
}
