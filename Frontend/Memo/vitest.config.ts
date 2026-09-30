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
      // The app asks for the wasm package by the path it has once deployed, because the browser
      // loads build/main/dom next to build/main/pkg and a bare specifier would mean nothing
      // there. Under test there is no build step, so that path points at nothing and every spec
      // that reaches memo_db, server_comm or memo-editor dies on the import; send it to the
      // package in the source tree instead. The import specifiers themselves stay untouched —
      // they are correct for the deployed layout and only the test needs the detour.
      '../pkg/organizator_wasm.js': new URL(
        '../organizator-wasm/pkg/organizator_wasm.js',
        import.meta.url
      ).pathname,
    },
  },
});
