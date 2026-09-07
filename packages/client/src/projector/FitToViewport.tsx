/**
 * Scales its content down to fit the available box, never up past 1:1.
 *
 * The projector is designed for a 1080p hall display with deliberately large
 * type. On a smaller screen — or a laptop previewing the projector at 100%
 * zoom — that content overflows and rows fall off the bottom. Rather than
 * fight the type size row by row, the whole board is laid out at its natural
 * size and then scaled as one piece to fit whatever screen it is on: full size
 * on the projector, proportionally smaller on a laptop, always complete.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function FitToViewport({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const outer = box.current;
    const inner = content.current;
    if (!outer || !inner) return;

    const fit = () => {
      // Measure at natural size: undo the scale, read, restore.
      const previous = inner.style.transform;
      inner.style.transform = 'none';
      const naturalH = inner.offsetHeight;
      const naturalW = inner.offsetWidth;
      inner.style.transform = previous;

      const availH = outer.clientHeight;
      const availW = outer.clientWidth;
      if (naturalH === 0 || naturalW === 0) return;

      const next = Math.min(1, availH / naturalH, availW / naturalW);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };

    fit();

    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  });

  return (
    <div ref={box} className="pj-fit">
      <div ref={content} className="pj-fit__inner" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
