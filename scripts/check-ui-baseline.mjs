import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDirectory, '..');
const viewsDirectory = path.join(root, 'views');
const publicDirectory = path.join(root, 'public');

const canonicalFiles = [
  'views/chat.ejs',
  'public/js/chat-client.js',
  'public/css/style.css'
];

const requiredFiles = [
  ...canonicalFiles,
  'views/home.ejs',
  'views/admin.ejs',
  'views/auth-stub.ejs',
  'views/partials/header.ejs',
  'views/partials/footer.ejs',
  'public/js/admin.js',
  'public/js/auth-client.js',
  'public/js/guest-profile-store.js',
  'public/js/site-shell.js',
  'public/i18n/en.json',
  'public/vendor/lucide-1.24.0.min.js'
];

const ignoredDirectories = new Set(['.codex', '.git', 'node_modules']);

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(entryPath));
    if (entry.isFile()) files.push(entryPath);
  }

  return files;
}

for (const relativePath of requiredFiles) {
  assert.equal(
    await exists(path.join(root, relativePath)),
    true,
    `Missing required UI file: ${relativePath}`
  );
}

const repositoryFiles = await walk(root);
for (const canonicalPath of canonicalFiles) {
  const basename = path.basename(canonicalPath).toLowerCase();
  const matches = repositoryFiles
    .filter((filePath) => path.basename(filePath).toLowerCase() === basename)
    .map((filePath) => path.relative(root, filePath).replaceAll('\\', '/'));

  assert.deepEqual(
    matches,
    [canonicalPath],
    `Expected one canonical ${basename}; found: ${matches.join(', ')}`
  );
}

const viewFiles = repositoryFiles.filter((filePath) => (
  filePath.startsWith(`${viewsDirectory}${path.sep}`) && filePath.endsWith('.ejs')
));

for (const viewPath of viewFiles) {
  const relativeViewPath = path.relative(root, viewPath).replaceAll('\\', '/');
  const source = await readFile(viewPath, 'utf8');

  const assetReferences = source.matchAll(
    /(?:src|href)=["'](\/(?:css|js|vendor)\/[^"'?#<%]+)(?:[?#][^"']*)?["']/g
  );
  for (const match of assetReferences) {
    const assetPath = path.join(publicDirectory, ...match[1].split('/').filter(Boolean));
    assert.equal(
      await exists(assetPath),
      true,
      `${relativeViewPath} references missing asset ${match[1]}`
    );
  }

  const includes = source.matchAll(/include\(\s*['"]([^'"]+)['"]/g);
  for (const match of includes) {
    const includeName = match[1].endsWith('.ejs') ? match[1] : `${match[1]}.ejs`;
    const candidates = [
      path.resolve(path.dirname(viewPath), includeName),
      path.resolve(viewsDirectory, includeName)
    ];
    const found = (await Promise.all(candidates.map(exists))).some(Boolean);
    assert.equal(found, true, `${relativeViewPath} includes missing view ${match[1]}`);
  }

  const ids = [...source.matchAll(/\sid=["']([^"'<>%]+)["']/g)].map((match) => match[1]);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(
    duplicateIds,
    [],
    `${relativeViewPath} contains duplicate static IDs: ${duplicateIds.join(', ')}`
  );
}

const serverSources = repositoryFiles.filter((filePath) => (
  (path.dirname(filePath) === root || filePath.startsWith(`${path.join(root, 'lib')}${path.sep}`))
  && filePath.endsWith('.js')
));

for (const serverSourcePath of serverSources) {
  const source = await readFile(serverSourcePath, 'utf8');
  const renderTargets = source.matchAll(/\.render\(\s*['"]([^'"]+)['"]/g);
  for (const match of renderTargets) {
    assert.equal(
      await exists(path.join(viewsDirectory, `${match[1]}.ejs`)),
      true,
      `${path.relative(root, serverSourcePath)} renders missing view ${match[1]}`
    );
  }
}

const copy = JSON.parse(await readFile(path.join(publicDirectory, 'i18n', 'en.json'), 'utf8'));
for (const section of ['common', 'pageTitles', 'errors', 'chat', 'account', 'admin']) {
  assert.ok(copy[section], `Browser copy is missing top-level section "${section}"`);
}

console.log(`UI baseline passed: ${viewFiles.length} views and ${requiredFiles.length} required files checked.`);
