import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    define: {
        __BUILD_DATE__: JSON.stringify(new Date().toLocaleString()),
    },
    // Configures the development server
    server: {
        open: '/memo/', // Automatically opens this page in your browser on npm run dev
        proxy: {
            '/organizator/login': {
                target: 'http://localhost:8080',
                changeOrigin: true,
                secure: false,
                rewrite: (path) => path.replace(/^\/organizator/, '')
            },
            '/organizator/': {
                target: 'http://localhost:8082',
                changeOrigin: true,
                secure: false,
                rewrite: (path) => path.replace(/^\/organizator/, '')
            },
            '/files/': {
                target: 'https://pillow.organizator.ro',
                changeOrigin: true,
                secure: false,
                //rewrite: (path) => path.replace(/^\/files/, '')
            }
        },
    },
    // Configures the production bundler
    build: {
        rollupOptions: {
            input: {
                memo: resolve(__dirname, 'build/main/memo.html'),
                login: resolve(__dirname, `build/main/login.html`),
                logout: resolve(__dirname, `build/main/logout.html`),
            },
        },
    },
    plugins: [
        {
            name: 'dev-clean-urls',
            configureServer(server) {
                server.middlewares.use((req, res, next) => {
                    const url = req.url?.split('?')[0];
                    if(url?.startsWith('/memo/')) {
                        req.url = '/build/main/memo.html';
                    }
                    if(url === '/login.html') {
                        req.url = '/build/main/login.html';
                    }
                    if(url === '/logout.html') {
                        req.url = '/build/main/logout.html';
                    }

                    next();
                });
            }
        }
    ],
});