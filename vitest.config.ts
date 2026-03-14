import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'site/node_modules/react'),
      'react-dom': path.resolve(__dirname, 'site/node_modules/react-dom'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [
      ...(parseInt(process.versions.node.split('.')[0], 10) < 20
        ? ['tests/unit/architecture-flow.test.ts']
        : []),
    ],
    environmentMatchGlobs: [
      ['tests/unit/architecture-flow.test.ts', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
    testTimeout: 15000,
  },
});
