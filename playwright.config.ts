import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    timezoneId: 'Asia/Tokyo',
    locale: 'ja-JP',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: 'browser-recovery.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'mobile', testIgnore: 'browser-recovery.spec.ts', use: { ...devices['Pixel 7'] } },
    {
      name: 'dev-chrome',
      testMatch: [
        'editor-lock.spec.ts',
        'browser-recovery.spec.ts',
        'learning-items.spec.ts',
        'history-stats.spec.ts',
      ],
      use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: 'http://127.0.0.1:5181' },
    },
  ],
  webServer: [
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: 'npm run dev -- --port 5181 --strictPort',
      url: 'http://127.0.0.1:5181',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
})
