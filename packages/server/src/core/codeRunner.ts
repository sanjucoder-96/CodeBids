/**
 * Local code execution (spec section 38).
 *
 * SANDBOX LIMITATION - read this before enabling it.
 * -------------------------------------------------
 * This runner executes submitted source with the toolchain already installed on
 * the ORGANIZER machine. It enforces:
 *
 *   - a hard wall-clock timeout (SIGKILL),
 *   - an output size cap,
 *   - a per-run temporary directory that is deleted afterwards,
 *   - no network arguments and no shell interpolation (spawn with argv),
 *   - a source size cap.
 *
 * It does NOT provide OS-level isolation (no container, no seccomp, no chroot).
 * A malicious submission could still read files the server user can read. For a
 * supervised, in-person college round on a private LAN, with a volunteer sat
 * next to every laptop, that is an acceptable trade-off - but it is why
 * `codeExecutionEnabled` defaults to FALSE and why the shipped 12-question pool
 * needs no execution at all. Enable it only if you understand the above.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodeLanguage, EvaluationOutcome } from '@code-market/shared';
import { outputMatches } from '@code-market/shared';

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;

export interface RunnerToolchain {
  python: string | null;
  cpp: string | null;
  java: { javac: string; java: string } | null;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function exec(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; timeoutMs: number },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString();
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
        stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
        code,
        timedOut,
      });
    };

    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));

    if (options.input !== undefined) {
      child.stdin.on('error', () => {
        /* a program that never reads stdin closes the pipe early; harmless */
      });
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

async function which(command: string, args: string[] = ['--version']): Promise<boolean> {
  const result = await exec(command, args, { timeoutMs: 5000 });
  return result.code === 0 && !result.timedOut;
}

/** Probe the machine once at boot so the organizer UI can report what works. */
export async function detectToolchain(): Promise<RunnerToolchain> {
  const [py, py3, gpp, javac, java] = await Promise.all([
    which('python'),
    which('python3'),
    which('g++'),
    which('javac'),
    which('java'),
  ]);
  return {
    python: py ? 'python' : py3 ? 'python3' : null,
    cpp: gpp ? 'g++' : null,
    java: javac && java ? { javac: 'javac', java: 'java' } : null,
  };
}

export interface RunRequest {
  language: CodeLanguage;
  source: string;
  testCases: { input: string; output: string; hidden?: boolean }[];
  timeoutMs: number;
}

export class CodeRunner {
  constructor(private readonly toolchain: RunnerToolchain) {}

  get available(): CodeLanguage[] {
    const langs: CodeLanguage[] = [];
    if (this.toolchain.python) langs.push('python');
    if (this.toolchain.cpp) langs.push('cpp');
    if (this.toolchain.java) langs.push('java');
    return langs;
  }

  supports(language: CodeLanguage): boolean {
    return this.available.includes(language);
  }

  async run(request: RunRequest): Promise<EvaluationOutcome> {
    if (request.source.length > MAX_SOURCE_BYTES) {
      return { correct: false, detail: 'Source exceeds the 64 KB limit' };
    }
    if (!this.supports(request.language)) {
      return { correct: false, detail: `No local toolchain for ${request.language}` };
    }

    const dir = mkdtempSync(join(tmpdir(), 'codemarket-'));
    try {
      const prepared = await this.prepare(dir, request);
      if ('error' in prepared) return { correct: false, detail: prepared.error };

      let passed = 0;
      for (const [index, test] of request.testCases.entries()) {
        const result = await exec(prepared.command, prepared.args, {
          cwd: dir,
          input: test.input,
          timeoutMs: request.timeoutMs,
        });
        if (result.timedOut) {
          return {
            correct: false,
            detail: `Test ${index + 1}: time limit exceeded`,
            testsPassed: passed,
            testsTotal: request.testCases.length,
          };
        }
        if (result.code !== 0) {
          return {
            correct: false,
            detail: `Test ${index + 1}: runtime error${result.stderr ? ` - ${firstLine(result.stderr)}` : ''}`,
            testsPassed: passed,
            testsTotal: request.testCases.length,
          };
        }
        if (!outputMatches(result.stdout, test.output)) {
          return {
            correct: false,
            detail: test.hidden
              ? `Failed a hidden test (${passed}/${request.testCases.length} passed)`
              : `Test ${index + 1}: expected "${test.output.trim()}", got "${result.stdout.trim()}"`,
            testsPassed: passed,
            testsTotal: request.testCases.length,
          };
        }
        passed += 1;
      }

      return {
        correct: true,
        detail: `All ${passed} tests passed`,
        testsPassed: passed,
        testsTotal: request.testCases.length,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  private async prepare(
    dir: string,
    request: RunRequest,
  ): Promise<{ command: string; args: string[] } | { error: string }> {
    switch (request.language) {
      case 'python': {
        const file = join(dir, 'main.py');
        writeFileSync(file, request.source);
        return { command: this.toolchain.python as string, args: [file] };
      }
      case 'cpp': {
        const src = join(dir, 'main.cpp');
        const bin = join(dir, process.platform === 'win32' ? 'main.exe' : 'main');
        writeFileSync(src, request.source);
        const compile = await exec(this.toolchain.cpp as string, ['-O2', '-std=c++17', src, '-o', bin], {
          cwd: dir,
          timeoutMs: Math.max(request.timeoutMs, 10_000),
        });
        if (compile.code !== 0) {
          return { error: `Compilation failed: ${firstLine(compile.stderr)}` };
        }
        return { command: bin, args: [] };
      }
      case 'java': {
        const tools = this.toolchain.java;
        if (!tools) return { error: 'No Java toolchain' };
        const src = join(dir, 'Main.java');
        writeFileSync(src, request.source);
        const compile = await exec(tools.javac, [src], {
          cwd: dir,
          timeoutMs: Math.max(request.timeoutMs, 20_000),
        });
        if (compile.code !== 0) {
          return { error: `Compilation failed: ${firstLine(compile.stderr)}` };
        }
        return { command: tools.java, args: ['-cp', dir, 'Main'] };
      }
      default:
        return { error: 'Unsupported language' };
    }
  }
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').slice(0, 200);
}
