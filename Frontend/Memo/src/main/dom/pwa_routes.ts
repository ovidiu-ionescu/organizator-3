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
  // Under the calendar, but not the calendar itself: it has one page and no routes below it, so
  // anything deeper is somebody else's URL and the server is the one to answer. The two slashes
  // matter — /calendar and /calendar/ are the calendar, and they are answered from the precache
  // (the file itself for the first, through workbox's clean-URL handling; the same file for the
  // second, through memo-router's bounce, which is where a miss here has to end).
  /^\/calendar\/.+/,
  // Bare /memo is not here on purpose: nginx redirects it to /memo/, which leaves this worker
  // nothing to fall back to, and its own clean-URL handling finds /memo.html for it anyway — so
  // the app answers there, and the router knows that path (see memo-router.ts).
];

/// Which query strings a precached page is still matched under. Every one of them: workbox strips
/// only utm_/fbclid by default, so a page reached as /calendar?anything would miss its own cache
/// entry, fall through to the navigation fallback above, and be answered with the memo app. Nothing
/// here is served by query string — the API is not precached at all — so there is nothing to keep
/// apart.
export const PWA_IGNORED_SEARCH_PARAMS: RegExp[] = [/.*/];

/// Files the app fetches at runtime that Vite never sees: memo-editor.ts builds its toolbars from
/// a template string, so those URLs are not in the bundle, and no build step copies them either —
/// the images directory is deployed as it is (deb-links/images). Precached, because a toolbar of
/// broken icons is not "works with the server unreachable".
///
/// The icons the pages link to are not here: Vite sees those, inlines the small ones and hashes
/// the rest into /assets, where the ordinary glob picks them up.
export const PWA_EXTRA_PRECACHE: string[] = [
  // The manifest itself is not here: the pages ask for it under a URL carrying its contents, so
  // it is fetched from the network at install time and never served from an old precache.
  // Its icons are, so an install offered while the server is unreachable has them.
  '/images/tulip-blue.svg',
  '/images/pwa-icon-192.png',
  '/images/pwa-icon-512.png',
  // The local deployment on pillow wears the green tulip, so it is told apart from the deployed
  // one on the phone. Both sets are precached so either manifest has its icons offline.
  '/images/tulip-green.svg',
  '/images/pwa-icon-green-192.png',
  '/images/pwa-icon-green-512.png',
  // memo-editor.ts, the toolbar and the edit toolbar
  '/images/vpn_key-white-48dp.svg',
  '/images/ic_lock_open_48px.svg',
  '/images/ic_lock_48px.svg',
  '/images/ic_create_48px.svg',
  '/images/share-white-48dp.svg',
  '/images/menu_book-white-48dp.svg',
  '/images/ic_today_48px.svg',
  '/images/ic_insert_comment_48px.svg',
  '/images/check_box-white-48dp.svg',
  '/images/ic_link_48px.svg',
  '/images/border_all-white-48dp.svg',
  '/images/enhanced_encryption-white-48dp.svg',
  '/images/publish-white-48dp.svg',
  '/images/save_alt-24px.svg',
  // password.ts, the two buttons of the password dialog
  '/images/ic_clear_48px.svg',
  '/images/ic_done_48px.svg',
  // memo.html, the menu button in the corner
  '/images/more_vert.svg',
  // memo-editor.ts, the button that inserts a link to where the reader is
  '/images/ic_place_48px.svg',
];
