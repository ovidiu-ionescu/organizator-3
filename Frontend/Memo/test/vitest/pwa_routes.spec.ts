import { describe, it, expect } from "vitest";
import { PWA_IGNORED_SEARCH_PARAMS, PWA_NAVIGATION_DENYLIST } from "@dom/pwa_routes.js";

// The worker is served from /sw.js, so its scope is the whole of organizator.ro — more than this
// application. Every navigation inside that scope that is not one of the app's own pages has to
// be named here, or an offline load of it comes back as the memo shell instead of an error. None
// of this depends on the browser, so it is the cheapest of the service worker's parts to hold
// still.
//
// Workbox matches these against the pathname and the search, never the host or the fragment.

const denied = (path: string): boolean =>
  PWA_NAVIGATION_DENYLIST.some((pattern) => pattern.test(path));

describe("The service worker's navigation denylist", () => {
  it("should let the app answer its own pages", () => {
    // What nginx serves with try_files /memo.html, which is what the worker has to stand in for.
    expect(denied("/memo/")).to.be.false;
    expect(denied("/memo/123")).to.be.false;
    expect(denied("/memo/new")).to.be.false;
    expect(denied("/memo/$$$admin")).to.be.false;
    expect(denied("/memo/search?criteria=something")).to.be.false;
    expect(denied("/journal")).to.be.false;
    // The bare one too: the worker's own clean-URL handling turns it into the precached
    // /memo.html before the fallback is consulted, and the router knows the path.
    expect(denied("/memo")).to.be.false;
  });

  it("should keep out of the other application on this origin", () => {
    // The Angular admin app is installed beside the memo app and served from the same host. A
    // worker at /sw.js answers navigations for all of it, so without this an offline load of the
    // admin app would be handed the memo page.
    expect(denied("/user-admin/")).to.be.true;
    expect(denied("/user-admin/index.html")).to.be.true;
    expect(denied("/user/admin/")).to.be.true;
  });

  it("should keep out of the API and of the files it hands out", () => {
    expect(denied("/organizator/memo/1")).to.be.true;
    expect(denied("/organizator/memogroups")).to.be.true;
    // Following an attachment is a navigation, and it must reach the server or fail: the memo
    // shell is not a pdf.
    expect(denied("/files/some/attachment.pdf")).to.be.true;
    expect(denied("/file_auth?file=1")).to.be.true;
  });

  it("should keep out of the pages that belong to the server", () => {
    expect(denied("/login.html")).to.be.true;
    expect(denied("/login.html?r=%2Fmemo%2F1")).to.be.true;
    expect(denied("/logout.html")).to.be.true;
    expect(denied("/password.html")).to.be.true;
  });

  it("should not answer for where the app is not", () => {
    // Nothing to serve at the root: the sections are shown by the router, which has no route
    // for /.
    expect(denied("/")).to.be.true;
  });

  it("should answer for the calendar, at its own two addresses", () => {
    // Both are the calendar: /calendar is the precached page through the worker's clean-URL
    // handling, and /calendar/ is the same page through the bounce in memo-router — so neither may
    // be denied, or the reader opening the app where they left it gets the memo list.
    expect(denied("/calendar")).to.be.false;
    expect(denied("/calendar/")).to.be.false;
    expect(denied("/calendar.html")).to.be.false;
  });

  it("should keep out from under the calendar, which has no routes of its own", () => {
    // One page and nothing below it: anything deeper is somebody else's URL, and the server is the
    // one to answer it. The two slashes are what tells this apart from /calendar/ itself — a
    // sloppier pattern would take the directory form with it and leave the calendar unanswered.
    expect(denied("/calendar/whatever")).to.be.true;
    expect(denied("/calendar/2026/10/16")).to.be.true;
  });

  it("should match a precached page whatever is on the query string", () => {
    // Workbox strips only utm_/fbclid by default, and /calendar?anything would then miss its own
    // cache entry and be answered by the navigation fallback — the memo app.
    const ignored = PWA_IGNORED_SEARCH_PARAMS;
    expect(ignored.length).to.be.greaterThan(0);
    ["?x=1", "?from=1&until=2", "?utm_source=news", ""].forEach(query =>
      expect(ignored.some(pattern => pattern.test(query)), query).to.be.true
    );
  });
});
