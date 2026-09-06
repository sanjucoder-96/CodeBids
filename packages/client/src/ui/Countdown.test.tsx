/**
 * Countdown urgency.
 *
 * The clock drives the loudest visual signal in the hall, so "how much time is
 * left" has to be judged against the timer it belongs to.
 */

import { describe, expect, it } from 'vitest';
import { urgencyFor } from './Countdown.js';

describe('urgency is relative to the clock own length', () => {
  it('keeps a short intro clock calm for most of its life', () => {
    // The 8s GET READY intro used to be red from the moment it appeared.
    expect(urgencyFor(8, 8)).toBe('normal');
    expect(urgencyFor(4, 8)).toBe('warn');
    expect(urgencyFor(2, 8)).toBe('critical');
  });

  it('still turns a long solve clock red in its final ten seconds', () => {
    expect(urgencyFor(120, 150)).toBe('normal');
    expect(urgencyFor(25, 150)).toBe('warn');
    expect(urgencyFor(9, 150)).toBe('critical');
    expect(urgencyFor(10, 150)).toBe('critical');
  });

  it('falls back to absolute thresholds when no duration is known', () => {
    expect(urgencyFor(45, null)).toBe('normal');
    expect(urgencyFor(20, null)).toBe('warn');
    expect(urgencyFor(5, null)).toBe('critical');
  });

  it('treats an expired clock as critical whatever its length', () => {
    expect(urgencyFor(0, 420)).toBe('critical');
    expect(urgencyFor(0, 8)).toBe('critical');
  });
});
