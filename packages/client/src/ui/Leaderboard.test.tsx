/**
 * Leaderboard rendering and the animation-engineering rules from spec 43:
 *  - stable keys (team id, never array index),
 *  - no duplicated rows under rapid consecutive updates,
 *  - a qualification divider that sits between the right two rows,
 *  - rank movement indicators.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { LeaderboardRow } from '@code-market/shared';
import { Leaderboard } from './Leaderboard.js';

afterEach(cleanup);

function rows(spec: [string, number][]): LeaderboardRow[] {
  const sorted = [...spec].sort((a, b) => b[1] - a[1]);
  return sorted.map(([teamId, capital], index) => ({
    rank: index + 1,
    teamId,
    name: `TEAM ${teamId}`,
    capital,
    startingCapital: 1000,
    delta: capital - 1000,
    qualified: index < 3,
    previousRank: null,
    connectionStatus: 'online' as const,
    status: 'active' as const,
  }));
}

const base = {
  qualifiers: 3,
  currencySymbol: '₹',
};

describe('Leaderboard', () => {
  it('renders one row per team with capital and delta', () => {
    render(<Leaderboard rows={rows([['T01', 2500], ['T02', 1000], ['T03', 800]])} {...base} />);
    expect(screen.getByText('TEAM T01')).toBeInTheDocument();
    expect(screen.getByText('TEAM T03')).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(3);
  });

  it('renders rows in rank order', () => {
    const { container } = render(
      <Leaderboard rows={rows([['T01', 900], ['T02', 2500], ['T03', 1500]])} {...base} />,
    );
    const names = [...container.querySelectorAll('.lb__team-name')].map((n) => n.textContent);
    expect(names).toEqual(['TEAM T02', 'TEAM T03', 'TEAM T01']);
  });

  it('never duplicates a row across rapid consecutive updates (spec 43)', () => {
    const { rerender, container } = render(
      <Leaderboard rows={rows([['T01', 1000], ['T02', 1100], ['T03', 1200]])} {...base} />,
    );

    for (let i = 0; i < 20; i++) {
      rerender(
        <Leaderboard
          rows={rows([['T01', 1000 + i * 90], ['T02', 1100], ['T03', 1200]])}
          {...base}
          changed={['T01']}
        />,
      );
    }

    const ids = [...container.querySelectorAll('.lb__team-id')].map((n) => n.textContent);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('keeps the same DOM node for a team across a reorder (stable keys)', () => {
    const { rerender, container } = render(
      <Leaderboard rows={rows([['T07', 2000], ['T12', 1800]])} {...base} />,
    );

    const findRow = (id: string) =>
      [...container.querySelectorAll('.lb__row')].find((el) =>
        el.querySelector('.lb__team-id')?.textContent === id,
      );

    const before = findRow('T12');
    rerender(<Leaderboard rows={rows([['T07', 2000], ['T12', 2500]])} {...base} />);
    const after = findRow('T12');

    // Same element instance => React reconciled by team id, so Motion can
    // animate the row to its new position instead of remounting it.
    expect(before).toBe(after);
  });

  it('shows an upward movement indicator when a team overtakes', () => {
    const { rerender, container } = render(
      <Leaderboard rows={rows([['T07', 2000], ['T12', 1800]])} {...base} />,
    );
    rerender(<Leaderboard rows={rows([['T07', 2000], ['T12', 2500]])} {...base} />);
    const moves = [...container.querySelectorAll('.lb__move')].map((n) => n.getAttribute('data-dir'));
    expect(moves).toContain('up');
    expect(moves).toContain('down');
  });

  it('draws the qualification divider between the last qualifier and the first non-qualifier', () => {
    const { container } = render(
      <Leaderboard
        rows={rows([['T01', 2500], ['T02', 2000], ['T03', 1500], ['T04', 1000], ['T05', 900]])}
        {...base}
      />,
    );
    const line = container.querySelector('.lb__line');
    expect(line).toBeTruthy();
    expect(line?.textContent).toContain('TOP 3 ADVANCE');

    // It must be positioned immediately before the 4th team's row.
    const slots = [...container.querySelectorAll('.lb__slot')];
    const dividerSlot = slots.find((s) => s.querySelector('.lb__line'));
    expect(dividerSlot?.querySelector('.lb__team-id')?.textContent).toBe('T04');
  });

  it('hides the divider when everybody qualifies', () => {
    const { container } = render(
      <Leaderboard rows={rows([['T01', 2000], ['T02', 1000]])} {...base} qualifiers={10} />,
    );
    expect(container.querySelector('.lb__line')).toBeNull();
  });

  it('marks qualified rows so the styling is not colour-only (spec 46)', () => {
    const { container } = render(
      <Leaderboard rows={rows([['T01', 2500], ['T02', 2000], ['T03', 1500], ['T04', 900]])} {...base} />,
    );
    const flags = [...container.querySelectorAll('.lb__row')].map((r) => r.getAttribute('data-qualified'));
    expect(flags).toEqual(['true', 'true', 'true', 'false']);
  });

  it('marks the viewer own row and labels it', () => {
    const { container } = render(
      <Leaderboard rows={rows([['T01', 2000], ['T02', 1000]])} {...base} meId="T02" />,
    );
    const mine = [...container.querySelectorAll('.lb__row')].find(
      (r) => r.getAttribute('data-me') === 'true',
    );
    expect(mine?.querySelector('.lb__team-id')?.textContent).toBe('T02');
    expect(screen.getByText('YOU')).toBeInTheDocument();
  });

  it('flags disconnected teams with text, not just opacity', () => {
    const data = rows([['T01', 2000], ['T02', 1000]]);
    data[1] = { ...(data[1] as LeaderboardRow), connectionStatus: 'offline' };
    render(<Leaderboard rows={data} {...base} />);
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
  });

  it('honours maxRows for the projector top-N view', () => {
    const { container } = render(
      <Leaderboard
        rows={rows([['T01', 5000], ['T02', 4000], ['T03', 3000], ['T04', 2000], ['T05', 1000]])}
        {...base}
        maxRows={3}
      />,
    );
    expect(container.querySelectorAll('.lb__row')).toHaveLength(3);
  });

  it('renders an empty state rather than a blank panel', () => {
    render(<Leaderboard rows={[]} {...base} />);
    expect(screen.getByText(/No teams yet/i)).toBeInTheDocument();
  });

  it('formats capital and profit with the configured currency', () => {
    render(<Leaderboard rows={rows([['T01', 2500]])} {...base} />);
    expect(screen.getByText('₹2,500')).toBeInTheDocument();
    expect(screen.getByText('+₹1500')).toBeInTheDocument();
  });

  it('shows a dash rather than +₹0 for an untouched team', () => {
    render(<Leaderboard rows={rows([['T01', 1000]])} {...base} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('exposes the board to assistive technology as a table', () => {
    render(<Leaderboard rows={rows([['T01', 2000]])} {...base} />);
    expect(screen.getByRole('table', { name: /leaderboard/i })).toBeInTheDocument();
  });
});
