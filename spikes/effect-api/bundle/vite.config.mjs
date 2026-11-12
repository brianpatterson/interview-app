export default {
  logLevel: 'error',
  build: {
    outDir: 'bundle/dist', emptyOutDir: true, minify: true,
    lib: { entry: { 'effect-client': 'bundle/effect-client.ts', 'zod-contract': 'bundle/zod-contract.ts', 'schema-only': 'bundle/schema-only.ts' }, formats: ['es'] },
  },
};
