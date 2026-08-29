import { DEFAULT_CONFIG } from '@code-market/shared';

export function money(amount: number, symbol = DEFAULT_CONFIG.currencySymbol): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}${symbol}${Math.abs(rounded).toLocaleString('en-IN')}`;
}

export function delta(amount: number, symbol = DEFAULT_CONFIG.currencySymbol): string {
  const rounded = Math.round(amount);
  if (rounded === 0) return `${symbol}0`;
  return `${rounded > 0 ? '+' : '-'}${symbol}${Math.abs(rounded).toLocaleString('en-IN')}`;
}

export function clock(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function timeOfDay(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function challengeLabel(index: number, marketType: string): string {
  const number = String(index).padStart(2, '0');
  if (marketType === 'final_premium') return `FINAL PREMIUM #${number}`;
  if (marketType === 'premium') return `PREMIUM #${number}`;
  return `MARKET #${number}`;
}

const CATEGORY_LABELS: Record<string, string> = {
  dsa: 'Data Structures',
  algorithms: 'Algorithms',
  sql: 'SQL',
  os: 'Operating Systems',
  dbms: 'DBMS',
  networking: 'Networking',
  oop: 'OOP',
  security: 'Security',
  logic: 'Logic',
  optimization: 'Optimization',
  cs_concepts: 'CS Concepts',
  code_analysis: 'Code Analysis',
  output_prediction: 'Output Prediction',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');
}

const TYPE_LABELS: Record<string, string> = {
  mcq: 'Single choice',
  multi: 'Multiple select',
  true_false: 'True / False',
  output: 'Predict the output',
  numeric: 'Numeric answer',
  short_text: 'Short answer',
  ordering: 'Put in order',
  matching: 'Match the pairs',
  code: 'Write code',
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

export function ordinal(n: number): string {
  const suffix = ['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] ?? ['th', 'st', 'nd', 'rd'][n % 100] ?? 'th';
  return `${n}${suffix}`;
}

export function medal(rank: number): string {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

export function relativeTime(ts: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
