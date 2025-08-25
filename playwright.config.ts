import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['html']
  ],
  use: {
    baseURL: 'http://testphp.vulnweb.com',
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*login-setup\.spec\.ts/,
    },
    {
      name: 'tests',
      dependencies: ['setup'],
      use: {
        storageState: 'storageState.json',
      },
    },
  ],
});
