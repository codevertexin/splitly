import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 60_000,

  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL,
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'e2e-desktop',
      testDir: './tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
      {
        name: 'demo-mobile',
        testDir: './tests/demo',
        workers: 1,
        use: {
          ...devices['iPhone 13'],
          viewport: { width: 390, height: 844 },
          video: { mode: 'on', size: { width: 390, height: 844 } },
          trace: 'on',
          screenshot: 'on',
        },
      }
  ],

  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
});