/** Small shared helpers used on both sides of the wire. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function padTeamNumber(n: number): string {
  return `T${String(n).padStart(2, '0')}`;
}

export function challengeCode(index: number): string {
  return `C${String(index).padStart(2, '0')}`;
}

export function formatClock(msRemaining: number): string {
  const total = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatTimeOfDay(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

/**
 * The round is GENERATED, not fixed: see `sequence.ts`. These helpers describe
 * a slot once the server has drawn it.
 */
export function questionCode(index: number): string {
  return `Q${String(index).padStart(2, '0')}`;
}

export function isPremium(kind: string): boolean {
  return kind === 'premium';
}

/** Stable, dependency-free id generator for client-side correlation ids. */
let ridCounter = 0;
export function nextRid(prefix = 'r'): string {
  ridCounter = (ridCounter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${ridCounter.toString(36)}`;
}

/** Deterministic PRNG so simulation runs are reproducible when seeded. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)] as T;
}
