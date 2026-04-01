import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

const wasmMimePlugin = {
  name: 'wasm-mime-fix',
  configureServer(server: any) {
    server.middlewares.use((req: any, res:any, next:any) => {
      if (req.url?.endsWith('.wasm')) {
        res.setHeader('Content-Type', 'application/wasm');
      }
      next();
    });
  }
};

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
  assetsInclude: ['**/*.wasm'],
  plugins: [wasmMimePlugin],
  server: {
    fs: {
      allow: ['..']
    }
  },
  resolve: {
    alias: {
      '@wasm': new URL('../organizator-wasm/pkg', import.meta.url).pathname,
      '@dom': new URL('src/main/dom', import.meta.url).pathname,
    },
  },
});
