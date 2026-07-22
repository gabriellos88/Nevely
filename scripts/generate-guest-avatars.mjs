import { Avatar } from '@dicebear/core';
import thumbs from '@dicebear/styles/thumbs.json' with { type: 'json' };
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const outputDirectory = resolve(projectRoot, 'public', 'vendor', 'dicebear-presets-10.2.0');
const presets = [
  { id: 'astra', seed: 'Nevely Astra' },
  { id: 'nova', seed: 'Nevely Nova' },
  { id: 'lyra', seed: 'Nevely Lyra' },
  { id: 'vega', seed: 'Nevely Vega' },
  { id: 'sol', seed: 'Nevely Sol' },
  { id: 'mira', seed: 'Nevely Mira' },
  { id: 'orion', seed: 'Nevely Orion' },
  { id: 'elara', seed: 'Nevely Elara' }
];

await mkdir(outputDirectory, { recursive: true });

for (const preset of presets) {
  const avatar = new Avatar(thumbs, {
    seed: preset.seed,
    size: 128
  });
  await writeFile(resolve(outputDirectory, `${preset.id}.svg`), avatar.toString(), 'utf8');
}

await writeFile(
  resolve(outputDirectory, 'presets.json'),
  `${JSON.stringify(presets.map(({ id }) => ({ id, src: `/vendor/dicebear-presets-10.2.0/${id}.svg` })), null, 2)}\n`,
  'utf8'
);

await copyFile(
  resolve(projectRoot, 'node_modules', '@dicebear', 'core', 'LICENSE'),
  resolve(outputDirectory, 'LICENSE-DICEBEAR-CORE.txt')
);
await copyFile(
  resolve(projectRoot, 'node_modules', '@dicebear', 'styles', 'LICENSE.md'),
  resolve(outputDirectory, 'LICENSE-DICEBEAR-STYLES.md')
);

console.log(`Generated ${presets.length} self-hosted guest avatars in ${outputDirectory}`);
