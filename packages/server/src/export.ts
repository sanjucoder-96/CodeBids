/**
 * Result export (spec sections 12, 21). CSV and JSON, generated locally.
 */

import { computeLeaderboard, computePodium } from '@code-market/shared';
import type { FullExport, OrganizerExportRow } from '@code-market/shared';
import type { GameEngine } from './core/engine.js';

const PLACE_LABEL: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd' };

export function buildResultRows(engine: GameEngine): OrganizerExportRow[] {
  const repo = engine.getRepo();
  const config = engine.getConfig();
  const rows = computeLeaderboard(repo.listTeams(), { podiumPlaces: config.podiumPlaces });

  return rows.map((row) => {
    const stats = engine.teamStats(row.teamId);
    return {
      rank: row.rank,
      place: row.podium ? (PLACE_LABEL[row.podium] ?? `${row.podium}th`) : '',
      teamId: row.teamId,
      team: row.name,
      startingCapital: row.startingCapital,
      finalCapital: row.capital,
      attempted: stats.attempted,
      correct: stats.correct,
      wrong: stats.wrong,
      premiumWins: stats.premiumWins,
      premiumAttempts: stats.premiumAttempts,
      premiumCorrect: stats.premiumCorrect,
      premiumWrong: stats.premiumWrong,
      totalProfitLoss: row.capital - row.startingCapital,
    };
  });
}

const CSV_HEADERS = [
  'Rank',
  'Place',
  'Team ID',
  'Team',
  'Starting Capital',
  'Final Capital',
  'Questions Attempted',
  'Correct',
  'Wrong',
  'Premium Wins',
  'Premium Attempts',
  'Premium Correct',
  'Premium Wrong',
  'Total Profit/Loss',
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
        row.place,
        row.teamId,
        row.team,
        row.startingCapital,
        row.finalCapital,
        row.attempted,
        row.correct,
        row.wrong,
        row.premiumWins,
        row.premiumAttempts,
        row.premiumCorrect,
        row.premiumWrong,
        row.totalProfitLoss,
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
  const leaderboard = computeLeaderboard(repo.listTeams(), {
    podiumPlaces: config.podiumPlaces,
  });
  return {
    event: {
      name: config.eventName,
      round: config.roundName,
      roundNumber: config.roundNumber,
      exportedAt: Date.now(),
    },
    config,
    results: buildResultRows(engine),
    podium: computePodium(leaderboard, config.podiumPlaces),
    sequence: engine.sequenceEntries(),
    teams: repo.listTeams(),
    auctions: repo.listAuctions(),
    bids: repo.listAllBids(),
    attempts: repo.listAttempts(),
    transactions: repo.listTransactions(),
    audit: repo.listAudit(100_000),
  };
}

/** A human-readable audit trail for dispute resolution. */
export function exportAuditText(engine: GameEngine): string {
  const entries = engine.listAudit(100_000);
  const lines = entries.map((entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-GB', { hour12: false });
    const who = entry.teamId ?? '--';
    const where = entry.questionId ? ` ${entry.questionId}` : '';
    const meta = Object.keys(entry.metadata).length > 0 ? ` ${JSON.stringify(entry.metadata)}` : '';
    return `${time}  ${who.padEnd(6)}  ${entry.action}${where}${meta}`;
  });
  return `${lines.join('\n')}\n`;
}

/** Per-slot breakdown of the generated round. */
export function exportSequenceStats(engine: GameEngine) {
  const repo = engine.getRepo();
  return engine.sequenceEntries().map((entry) => {
    const counts = repo.countAttemptsForSlot(entry.index);
    return {
      slotIndex: entry.index,
      blockNumber: entry.blockNumber,
      kind: entry.kind,
      questionId: entry.questionId,
      title: entry.title,
      domain: entry.domain,
      difficulty: entry.difficulty,
      timeLimit: entry.timeLimit,
      state: entry.state,
      inFinalStretch: entry.inFinalStretch,
      attempts: counts.attempts,
      correct: counts.correct,
      accuracy: counts.attempts > 0 ? Math.round((counts.correct / counts.attempts) * 100) : 0,
    };
  });
}

export function premiumSummary(engine: GameEngine) {
  const repo = engine.getRepo();
  return engine
    .sequenceEntries()
    .filter((entry) => entry.kind === 'premium')
    .map((entry) => {
      const auction = repo.getAuctionForSlot(entry.index);
      const premium = repo.getPremiumState(entry.questionId);
      return {
        questionId: entry.questionId,
        slotIndex: entry.index,
        blockNumber: entry.blockNumber,
        title: entry.title,
        domain: entry.domain,
        difficulty: entry.difficulty,
        winner: auction?.winnerTeamId ?? null,
        winningBid: auction?.winningAmount ?? null,
        outcome: premium?.outcome ?? null,
        ladder: premium?.ladder ?? [],
      };
    });
}
