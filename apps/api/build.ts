// Bundles the API into self-contained ESM files for the production image: no node_modules, no
// TypeScript at runtime. The workspace package (@roundtable/shared) and npm deps are inlined.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts', 'src/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node26',
  format: 'esm',
  sourcemap: true,
  // pg optionally requires a native driver we don't install.
  external: ['pg-native'],
  // Bundled CommonJS dependencies (fastify, pg) call require() for Node built-ins, which ESM
  // output doesn't provide, so define one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
