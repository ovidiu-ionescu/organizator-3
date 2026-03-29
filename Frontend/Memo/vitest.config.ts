import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      // The "instances" array is now mandatory
      instances: [
        { 
          browser: 'firefox', // You can also use 'chromium', 'firefox' or 'webkit'
          // You can put instance-specific config here
        },
      ],
      // This makes the browser visible while you develop
      headless: false, 
    },
  },
});

