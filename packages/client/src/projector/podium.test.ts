/**
 * Podium plinth sizing.
 *
 * The ceremony reads at a glance only if the winner's plinth is visibly the
 * tallest. This is easy to break silently in a template string, so the sizes
 * are asserted directly.
 */

import { describe, expect, it } from 'vitest';
import { plinthHeight } from './ProjectorPodium.js';

function vh(value: string): number {
  expect(value).toMatch(/^[\d.]+vh$/);
  return Number.parseFloat(value);
}

describe('plinthHeight', () => {
  it('makes first place the tallest and third the shortest', () => {
    const first = vh(plinthHeight(1));
    const second = vh(plinthHeight(2));
    const third = vh(plinthHeight(3));
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(third);
  });

  it('separates the places by enough to read from the back of a hall', () => {
    // At least a fifth of the winner's height between neighbouring places.
    const first = vh(plinthHeight(1));
    const second = vh(plinthHeight(2));
    const third = vh(plinthHeight(3));
    expect(first - second).toBeGreaterThan(first * 0.2);
    expect(second - third).toBeGreaterThan(first * 0.1);
  });

  it('keeps every plinth on screen', () => {
    for (const place of [1, 2, 3]) {
      expect(vh(plinthHeight(place))).toBeLessThanOrEqual(40);
      expect(vh(plinthHeight(place))).toBeGreaterThan(0);
    }
  });

  it('gives an unexpected place a real height rather than none', () => {
    // A shared place can push a team to 4th on the stage.
    expect(vh(plinthHeight(4))).toBeGreaterThan(0);
    expect(vh(plinthHeight(4))).toBeLessThan(vh(plinthHeight(1)));
  });
});
