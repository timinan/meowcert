import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    // None of the tests in `tests/` touch the DOM — they cover pure logic
    // and fetch-mocked service wrappers — so we run them in the node
    // environment. This sidesteps a jsdom transitive-dep crash where
    // `html-encoding-sniffer@6` `require()`s `@exodus/bytes`'s ESM-only
    // encoding-lite.js. Switch back to `jsdom` only if a test needs it.
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/client'),
    },
  },
});
