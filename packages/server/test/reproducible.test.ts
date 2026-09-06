/**
 * Reproducible team setup.
 *
 * Two people preparing the same event on two machines need the same printed
 * cards, or the codes on the table will not match the server actually running
 * the round. A supplied seed makes the join codes reproducible; without one
 * they stay cryptographically random, because a guessable code would let one
 * team sign in as another.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import { Repo } from '../src/repo/index.js';
import { AuthService, generateJoinCode } from '../src/auth.js';
import { GameEngine } from '../src/core/engine.js';
import { CodeRunner } from '../src/core/codeRunner.js';
import { mulberry32 } from '@code-market/shared';

const engines: GameEngine[] = [];

function build(teamCodeSeed?: number) {
  const db = openDatabase({ file: ':memory:' });
  const repo = new Repo(db);
  repo.setMeta('secret', 'test-secret');
  const auth = new AuthService(repo, 'test-secret', '1234');
  const engine = new GameEngine({
    repo,
    auth,
    secret: 'test-secret',
    runner: new CodeRunner({ python: null, cpp: null, java: null }),
    ...(teamCodeSeed === undefined ? {} : { teamCodeSeed }),
  });
  engine.seedQuestions();
  engines.push(engine);
  return { engine, repo };
}

function codesFor(teamCodeSeed: number | undefined, count = 6): string[] {
  const { engine, repo } = build(teamCodeSeed);
  engine.createTeams(
    Array.from({ length: count }, (_, i) => ({ name: `TEAM ${i + 1}` })),
  );
  return repo.listTeams().map((team) => repo.getJoinCode(team.id) ?? '');
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
});

describe('join codes', () => {
  it('are identical on two machines given the same seed', () => {
    expect(codesFor(2026)).toEqual(codesFor(2026));
  });

  it('differ between seeds', () => {
    expect(codesFor(2026)).not.toEqual(codesFor(2027));
  });

  it('are random when no seed is given', () => {
    // Two unseeded runs colliding across six codes would be astronomical.
    expect(codesFor(undefined)).not.toEqual(codesFor(undefined));
  });

  it('are still unique within one event when seeded', () => {
    const codes = codesFor(2026, 40);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('use the unambiguous alphabet, seeded or not', () => {
    // No O/0 and no I/1: the codes are read off printed cards.
    for (const code of [...codesFor(2026, 12), ...codesFor(undefined, 12)]) {
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });
});

describe('generateJoinCode', () => {
  it('is deterministic for a given generator', () => {
    expect(generateJoinCode(6, mulberry32(99))).toBe(generateJoinCode(6, mulberry32(99)));
  });

  it('never indexes past the alphabet', () => {
    // A generator returning exactly 1 must not produce `undefined`.
    expect(generateJoinCode(6, () => 1)).toMatch(/^[A-Z2-9]{6}$/);
    expect(generateJoinCode(6, () => 0)).toBe('AAAAAA');
  });
});

describe('question keys', () => {
  it('are the same on every install, because they live in the source', () => {
    const first = build().repo;
    const second = build().repo;
    const keys = (repo: Repo) =>
      repo.listQuestions().map((q) => `${q.id}=${q.accessKey}`);
    expect(keys(first)).toEqual(keys(second));
    expect(keys(first).length).toBeGreaterThan(0);
  });
});
