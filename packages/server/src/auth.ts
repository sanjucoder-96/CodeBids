/**
 * Local event authentication (spec section 37).
 *
 * No internet, no accounts, no external identity provider. The organizer
 * creates teams; each team gets a short JOIN CODE printed on its table card.
 * A client exchanges the join code for an HMAC-signed session token which is
 * also recorded in SQLite, so:
 *
 *   - Team 01 cannot pretend to be Team 02 (it would need T02's join code),
 *   - a token survives a browser refresh and a server restart,
 *   - revoking a team invalidates its tokens.
 *
 * The organizer console is protected by an operator passcode that is printed in
 * the server console at boot.
 */

import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { Repo } from './repo/index.js';

export type Role = 'participant' | 'organizer' | 'projector';

export interface Identity {
  role: Role;
  teamId: string | null;
  token: string;
}

/** Unambiguous alphabet: no O/0, no I/1. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A team's join code.
 *
 * Random by default, because a guessable code lets one team sign in as
 * another. Pass `rand` (a seeded generator) to make a run reproducible, so two
 * machines preparing the same event produce the same cards. That is an
 * explicit opt-in: the seed lives in the operator's command, never in the
 * repository.
 */
export function generateJoinCode(length = 6, rand?: () => number): string {
  let out = '';
  if (rand) {
    for (let i = 0; i < length; i++) {
      const pick = Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length;
      out += CODE_ALPHABET[pick];
    }
    return out;
  }
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[(bytes[i] as number) % CODE_ALPHABET.length];
  }
  return out;
}

export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

export function hashAccessKey(key: string, secret: string): string {
  return createHmac('sha256', secret).update(normaliseKey(key)).digest('hex');
}

export function normaliseKey(key: string): string {
  return key.trim().toUpperCase().replace(/\s+/g, '');
}

export function verifyAccessKey(key: string, expectedHash: string, secret: string): boolean {
  const actual = Buffer.from(hashAccessKey(key, secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function hashPasscode(passcode: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${passcode}`).digest('hex');
}

export class AuthService {
  constructor(
    private readonly repo: Repo,
    private readonly secret: string,
    private readonly organizerPasscode: string,
  ) {}

  get passcode(): string {
    return this.organizerPasscode;
  }

  /** Mint a token bound to a role and (optionally) a team. */
  private mint(role: Role, teamId: string | null): string {
    const nonce = randomBytes(12).toString('hex');
    const body = `${role}:${teamId ?? '-'}:${nonce}`;
    const sig = createHmac('sha256', this.secret).update(body).digest('hex').slice(0, 32);
    return `${Buffer.from(body).toString('base64url')}.${sig}`;
  }

  /** Verify signature, then confirm the session still exists in the database. */
  verify(token: string): Identity | null {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return null;
    let body: string;
    try {
      body = Buffer.from(encoded, 'base64url').toString();
    } catch {
      return null;
    }
    const expected = createHmac('sha256', this.secret).update(body).digest('hex').slice(0, 32);
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

    const [role, teamPart] = body.split(':');
    if (role !== 'participant' && role !== 'organizer' && role !== 'projector') return null;

    if (role === 'participant') {
      const session = this.repo.getSession(token);
      if (!session) return null;
      const team = this.repo.getTeam(session.teamId);
      if (!team) return null;
      return { role, teamId: session.teamId, token };
    }
    return { role, teamId: teamPart === '-' ? null : (teamPart as string), token };
  }

  /** Exchange a printed join code for a participant session. */
  loginTeam(joinCode: string): { token: string; teamId: string } | null {
    const team = this.repo.getTeamByJoinCode(normaliseKey(joinCode));
    if (!team) return null;
    return this.sessionForTeam(team.id);
  }

  /**
   * Mint and persist a participant session for a known team id. Used by
   * self-service registration, where the team is identified by the name the
   * participant typed rather than by a printed code.
   */
  sessionForTeam(teamId: string): { token: string; teamId: string } {
    const token = this.mint('participant', teamId);
    this.repo.createSession(token, teamId, 'participant');
    return { token, teamId };
  }

  loginOrganizer(passcode: string): { token: string } | null {
    const given = Buffer.from(hashPasscode(String(passcode ?? ''), this.secret), 'hex');
    const want = Buffer.from(hashPasscode(this.organizerPasscode, this.secret), 'hex');
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    return { token: this.mint('organizer', null) };
  }

  /**
   * The projector is a read-only display on the organizer's own LAN and must be
   * trivially connectable from a podium machine, so it needs no passcode. It
   * receives strictly public data.
   */
  loginProjector(): { token: string } {
    return { token: this.mint('projector', null) };
  }
}
