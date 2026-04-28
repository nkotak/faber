#!/usr/bin/env node

/**
 * update-system.mjs — Disabled
 *
 * This fork has been disconnected from the upstream auto-update mechanism.
 * The CLI surface (check / apply / rollback / dismiss) is preserved as a no-op
 * so legacy callers and package.json scripts keep working without errors.
 */

const cmd = process.argv[2];

if (cmd === 'check') {
  // Always reports "up-to-date" so any silent first-message check by the agent
  // doesn't surface a phantom update prompt.
  console.log(JSON.stringify({ status: 'up-to-date', local: 'fork', remote: 'fork' }));
  process.exit(0);
}

if (cmd === 'apply' || cmd === 'rollback' || cmd === 'dismiss') {
  console.error('update-system: auto-update is disabled in this fork. No action taken.');
  process.exit(0);
}

console.error('Usage: node update-system.mjs [check|apply|rollback|dismiss]');
console.error('Note: auto-update is disabled in this fork — all subcommands are no-ops.');
process.exit(0);
