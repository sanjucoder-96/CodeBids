import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  challengeLabel,
  clock,
  delta,
  medal,
  money,
  relativeTime,
  timeOfDay,
  typeLabel,
} from './format.js';

describe('money formatting', () => {
  it('uses the Indian grouping', () => {
    expect(money(1000)).toBe('₹1,000');
    expect(money(250000)).toBe('₹2,50,000');
    expect(money(0)).toBe('₹0');
  });

  it('renders negatives with the sign before the symbol', () => {
    expect(money(-700)).toBe('-₹700');
  });

  it('respects a configured symbol', () => {
    expect(money(500, '$')).toBe('$500');
  });

  it('rounds rather than showing fractions of a rupee', () => {
    expect(money(1000.6)).toBe('₹1,001');
  });
});

describe('delta formatting', () => {
  it('always shows an explicit sign for a change', () => {
    expect(delta(200)).toBe('+₹200');
    expect(delta(-200)).toBe('-₹200');
  });

  it('shows a bare zero rather than +₹0', () => {
    expect(delta(0)).toBe('₹0');
  });
});

describe('clock', () => {
  it('formats mm:ss and never goes negative', () => {
    expect(clock(90_000)).toBe('01:30');
    expect(clock(5_400)).toBe('00:06');
    expect(clock(0)).toBe('00:00');
    expect(clock(-9_000)).toBe('00:00');
  });

  it('handles a long premium clock', () => {
    expect(clock(240_000)).toBe('04:00');
  });
});

describe('labels', () => {
  it('labels each challenge by its market type', () => {
    expect(challengeLabel(1, 'market')).toBe('MARKET #01');
    expect(challengeLabel(4, 'premium')).toBe('PREMIUM #04');
    expect(challengeLabel(12, 'final_premium')).toBe('FINAL PREMIUM #12');
  });

  it('humanises categories and question types', () => {
    expect(categoryLabel('dbms')).toBe('DBMS');
    expect(categoryLabel('output_prediction')).toBe('Output Prediction');
    expect(categoryLabel('unknown_thing')).toBe('unknown thing');
    expect(typeLabel('mcq')).toBe('Single choice');
    expect(typeLabel('true_false')).toBe('True / False');
  });

  it('renders placings', () => {
    expect(medal(1)).toBe('1st');
    expect(medal(2)).toBe('2nd');
    expect(medal(3)).toBe('3rd');
    expect(medal(11)).toBe('11th');
  });
});

describe('time helpers', () => {
  it('formats a wall clock time with padding', () => {
    const ts = new Date(2026, 7, 28, 9, 5, 3).getTime();
    expect(timeOfDay(ts)).toBe('09:05:03');
  });

  it('describes recency in human terms', () => {
    const now = 1_000_000_000;
    expect(relativeTime(now - 1_000, now)).toBe('just now');
    expect(relativeTime(now - 20_000, now)).toBe('20s ago');
    expect(relativeTime(now - 300_000, now)).toBe('5m ago');
    expect(relativeTime(now - 7_200_000, now)).toBe('2h ago');
  });
});
