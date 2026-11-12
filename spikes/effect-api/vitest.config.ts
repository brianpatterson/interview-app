import { defineConfig } from 'vitest/config';

// Test files share the app_test database and truncate it, so they can't run in parallel.
export default defineConfig({ test: { fileParallelism: false } });
