import { defineConfig } from 'vite';
import { resolve } from 'path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';
import { PWA_EXTRA_PRECACHE, PWA_NAVIGATION_DENYLIST } from './src/main/dom/pwa_routes';

/// The pages Vite emits. It writes them under build/main because that is where its inputs are,
/// and the deployed site is flat (see deb-links/): modifyURLPrefix below is the mapping between
/// the two, and this list is what has to have a deb-links entry for the mapping to mean anything.
const html_pages = {
    memo: resolve(__dirname, 'build/main/memo.html'),
    login: resolve(__dirname, 'build/main/login.html'),
    logout: resolve(__dirname, 'build/main/logout.html'),
    password: resolve(__dirname, 'build/main/password.html'),
};

/// A URL the worker precaches but the deploy does not have is a worker that never installs: it
/// fetches its whole precache manifest at install and rejects the install if any of it 404s. A
/// worker that never installs is no offline support at all, announced by nothing but a line in
/// the browser's console — so the build stops here instead. deb-links/ is the whole of the
/// deployed tree, so it is the thing to ask.
const deployed_path = (url: string) => {
    const entry = url.replace(/^\//, '');
    const link = resolve(__dirname, 'deb-links', entry);
    if (!existsSync(link)) {
        throw new Error(
            `${url} is precached by the service worker, but deb-links/${entry} does not exist, ` +
            `so the deployed site would not have it. Add an entry under deb-links/ or take the ` +
            `URL out of src/main/dom/pwa_routes.ts.`
        );
    }
    return link;
};

/// Workbox refetches a precached URL when its revision changes and leaves it alone when it does
/// not, so the revision has to follow the bytes. These files are not Vite's output, so nothing
/// else can tell the worker when they changed; the file deb-links/ points at is the one the
/// deploy copies, and hashing it is the same answer the build gives for Vite's own output.
const precache_entry = (url: string) => ({
    url,
    revision: createHash('md5').update(readFileSync(deployed_path(url))).digest('hex'),
});

/// The four pages are precached by the build that writes them, so they can only be checked once
/// it has run: at config load there is nothing under dist/ on a clean tree.
const assert_pages_are_deployable = {
    name: 'assert-precached-pages-are-deployable',
    apply: 'build' as const,
    closeBundle() {
        Object.keys(html_pages).forEach((page) => deployed_path(`/${page}.html`));
    },
};

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
            input: html_pages,
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
                    if(url === '/password.html') {
                        req.url = '/build/main/password.html';
                    }
                    // No page links an icon, so the browser asks for /favicon.ico by default. In
                    // development that is the green tulip, so one glance at the tab says which
                    // site you are on; the deployed one stays blue. configureServer only runs for
                    // the dev server, so the build is untouched.
                    if(url === '/favicon.ico') {
                        req.url = '/favicon-green.ico';
                    }

                    next();
                });
            }
        },
        assert_pages_are_deployable,
        VitePWA({
            // A memo being edited is work that exists nowhere else, and only the reader knows
            // when it is safe to reload. The default, written out because the whole arrangement
            // turns on it: the new worker waits until the page asks for it.
            registerType: 'prompt',
            // memo.html imports virtual:pwa-register itself, so the prompt can be shown in the
            // page. Nothing is injected into the html, and no registerSW.js is emitted.
            injectRegister: false,
            // /org-manifest.json is hand-written, deployed as it is, and already linked from
            // memo.html. The plugin's own manifest would be a second one.
            manifest: false,
            // The dev server has no /sw.js, and a worker registered there would outlive the
            // session and go on serving whatever it had cached.
            devOptions: { enabled: false },
            workbox: {
                // Vite's output: the bundle, the wasm it fetches, the icons it hashes.
                globPatterns: ['**/*.{js,wasm,css,html,svg,png}'],
                // Vite's inputs are build/main/*.html, so its output keeps that path, which is
                // not a path the deployed site has. Nothing else lives under build/.
                modifyURLPrefix: { 'build/main/': '/' },
                // With the server unreachable there is nobody to answer a hard load of /memo/123,
                // /memo/new or /journal, so the app's own pages come from the precache and the
                // router takes it from there. pwa_routes.ts says which those are — and which the
                // worker must not answer, which are on this origin and inside its scope but are
                // not this app.
                navigateFallback: '/memo.html',
                navigateFallbackDenylist: PWA_NAVIGATION_DENYLIST,
                // The worker waits for the reader, but once they accept, the worker that
                // activates has to take the page over: the reload is driven by the controller
                // changing. Without this the new worker activates and the page goes on being
                // served by the old one — see
                // https://github.com/vite-pwa/vite-plugin-pwa/issues/789
                clientsClaim: true,
                // One file to deploy. Left at its default, workbox-build writes the runtime to a
                // second file named after its hash (workbox-<hash>.js) beside sw.js, and a name
                // that changes with every build cannot be pointed at from deb-links/.
                inlineWorkboxRuntime: true,
                // The files that are not Vite's output, each dated by its own bytes.
                additionalManifestEntries: PWA_EXTRA_PRECACHE.map(precache_entry),
                runtimeCaching: [
                    {
                        // Attachments, and nothing else. /organizator/* is the API: the app's own
                        // answer to an unreachable server is IndexedDB, and a cached response
                        // here would be a second, worse one that fights the merge and dirty
                        // rules.
                        //
                        // A function rather than a RegExp on purpose: workbox matches a route's
                        // regular expressions against the whole href, so /^\/files\// would
                        // never match anything. (The denylist above is the other way round —
                        // that one is matched against the pathname and search.)
                        urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/files/'),
                        handler: 'StaleWhileRevalidate',
                        method: 'GET',
                        options: {
                            cacheName: 'organizator-files',
                            expiration: {
                                maxEntries: 200,
                                maxAgeSeconds: 30 * 24 * 60 * 60,
                                purgeOnQuotaError: true,
                            },
                            // The server answers these with 401 or 403 when the cookie is
                            // missing or stale. One of those in the cache is an attachment that
                            // never loads again.
                            cacheableResponse: { statuses: [200] },
                        },
                    },
                ],
            },
        }),
    ],
});
