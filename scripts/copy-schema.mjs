// Copy non-TS assets that tsc does not emit into the server bundle.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'packages/server/src/db/schema.sql');
const to = resolve(root, 'packages/server/dist/db/schema.sql');
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
process.stdout.write(`copied schema.sql -> ${to}\n`);
