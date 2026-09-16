#!/usr/bin/env node
/**
 * Zero-dependency dev launcher.
 *
 * Boots the API + realtime server and the Vite dashboard side by side in one
 * terminal, prefixes their output, and shuts both down together on Ctrl+C.
 *
 * Deliberately avoids `concurrently` so `npm run dev` works immediately after
 * `npm run install:all` with no extra root-level dependency to download.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const PALETTE = {
  server: '\u001b[36m', // cyan
  client: '\u001b[35m', // magenta
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
};

const TARGETS = [
  { name: 'server', dir: join(ROOT, 'server'), label: 'API   :4000' },
  { name: 'client', dir: join(ROOT, 'client'), label: 'WEB   :5173' },
];

/** Refuse to start with a clear message instead of a wall of npm noise. */
for (const target of TARGETS) {
  if (!existsSync(join(target.dir, 'node_modules'))) {
    console.error(
      `\n${PALETTE.bold}Missing dependencies in ${target.name}/${PALETTE.reset}\n` +
        `  Run:  npm run install:all\n`,
    );
    process.exit(1);
  }
  if (!existsSync(join(target.dir, '.env')) && target.name === 'server') {
    console.warn(
      `${PALETTE.dim}server/.env not found — running on built-in defaults ` +
        `(memory store, no MongoDB required).${PALETTE.reset}\n`,
    );
  }
}

console.log(
  `\n${PALETTE.bold}CIDRTM${PALETTE.reset} ${PALETTE.dim}· starting API + dashboard${PALETTE.reset}\n`,
);

const children = [];

function launch(target) {
  const child = spawn(npm, ['run', 'dev'], {
    cwd: target.dir,
    shell: isWindows,
    env: { ...process.env, FORCE_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `${PALETTE[target.name]}${target.name.padEnd(6)}${PALETTE.reset}`;

  const pipe = (stream) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) console.log(`${prefix} ${PALETTE.dim}│${PALETTE.reset} ${line}`);
      }
    });
  };

  pipe(child.stdout);
  pipe(child.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(
      `\n${prefix} exited ${signal ? `via ${signal}` : `with code ${code}`}. Shutting the stack down.`,
    );
    shutdown(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(`${prefix} failed to spawn: ${error.message}`);
    shutdown(1);
  });

  children.push(child);
}

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  setTimeout(() => process.exit(code), 600);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

for (const target of TARGETS) launch(target);
