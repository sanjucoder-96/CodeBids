/**
 * Self-service team registration.
 *
 * Teams are not a fixed pre-seeded roster: a participant opens the event link and
 * enters their TEAM NAME. A new name creates the team (starting capital, reserve
 * and a join code); an existing name re-joins it so a teammate's second laptop or
 * a reconnect lands on the same team rather than a duplicate.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';
import { createApp, type App } from '../src/app.js';
import { DEFAULT_CONFIG } from '@code-market/shared';

describe('engine.registerTeam', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.close());

  it('creates a team from a name, with the standard purse and reserve', () => {
    const team = h.engine.registerTeam('CODEFORCE');
    expect(team.name).toBe('CODEFORCE');
    expect(team.capital).toBe(DEFAULT_CONFIG.startingCapital);
    expect(team.protectedReserve).toBe(DEFAULT_CONFIG.protectedReserve);
    expect(h.repo.getTeam(team.id)?.name).toBe('CODEFORCE');
    // A join code is still allocated (usable as a fallback / for a second device).
    expect(h.repo.getJoinCode(team.id)).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('re-joins the same team when the name matches (case-insensitive), no duplicate', () => {
    const first = h.engine.registerTeam('Byte Squad');
    const again = h.engine.registerTeam('  byte squad  ');
    expect(again.id).toBe(first.id);
    expect(h.repo.listTeams()).toHaveLength(1);
  });

  it('has no fixed team count - any number can register', () => {
    for (let i = 1; i <= 25; i++) h.engine.registerTeam(`TEAM ${i}`);
    expect(h.repo.listTeams()).toHaveLength(25);
  });

  it('assigns the next free id even after a team is deleted', () => {
    const a = h.engine.registerTeam('ALPHA'); // T01
    const b = h.engine.registerTeam('BRAVO'); // T02
    h.engine.deleteTeam(a.id);
    const c = h.engine.registerTeam('CHARLIE'); // should reuse T01, not collide
    expect(c.id).toBe('T01');
    expect(b.id).toBe('T02');
  });

  it('rejects an empty or overly long name', () => {
    expect(() => h.engine.registerTeam('   ')).toThrow(/team name/i);
    expect(() => h.engine.registerTeam('X'.repeat(25))).toThrow(/too long/i);
  });
});

describe('POST /api/auth/team/register over HTTP', () => {
  let app: App;
  let baseUrl = '';

  beforeAll(async () => {
    app = await createApp({
      dbFile: ':memory:',
      port: 0,
      organizerPasscode: 'round3',
      serveClient: false,
      detectToolchain: false,
    });
    const { port } = await app.listen();
    baseUrl = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => app.close());

  async function register(name: string) {
    const r = await fetch(`${baseUrl}/api/auth/team/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  }

  it('registers a team and returns a working session token', async () => {
    const { status, body } = await register('NULL POINTERS');
    expect(status).toBe(200);
    expect(body.token).toBeTruthy();
    expect(body.teamName).toBe('NULL POINTERS');
    // The token authenticates as that participant.
    const who = await fetch(`${baseUrl}/api/auth/whoami`, {
      headers: { authorization: `Bearer ${body.token as string}` },
    });
    expect(who.status).toBe(200);
    expect(((await who.json()) as { role: string }).role).toBe('participant');
  });

  it('re-joins an existing team by name rather than creating a duplicate', async () => {
    const first = await register('SEGFAULT');
    const second = await register('segfault');
    expect(second.body.teamId).toBe(first.body.teamId);
  });

  it('rejects a blank name with 400', async () => {
    const { status } = await register('   ');
    expect(status).toBe(400);
  });
});
