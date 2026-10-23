import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';
import {
    PWA_EXTRA_PRECACHE,
    PWA_IGNORED_SEARCH_PARAMS,
    PWA_NAVIGATION_DENYLIST,
} from './src/main/dom/pwa_routes.ts';

// This file is ESM (package.json says "type": "module", so the native config loader reads it
// as such), and ESM has no __dirname of its own.
const __dirname = fileURLToPath(new URL('.', import.meta.url));

/// The pages Vite emits. It writes them under build/main because that is where its inputs are,
/// and the deployed site is flat (see deb-links/): modifyURLPrefix below is the mapping between
/// the two, and this list is what has to have a deb-links entry for the mapping to mean anything.
const html_pages = {
    memo: resolve(__dirname, 'build/main/memo.html'),
    calendar: resolve(__dirname, 'build/main/calendar.html'),
    login: resolve(__dirname, 'build/main/login.html'),
    logout: resolve(__dirname, 'build/main/logout.html'),
    password: resolve(__dirname, 'build/main/password.html'),
};

/// The manifest's address carries its contents. A build whose manifest changed asks for a
/// different URL, so neither the browser's HTTP cache nor an installed WebAPK can go on using
/// the previous icons — which is exactly what an Android reinstall kept doing after the local
/// deployment turned the tulip green.
const manifest_version = createHash('md5')
    .update(readFileSync(resolve(__dirname, 'src/html/org-manifest.json')))
    .digest('hex')
    .slice(0, 8);

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

/// The pages are precached by the build that writes them, so they can only be checked once it has
/// run: at config load there is nothing under dist/ on a clean tree.
const assert_pages_are_deployable = {
    name: 'assert-precached-pages-are-deployable',
    apply: 'build' as const,
    closeBundle() {
        Object.keys(html_pages).forEach((page) => deployed_path(`/${page}.html`));
    },
};

/// The two pages that are the app rather than a way into it, and so have to carry the whole shell:
/// the pre-paint theme script, and the four elements the service worker's bar writes into. A page
/// that loses one of them is a page that silently never says a new version is ready, which is the
/// kind of thing only a build check catches.
const APP_PAGES = ['memo', 'calendar'];
const THEME_BOOTSTRAP = 'localStorage.getItem("memo_theme")';
const PWA_BAR_IDS = ['pwa_bar', 'pwa_bar_message', 'pwa_bar_action', 'pwa_bar_dismiss'];

const assert_pages_carry_the_app_shell = {
    name: 'assert-pages-carry-the-app-shell',
    apply: 'build' as const,
    closeBundle() {
        APP_PAGES.forEach((page) => {
            const html = readFileSync(deployed_path(`/${page}.html`), 'utf8');
            if (!html.includes(THEME_BOOTSTRAP)) {
                throw new Error(`build/main/${page}.html has no pre-paint theme script.`);
            }
            PWA_BAR_IDS.forEach((id) => {
                if (!html.includes(`id="${id}"`)) {
                    throw new Error(
                        `build/main/${page}.html has no #${id}: the service worker's bar lives in ` +
                        `the page, so without it this page is never told a new version is ready.`
                    );
                }
            });
        });
    },
};

/// What "the wasm is cached once" means, checked rather than hoped for.
///
/// It is checked at its source rather than in dist/sw.js, because the worker is generated after
/// these hooks have run and a build that waited for it there would be waiting for itself. What the
/// manifest holds is exactly what this checks: every page Vite emitted (globPatterns takes every
/// html) and every wasm the bundle produced, so one asset is one entry — a second copy of the
/// module is a megabyte fetched and stored twice, which is what the calendar had while it lived in
/// the Angular app with a package of its own under /user-admin/pkg.
const assert_the_wasm_is_emitted_once = {
    name: 'assert-the-wasm-is-emitted-once',
    apply: 'build' as const,
    closeBundle() {
        const emitted = readdirSync(resolve(__dirname, 'dist/assets')).filter((name) =>
            name.endsWith('.wasm')
        );
        if (emitted.length !== 1) {
            throw new Error(
                `the build emitted ${emitted.length} wasm files (${emitted.join(', ')}), and the ` +
                    `point of one module is that it is stored once.`
            );
        }
        APP_PAGES.forEach((page) => {
            deployed_path(`/${page}.html`);
            if (!existsSync(resolve(__dirname, 'dist/build/main', `${page}.html`))) {
                throw new Error(
                    `dist/build/main/${page}.html was not emitted, so the worker would precache a ` +
                        `site without it.`
                );
            }
        });
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
            // Signing out is the identity service's too, and for the same reason: it is the one
            // that set the cookie. This mirrors the nginx rule the deployed site needs.
            '/organizator/logout': {
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
            // The manifest is fetched by the browser when the app is installed or updated; a new
            // URL for new contents is what makes Android look at the icons again.
            name: 'version-the-manifest',
            transformIndexHtml(html) {
                return html.replace(
                    'href="/org-manifest.json"',
                    `href="/org-manifest.json?v=${manifest_version}"`
                );
            },
        },
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
                    // The calendar's two URLs, exactly — not a prefix: /calendar/anything is not a
                    // route, and the worker's denylist sends it to the server for the same reason.
                    if(url === '/calendar' || url === '/calendar/' || url === '/calendar.html') {
                        req.url = '/build/main/calendar.html';
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
        assert_pages_carry_the_app_shell,
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
                // A precached page is matched by URL, and workbox strips only utm_/fbclid by
                // default: /calendar?anything would then miss its own cache entry and be answered
                // by the fallback above — the memo app. Nothing here is served by query string, so
                // all of it is ignored. pwa_routes.ts says why.
                ignoreURLParametersMatching: PWA_IGNORED_SEARCH_PARAMS,
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
                // The handler for a share target POST. A page cannot read a POST body, so the
                // worker takes it — and for an .ics file this is the only way it arrives at all.
                importScripts: ["share-target.js"],
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
        assert_the_wasm_is_emitted_once,
    ],
});
