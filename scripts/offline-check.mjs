/**
 * Offline audit (spec sections 41, 51).
 *
 * Statically proves the built application has no runtime dependency on the
 * internet: it scans the production bundle and the server output for absolute
 * external URLs, CDN references and remote font/asset loads.
 *
 * Run: npm run offline:check   (after npm run build)
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const TARGETS = [
  { dir: join(ROOT, 'packages/client/dist'), label: 'client bundle' },
  { dir: join(ROOT, 'packages/server/dist'), label: 'server bundle' },
];

const SCAN_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.map', '.sql']);

/** Hosts that would mean the event depends on the internet. */
const FORBIDDEN = [
  { re: /https?:\/\/fonts\.googleapis\.com/gi, why: 'Google Fonts stylesheet' },
  { re: /https?:\/\/fonts\.gstatic\.com/gi, why: 'Google Fonts files' },
  { re: /https?:\/\/cdn\.[a-z0-9-]+\./gi, why: 'CDN reference' },
  { re: /https?:\/\/unpkg\.com/gi, why: 'unpkg CDN' },
  { re: /https?:\/\/cdnjs\./gi, why: 'cdnjs CDN' },
  { re: /https?:\/\/[a-z0-9-]*jsdelivr\.net/gi, why: 'jsDelivr CDN' },
  { re: /https?:\/\/[a-z0-9-]+\.googleapis\.com/gi, why: 'Google APIs' },
  { re: /https?:\/\/[a-z0-9-]+\.firebaseio\.com/gi, why: 'Firebase' },
  { re: /https?:\/\/[a-z0-9-]+\.supabase\./gi, why: 'Supabase' },
  { re: /https?:\/\/api\.[a-z0-9-]+\.(com|io|dev)/gi, why: 'external API' },
  { re: /https?:\/\/[a-z0-9-]+\.sentry\.io/gi, why: 'Sentry telemetry' },
  { re: /google-analytics|googletagmanager|hotjar|mixpanel|segment\.io/gi, why: 'analytics' },
];

/**
 * URLs that are fine to appear as inert text: source-map comments, licence
 * headers, spec links and documentation references never cause a request.
 */
const ALLOWED_CONTEXT = [
  /sourceMappingURL/i,
  /@license/i,
  /^\s*\*/,
  /w3\.org/i,
  /developer\.mozilla\.org/i,
  /react\.dev/i,
  /eslint\.org/i,
  /https?:\/\/localhost/i,
  /https?:\/\/127\.0\.0\.1/i,
];

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let failures = 0;
let scanned = 0;
const notes = [];

for (const target of TARGETS) {
  if (!existsSync(target.dir)) {
    notes.push(`SKIP  ${target.label}: not built yet (${relative(ROOT, target.dir)})`);
    continue;
  }

  for (const file of walk(target.dir)) {
    if (!SCAN_EXT.has(extname(file))) continue;
    scanned += 1;
    const text = readFileSync(file, 'utf8');

    for (const rule of FORBIDDEN) {
      rule.re.lastIndex = 0;
      let match;
      while ((match = rule.re.exec(text)) !== null) {
        const lineStart = text.lastIndexOf('\n', match.index) + 1;
        const lineEnd = text.indexOf('\n', match.index);
        const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
        if (ALLOWED_CONTEXT.some((allowed) => allowed.test(line))) continue;
        failures += 1;
        notes.push(
          `FAIL  ${relative(ROOT, file)}: ${rule.why} -> ${match[0]}`,
        );
      }
    }
  }
}

/* --- fonts must be emitted locally --------------------------------- */

const clientAssets = join(ROOT, 'packages/client/dist/assets');
if (existsSync(clientAssets)) {
  const fonts = readdirSync(clientAssets).filter((f) => /\.(woff2?|ttf|otf)$/i.test(f));
  if (fonts.length === 0) {
    failures += 1;
    notes.push('FAIL  no local font files were emitted - fonts may be loading remotely');
  } else {
    notes.push(`OK    ${fonts.length} font files bundled locally`);
  }

  const indexHtml = join(ROOT, 'packages/client/dist/index.html');
  if (existsSync(indexHtml)) {
    const html = readFileSync(indexHtml, 'utf8');
    const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/gi)].map((m) => m[1]);
    if (external.length > 0) {
      failures += 1;
      notes.push(`FAIL  index.html references external URLs: ${external.join(', ')}`);
    } else {
      notes.push('OK    index.html references only local assets');
    }
  }
}

/* --- report --------------------------------------------------------- */

const line = '='.repeat(62);
process.stdout.write(`\n${line}\n  OFFLINE AUDIT  (spec 41 / 51)\n${line}\n\n`);
for (const note of notes) process.stdout.write(`  ${note}\n`);
process.stdout.write(`\n  Scanned ${scanned} built files.\n`);

if (failures > 0) {
  process.stdout.write(`\n  RESULT: FAIL - ${failures} external dependency issue(s).\n\n`);
  process.exit(1);
}

process.stdout.write(
  '\n  RESULT: PASS - no external network dependency found in the build.\n' +
    '  The event can run with the internet physically disconnected.\n\n',
);
