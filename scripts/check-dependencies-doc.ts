// Fails if docs/dependencies.md and the workspace's package.json files disagree.
// Every dependency must be documented, and every documented package must still be installed.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const manifests = [
  'package.json',
  ...['apps', 'packages'].flatMap((dir) =>
    readdirSync(join(root, dir))
      .map((name) => join(dir, name, 'package.json'))
      .filter((path) => existsSync(join(root, path))),
  ),
];

const installed = new Map<string, string[]>();
for (const path of manifests) {
  const pkg = JSON.parse(readFileSync(join(root, path), 'utf8'));
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    installed.set(name, [...(installed.get(name) ?? []), path]);
  }
}

// A documented package is a backticked name in the first column of a table row.
const doc = readFileSync(join(root, 'docs/dependencies.md'), 'utf8');
const documented = new Set([...doc.matchAll(/^\|\s*`([^`]+)`/gm)].map((match) => match[1]!));

const missing = [...installed.keys()].filter((name) => !documented.has(name));
const stale = [...documented].filter((name) => !installed.has(name));

for (const name of missing) {
  console.error(`✗ ${name} (${installed.get(name)!.join(', ')}) is not in docs/dependencies.md`);
}
for (const name of stale) {
  console.error(`✗ ${name} is in docs/dependencies.md but no package.json depends on it`);
}
if (missing.length || stale.length) {
  console.error('\nUpdate docs/dependencies.md: purpose, alternative, and why this one won.');
  process.exit(1);
}
console.log(`✓ All ${installed.size} dependencies are documented in docs/dependencies.md`);
