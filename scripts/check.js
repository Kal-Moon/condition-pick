import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
const files = [manifest.background.service_worker, manifest.action.default_popup,
  ...manifest.content_scripts.flatMap(entry => entry.js),
  ...manifest.web_accessible_resources.flatMap(entry => entry.resources)];
for (const file of files) {
  if (!existsSync('extension/' + file)) throw new Error('Missing manifest resource: ' + file);
}
for (const file of readdirSync('extension').filter(file => file.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', 'extension/' + file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
console.log('Manifest resources and extension script syntax checked.');
