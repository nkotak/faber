#!/usr/bin/env node
// bin/faber-web.mjs - CLI entry point. Launches the server and opens a browser.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import open from 'open';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, '..', 'server', 'index.mjs');
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 7433);

// Launch the server as a child so we can tear it down on SIGINT.
const proc = spawn(process.execPath, [serverEntry], {
  stdio: 'inherit',
  env: { ...process.env, HOST: host, PORT: String(port) },
});

// Wait briefly for the listener to be ready, then open browser.
await new Promise((r) => setTimeout(r, 700));
await open(`http://${host}:${port}`);

const forwardExit = () => {
  proc.kill('SIGINT');
};
process.on('SIGINT', forwardExit);
process.on('SIGTERM', forwardExit);

proc.on('exit', (code) => process.exit(code ?? 0));

// The pathToFileURL import is only here so Node flags this file as ESM.
void pathToFileURL;
