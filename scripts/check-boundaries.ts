// Fails if an import crosses a module boundary it shouldn't (ADR-0023):
//   1. Another module is imported only through its index.ts.
//   2. Modules never import the assembly: server.ts and main.ts (API) or shell/ (web).
//   3. platform/, shared/ and design-system/ never import from modules/ (their tests may).
//   4. An API module never imports another module's tables, except in its own schema.ts (a
//      foreign key).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const sources = ['apps/api/src', 'apps/api/test', 'apps/web/src'];
const isSource = (path: string) => /\.tsx?$/.test(path) && !path.endsWith('.d.ts');
const isTest = (path: string) => /\.test\.tsx?$/.test(path) || path.startsWith('apps/api/test/');

function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(join(root, path)).isDirectory()) return walk(path);

    return isSource(path) ? [path] : [];
  });
}

/** `apps/api/src/modules/email/mailer.ts` → `apps/api/src/modules/email`, or undefined. */
function moduleOf(path: string): string | undefined {
  return /^(apps\/\w+\/src\/modules\/[\w-]+)\//.exec(path)?.[1];
}

function isAssembly(path: string): boolean {
  return (
    ['apps/api/src/server.ts', 'apps/api/src/main.ts'].includes(path) ||
    path.startsWith('apps/web/src/shell/')
  );
}

function isFoundation(path: string): boolean {
  return /^apps\/\w+\/src\/(platform|shared|design-system)\//.test(path);
}

/** Resolves a relative specifier the way TypeScript does: `./x.js` may be `./x.ts`. */
function resolve(from: string, specifier: string): string | undefined {
  const base = join(dirname(from), specifier.replace(/\.js$/, ''));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];

  return candidates.find((path) => existsSync(join(root, path)) && isSource(path));
}

const importPattern = /(?:import|export)\s+(?:type\s+)?(?:\{([^}]*)\}|[^'"]*?)\s*from\s+'([^']+)'/g;

/** Every API module's table and enum names, by module: what rule 4 protects. */
const tablesByModule = new Map<string, Set<string>>();

for (const dir of readdirSync(join(root, 'apps/api/src/modules'))) {
  const schema = join('apps/api/src/modules', dir, 'schema.ts');

  if (!existsSync(join(root, schema))) continue;
  const text = readFileSync(join(root, schema), 'utf8');
  const names = [...text.matchAll(/export const (\w+) = pg(?:Table|Enum)\(/g)].map((m) => m[1]!);

  tablesByModule.set(dirname(schema), new Set(names));
}

const problems: string[] = [];

for (const file of sources.flatMap(walk)) {
  const fromModule = moduleOf(file);
  const text = readFileSync(join(root, file), 'utf8');

  for (const [, names = '', specifier = ''] of text.matchAll(importPattern)) {
    if (!specifier.startsWith('.')) continue;
    const target = resolve(file, specifier);

    if (!target) continue;
    const toModule = moduleOf(target);
    const where = `${file}: imports ${specifier}`;

    if (toModule && toModule !== fromModule && !/^index\.tsx?$/.test(relative(toModule, target)))
      problems.push(`${where} (another module's internals; import its index.ts)`);

    if (fromModule && isAssembly(target))
      problems.push(`${where} (a module importing the assembly)`);

    if (toModule && isFoundation(file) && !isTest(file))
      problems.push(`${where} (platform, shared and design-system never import modules)`);

    const tables = toModule ? tablesByModule.get(toModule) : undefined;
    const imported = names.split(',').map((name) => name.replace(/^\s*type\s+/, '').trim());
    const foreign = imported.filter((name) => tables?.has(name));

    if (
      fromModule &&
      toModule !== fromModule &&
      foreign.length > 0 &&
      !file.endsWith('/schema.ts') &&
      !isTest(file)
    )
      problems.push(`${where} (another module's tables: ${foreign.join(', ')})`);
  }
}

for (const problem of problems) console.error(`✗ ${problem}`);

if (problems.length > 0) {
  console.error('\nModule boundaries: see docs/adr/0023-modular-monolith-layout.md');
  process.exit(1);
}

console.log('✓ Module boundaries hold');
