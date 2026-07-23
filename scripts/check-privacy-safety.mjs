import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.codex', '.git', 'node_modules', 'test', 'vendor']);
const allowedConsoleFiles = new Set([
  'lib/safe-log.js',
  'scripts/check-privacy-safety.mjs',
  'scripts/check-ui-baseline.mjs',
  'scripts/generate-guest-avatars.mjs',
  'scripts/migrate.js',
  'scripts/validate-environment.mjs',
  'scripts/verify-recovery.mjs'
]);
const sensitiveNames = [
  'password',
  'token',
  'email',
  'guestid',
  'guest_id',
  'userid',
  'user_id',
  'accountid',
  'account_id',
  'message',
  'chat',
  'topic',
  'details',
  'payload',
  'request.body',
  'req.body',
  'error.message',
  'error.stack'
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const violations = [];
for (const filePath of await walk(root)) {
  const relativePath = path.relative(root, filePath).replaceAll('\\', '/');
  const source = await readFile(filePath, 'utf8');
  const lowered = source.toLowerCase();

  if (!allowedConsoleFiles.has(relativePath)) {
    source.split(/\r?\n/).forEach((line, index) => {
      if (!/console\.(?:log|warn|error|info|debug)\s*\(/.test(line)) return;
      const unsafe = sensitiveNames.some((name) => line.toLowerCase().includes(name));
      if (unsafe || /\bconsole\.(?:warn|error)\s*\(\s*error\s*\)/.test(line)) {
        violations.push(`${relativePath}:${index + 1} may log sensitive or raw error data`);
      }
    });
  }

  if (/\b(?:gtag|dataLayer\.push)\s*\(/.test(source)) {
    for (const name of sensitiveNames) {
      if (lowered.includes(name)) {
        violations.push(`${relativePath} analytics code contains forbidden field name "${name}"`);
      }
    }
  }
}

assert.deepEqual(violations, [], `Privacy-safety check failed:\n${violations.join('\n')}`);
console.log('Privacy-safety check passed without inspecting or printing runtime user data.');
