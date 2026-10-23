/*
 * The POST body of an event shared into the app.
 *
 * A shared .ics file, and the system's POST body in general, never reach the page: the worker
 * takes the request the share target points here, keeps what it can read in a Cache, and
 * redirects to the calendar, which reads it and opens its insert form. The other two parts are
 * the share_target in org-manifest.json and shared_event.ts.
 *
 * This file is imported by the generated worker (workbox.importScripts in vite.config.ts), so it
 * is served at /share-target.js and deployed through deb-links.
 */
const SHARE_CACHE = "organizator-share";
const SHARE_INBOX = "/share-target/inbox";
const SHARE_PAGE = "/calendar";

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "POST" ||
    url.origin !== self.location.origin ||
    url.pathname !== SHARE_PAGE
  ) {
    return;
  }
  // Synchronously, as a fetch listener must: the work is done in the promise it is given.
  event.respondWith(take_share(event.request));
});

const take_share = async request => {
  try {
    const form = await request.formData();
    const field = name => {
      const value = form.get(name);
      return typeof value === "string" && value !== "" ? value : null;
    };

    // The file the manifest accepts, whichever way the sharing app labelled it. Only text/
    // calendar is read as a calendar; a plain string field of the same name is not a file.
    let ics = null;
    for (const value of form.getAll("ics")) {
      if (typeof value === "string") continue;
      const name = (value.name || "").toLowerCase();
      const type = (value.type || "").toLowerCase();
      if (type === "text/calendar" || type === "application/ics" || name.endsWith(".ics")) {
        ics = await value.text();
        break;
      }
    }

    const cache = await caches.open(SHARE_CACHE);
    await cache.put(
      SHARE_INBOX,
      new Response(JSON.stringify({title: field("title"), text: field("text"), url: field("url"), ics}), {
        headers: {"Content-Type": "application/json"},
      })
    );
  } catch (e) {
    // A body that cannot be read still lands on the calendar. There is nothing to retry: the
    // system will not send the share again.
  }
  return Response.redirect(new URL(`${SHARE_PAGE}?share-target=1`, self.location.origin), 303);
};
