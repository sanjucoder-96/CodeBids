/**
 * Event-day entry point.
 *
 *   node dist/index.js               start the server
 *   node dist/index.js --port 4400   choose a port
 *   node dist/index.js --seed 20     create 20 demo teams and exit
 *   node dist/index.js --reset       wipe game data (keeps teams) and exit
 *   node dist/index.js --passcode 1234
 */

import { resolve } from 'node:path';
import { createApp, VERSION } from './app.js';
import { connectionInfo } from './net/netinfo.js';

interface Args {
  port: number;
  dbFile: string;
  passcode?: string;
  seed?: number;
  reset?: boolean;
  help?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    port: Number(process.env.PORT ?? 4400),
    dbFile: process.env.DB_FILE ?? resolve(process.cwd(), 'data/code-market.db'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--port':
        args.port = Number(next);
        i++;
        break;
      case '--db':
        args.dbFile = resolve(String(next));
        i++;
        break;
      case '--passcode':
        args.passcode = String(next);
        i++;
        break;
      case '--seed':
        args.seed = Number(next ?? 20);
        if (next && !next.startsWith('--')) i++;
        break;
      case '--reset':
        args.reset = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        break;
    }
  }
  return args;
}

const HELP = `
CSI CLUB - CODE MARKET  (v${VERSION})

  --port <n>       HTTP + WebSocket port (default 4400)
  --db <path>      SQLite file (default ./data/code-market.db)
  --passcode <s>   Organizer console passcode
  --seed <n>       Create n demo teams, then exit
  --reset          Clear all game data (keeps teams), then exit
  --help           This message
`;

function banner(port: number, passcode: string, toolchain: Record<string, unknown>): void {
  const info = connectionInfo(port);
  const line = '='.repeat(64);
  const rows = [
    '',
    line,
    '   CSI CLUB  -  CODE MARKET   |   ROUND 2   |   OFFLINE LAN MODE',
    line,
    '',
    '   PARTICIPANTS   ' + info.participantUrl,
    '   ORGANIZER      ' + info.organizerUrl,
    '   PROJECTOR      ' + info.projectorUrl,
    '',
    '   OPERATOR PASSCODE   ' + passcode,
    '',
  ];
  if (info.addresses.length > 1) {
    rows.push('   All bound addresses:');
    for (const address of info.addresses) {
      const tags = [address.private ? 'private LAN' : 'public', address.virtual ? 'VIRTUAL - clients cannot reach this' : null]
        .filter(Boolean)
        .join(', ');
      rows.push(`     - ${address.url}  (${address.iface}; ${tags})`);
    }
    rows.push('');
  }
  if (info.addresses.length === 0) {
    rows.push('   WARNING: no external IPv4 address found. Connect to the event');
    rows.push('   router before participants try to reach this machine.');
    rows.push('');
  }
  rows.push(`   Code runner: ${JSON.stringify(toolchain)}`);
  rows.push(`   Internet is NOT required. Everything runs on this machine.`);
  rows.push(line, '');
  process.stdout.write(rows.join('\n'));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const built = await createApp({
    dbFile: args.dbFile,
    port: args.port,
    ...(args.passcode ? { organizerPasscode: args.passcode } : {}),
  });

  if (args.reset) {
    built.engine.resetGame(true);
    process.stdout.write('Game data cleared. Teams and their join codes were kept.\n');
    await built.close();
    return;
  }

  if (args.seed !== undefined) {
    const count = Number.isFinite(args.seed) && args.seed > 0 ? args.seed : 20;
    built.simulator.seedTeams(count, false);
    const repo = built.repo;
    process.stdout.write(`Created ${count} teams:\n\n`);
    for (const team of repo.listTeams()) {
      process.stdout.write(`  ${team.id}  ${team.name.padEnd(18)}  join code: ${repo.getJoinCode(team.id)}\n`);
    }
    process.stdout.write('\n');
    await built.close();
    return;
  }

  const { port } = await built.listen();
  banner(port, built.organizerPasscode, built.toolchain as unknown as Record<string, unknown>);

  const shutdown = async (signal: string) => {
    process.stdout.write(`\n${signal} received - shutting down cleanly.\n`);
    await built.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/**
 * Startup failures happen at the worst possible moment - five minutes before
 * the round, on someone else's laptop. Translate the ones we can predict into
 * an instruction rather than a stack trace.
 */
function explainStartupError(error: unknown, port: number): string {
  const code = (error as { code?: string } | null)?.code;
  const line = '-'.repeat(64);

  if (code === 'EADDRINUSE') {
    return [
      '',
      line,
      `  PORT ${port} IS ALREADY IN USE`,
      line,
      '',
      '  Another Code Market server is almost certainly still running.',
      '',
      '  Either use that one - it already has your teams and scores - or stop',
      '  it first and start again:',
      '',
      '    Windows   netstat -ano | findstr :' + port,
      '              taskkill /PID <pid> /F',
      '',
      '    macOS     lsof -ti :' + port + ' | xargs kill',
      '    Linux     fuser -k ' + port + '/tcp',
      '',
      '  Or run this one on a different port:',
      '',
      '    npm start -- --port ' + (port + 1),
      '',
      line,
      '',
    ].join('\n');
  }

  if (code === 'EACCES') {
    return [
      '',
      `  PERMISSION DENIED binding port ${port}.`,
      '  Ports below 1024 need administrator rights. Use a higher port:',
      '',
      '    npm start -- --port 4400',
      '',
    ].join('\n');
  }

  return `\nFailed to start: ${String(error)}\n`;
}

main().catch((error: unknown) => {
  const port = parseArgs(process.argv.slice(2)).port;
  process.stderr.write(explainStartupError(error, port));
  process.exit(1);
});
