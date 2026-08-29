/**
 * Result export (spec section 49) - CSV and JSON, generated locally.
 */

import { computeLeaderboard, isPremiumType } from '@code-market/shared';
import type { FullExport, OrganizerExportRow } from '@code-market/shared';
import type { GameEngine } from './core/engine.js';

export function buildResultRows(engine: GameEngine): OrganizerExportRow[] {
  const repo = engine.getRepo();
  const config = engine.getConfig();
  const teams = repo.listTeams();
  const rows = computeLeaderboard(teams, { qualifiers: config.qualifiers });

  return rows.map((row) => {
    const stats = engine.teamStats(row.teamId);
    return {
      rank: row.rank,
      teamId: row.teamId,
      team: row.name,
      startingCapital: row.startingCapital,
      finalCapital: row.capital,
      normalAttempted: stats.marketAttempted,
      normalCorrect: stats.marketCorrect,
      premiumWins: stats.premiumWins,
      premiumAttempts: stats.premiumAttempts,
      premiumCorrect: stats.premiumCorrect,
      premiumWrong: stats.premiumWrong,
      totalProfitLoss: row.capital - row.startingCapital,
      qualification: row.qualified ? 'QUALIFIED' : 'NOT QUALIFIED',
    };
  });
}

const CSV_HEADERS = [
  'Rank',
  'Team ID',
  'Team',
  'Starting Capital',
  'Final Capital',
  'Normal Attempted',
  'Normal Correct',
  'Premium Wins',
  'Premium Attempts',
  'Premium Correct',
  'Premium Wrong',
  'Total Profit/Loss',
  'Qualification Status',
];

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCsv(engine: GameEngine): string {
  const rows = buildResultRows(engine);
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.rank,
        row.teamId,
        row.team,
        row.startingCapital,
        row.finalCapital,
        row.normalAttempted,
        row.normalCorrect,
        row.premiumWins,
        row.premiumAttempts,
        row.premiumCorrect,
        row.premiumWrong,
        row.totalProfitLoss,
        row.qualification,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function exportJson(engine: GameEngine): FullExport {
  const repo = engine.getRepo();
  const config = engine.getConfig();
  return {
    event: { name: config.eventName, round: config.roundName, exportedAt: Date.now() },
    config,
    results: buildResultRows(engine),
    teams: repo.listTeams(),
    challenges: repo.listChallenges().map((c) => ({
      id: c.id,
      index: c.index,
      title: c.title,
      marketType: c.marketType,
      category: c.category,
    })),
    auctions: repo.listAuctions(),
    bids: repo.listAllBids(),
    attempts: repo.listAttempts(),
    transactions: repo.listTransactions(),
    audit: repo.listAudit(100_000),
  };
}

/** A human-readable audit trail for dispute resolution (spec section 35). */
export function exportAuditText(engine: GameEngine): string {
  const entries = engine.listAudit(100_000);
  const lines = entries.map((entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-GB', { hour12: false });
    const who = entry.teamId ?? '--';
    const where = entry.challengeId ? ` ${entry.challengeId}` : '';
    const meta = Object.keys(entry.metadata).length > 0 ? ` ${JSON.stringify(entry.metadata)}` : '';
    return `${time}  ${who.padEnd(6)}  ${entry.action}${where}${meta}`;
  });
  return `${lines.join('\n')}\n`;
}

/** Per-challenge breakdown, useful for a post-event debrief. */
export function exportChallengeStats(engine: GameEngine): {
  challengeId: string;
  index: number;
  title: string;
  marketType: string;
  attempts: number;
  correct: number;
  accuracy: number;
}[] {
  const repo = engine.getRepo();
  return repo.listChallenges().map((challenge) => {
    const counts = repo.countAttemptsForChallenge(challenge.id);
    return {
      challengeId: challenge.id,
      index: challenge.index,
      title: challenge.title,
      marketType: challenge.marketType,
      attempts: counts.attempts,
      correct: counts.correct,
      accuracy: counts.attempts > 0 ? Math.round((counts.correct / counts.attempts) * 100) : 0,
    };
  });
}

export function premiumSummary(engine: GameEngine) {
  const repo = engine.getRepo();
  return repo
    .listChallenges()
    .filter((c) => isPremiumType(c.marketType))
    .map((challenge) => {
      const auction = repo.getAuctionForChallenge(challenge.id);
      const premium = repo.getPremiumState(challenge.id);
      return {
        challengeId: challenge.id,
        index: challenge.index,
        title: challenge.title,
        winner: auction?.winnerTeamId ?? null,
        winningBid: auction?.winningAmount ?? null,
        outcome: premium?.outcome ?? null,
        ladder: premium?.ladder ?? [],
      };
    });
}
