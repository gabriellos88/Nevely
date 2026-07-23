const { defineConfig } = require('@playwright/test');

const port = 3210;
const baseURL = `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  expect: {
    timeout: 5_000
  },
  reporter: [['line']],
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    screenshot: 'off',
    trace: 'off',
    video: 'off'
  },
  webServer: {
    command: 'node server.js',
    url: `${baseURL}/health/live`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      ...process.env,
      APP_ENV: 'test',
      NODE_ENV: 'test',
      PORT: String(port),
      ROBOTS_INDEXING: 'disabled',
      SESSION_SECRET: 'browser-test-session-secret',
      SHUTDOWN_GRACE_MS: '1000'
    }
  }
});
