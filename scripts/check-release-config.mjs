import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function text(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

const railway = JSON.parse(await text('railway.json'));
const packageJson = JSON.parse(await text('package.json'));
const workflow = await text('.github/workflows/ci.yml');
const playwright = await text('playwright.config.js');
const environmentExample = await text('.env.example');

assert.equal(railway.deploy.healthcheckPath, '/health/ready');
assert.ok(Number(railway.deploy.healthcheckTimeout) > 0);
assert.ok(Number(railway.deploy.overlapSeconds) > 0);
assert.ok(Number(railway.deploy.drainingSeconds) >= 30);
assert.ok(railway.deploy.preDeployCommand.includes('npm run db:migrate'));
assert.equal(railway.deploy.startCommand, 'npm start');

for (const script of [
  'check',
  'db:migrate',
  'test:server',
  'test:browser'
]) {
  assert.ok(packageJson.scripts[script], `Missing package script required by CI: ${script}`);
}

for (const requiredWorkflowFragment of [
  'permissions:',
  'contents: read',
  'postgres:17-alpine',
  'npm ci',
  'npm run db:migrate',
  'npm run check',
  'npm run test:server',
  'npm run test:browser'
]) {
  assert.ok(
    workflow.includes(requiredWorkflowFragment),
    `CI workflow is missing: ${requiredWorkflowFragment}`
  );
}
assert.equal(workflow.includes('${{ secrets.'), false, 'CI must not load deployment secrets');

for (const privacySetting of [
  "screenshot: 'off'",
  "trace: 'off'",
  "video: 'off'"
]) {
  assert.ok(playwright.includes(privacySetting), `Browser tests must retain ${privacySetting}`);
}

assert.match(environmentExample, /ANALYTICS_MODE=disabled/);
assert.match(environmentExample, /ROBOTS_INDEXING=disabled/);
assert.equal(
  /RESEND_API_KEY=re_[A-Za-z0-9]{10,}/.test(environmentExample),
  false,
  '.env.example must not contain a Resend credential'
);

console.log('Release configuration check passed for CI, Railway and privacy-safe browser artifacts.');
