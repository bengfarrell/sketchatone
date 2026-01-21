import { defineConfig, devices } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Playwright configuration for Spectrum integration tests
 * These tests verify proper Spectrum Web Components usage and CSS token compliance
 *
 * Note: Tests are located in the spectrumizer repo. To avoid the "requiring @playwright/test
 * second time" error, the spectrumizer repo should NOT have @playwright/test installed.
 * It will use this repo's installation instead.
 */
export default defineConfig({
  testDir: resolve(__dirname, '../../spectrumizer/tests'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 60000, // 60 seconds per test

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    navigationTimeout: 30000,
    actionTimeout: 10000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--disable-crashpad',
            '--disable-crash-reporter',
            '--no-sandbox',
          ],
        },
      },
    },
  ],

  // Automatically start dev server before running tests
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 120000, // 2 minutes to start
  },
});
