/**
 * Serving the built client.
 *
 * `wildcard: false` is what lets an unmatched path reach the SPA fallback, but
 * it also means the static plugin only knows the files present when it was
 * registered. Rebuilding the client against a running server then produced an
 * index.html naming bundles the server refused to serve, and a blank page.
 * The fallback resolves such files from disk - without letting a crafted path
 * escape the client directory.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { resolveInside } from '../src/app.js';

const dirs: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-static-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      /* the OS reclaims it */
    }
  }
});

describe('late asset resolution', () => {
  it('finds a file that exists under the client directory', () => {
    const dir = root();
    expect(resolveInside(dir, '/assets/index-abc123.js')).toBe(
      resolve(dir, 'assets/index-abc123.js'),
    );
    expect(resolveInside(dir, '/index.html')).toBe(resolve(dir, 'index.html'));
  });

  it('finds a file written after the directory was first read', () => {
    const dir = root();
    expect(resolveInside(dir, '/assets/index-new999.js')).toBeNull();
    writeFileSync(join(dir, 'assets', 'index-new999.js'), 'console.log(2)');
    expect(resolveInside(dir, '/assets/index-new999.js')).toBe(
      resolve(dir, 'assets/index-new999.js'),
    );
  });

  it('returns null for a file that does not exist', () => {
    expect(resolveInside(root(), '/assets/missing.js')).toBeNull();
  });

  it('refuses to escape the client directory', () => {
    const dir = root();
    for (const attempt of [
      '/../secret.env',
      '/assets/../../secret.env',
      '/..%2Fsecret.env',
      '/assets/%2e%2e/%2e%2e/secret.env',
    ]) {
      expect(resolveInside(dir, attempt), attempt).toBeNull();
    }
  });

  it('refuses a malformed percent-encoding rather than throwing', () => {
    expect(resolveInside(root(), '/assets/%E0%A4%A.js')).toBeNull();
  });

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    const dir = root();
    const sibling = `${dir}-evil`;
    mkdirSync(sibling, { recursive: true });
    dirs.push(sibling);
    writeFileSync(join(sibling, 'secret.js'), 'x');
    const siblingName = basename(sibling);
    expect(resolveInside(dir, `/../${siblingName}/secret.js`)).toBeNull();
  });
});
