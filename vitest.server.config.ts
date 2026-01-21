import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for WebSocket server integration tests
 * 
 * These tests run separately from unit tests because they:
 * - Start real server instances
 * - Use real WebSocket connections
 * - Test end-to-end server behavior
 * - May take longer to run
 * 
 * Run with: npm run test:server
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // Node environment for server tests
    include: ['test/server/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 10000, // Longer timeout for server startup/shutdown
    hookTimeout: 10000,
    // Run tests sequentially to avoid port conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
