/**
 * @prettier
 *
 * What the service worker owns, and what it must keep its hands off.
 *
 * The worker is served from the site root (/sw.js), so its scope is the whole of
 * organizator.ro — which is more than this application. Kept out of vite.config.ts so that a
 * test can hold these against the URLs the app actually navigates to.
 */

/// Pages the app answers itself. A hard load of any of them is a memo.html on the server
/// (`location /memo/ { try_files /memo.html =404; }`), so with the server unreachable the worker
/// answers them from the precache and the router in memo-router.ts takes over from there.
///
/// Workbox matches these against the pathname and search of the navigation, so they are anchored
/// at the path. (The runtime route for /files/ below is matched the other way round — against the
/// whole href — which is why it is a function and not one of these.)
export const PWA_NAVIGATION_DENYLIST: RegExp[] = [
  // The administration app, on the same origin: its own pages, not this app's.
  /^\/user[/-]admin\//,
  // The API. Never a page; the app falls back to IndexedDB on its own.
  /^\/organizator\//,
  // Attachments. A memo can link to one, and following the link is a navigation — it must reach
  // the server (or fail), not turn into the memo shell.
  /^\/files\//,
  /^\/file_auth/,
  // The other pages of the site: they are about the server, and none of them is the app.
  /^\/(login|logout|password)\.html/,
  // Nothing here is the app either. Serving memo.html at / would leave every section on screen
  // and the router with no route to activate.
  /^\/$/,
  // Bare /memo is not here on purpose: nginx redirects it to /memo/, which leaves this worker
  // nothing to fall back to, and its own clean-URL handling finds /memo.html for it anyway — so
  // the app answers there, and the router knows that path (see memo-router.ts).
];

/// Files the app fetches at runtime that Vite never sees: memo-editor.ts builds its toolbars from
/// a template string, so those URLs are not in the bundle, and no build step copies them either —
/// the images directory is deployed as it is (deb-links/images). Precached, because a toolbar of
/// broken icons is not "works with the server unreachable".
///
/// The icons the pages link to are not here: Vite sees those, inlines the small ones and hashes
/// the rest into /assets, where the ordinary glob picks them up.
export const PWA_EXTRA_PRECACHE: string[] = [
  '/org-manifest.json',
  // The manifest's own icons, so an install offered while the server is unreachable has them.
  '/images/tulip-blue.svg',
  '/images/pwa-icon-192.png',
  '/images/pwa-icon-512.png',
  // memo-editor.ts, the toolbar and the edit toolbar
  '/images/vpn_key-white-48dp.svg',
  '/images/ic_lock_open_48px.svg',
  '/images/ic_lock_48px.svg',
  '/images/ic_create_48px.svg',
  '/images/share-white-48dp.svg',
  '/images/menu_book-white-48dp.svg',
  '/images/ic_today_48px.svg',
  '/images/check_box-white-48dp.svg',
  '/images/ic_link_48px.svg',
  '/images/border_all-white-48dp.svg',
  '/images/enhanced_encryption-white-48dp.svg',
  '/images/publish-white-48dp.svg',
  '/images/save_alt-24px.svg',
  // password.ts, the two buttons of the password dialog
  '/images/ic_clear_48px.svg',
  '/images/ic_done_48px.svg',
];
