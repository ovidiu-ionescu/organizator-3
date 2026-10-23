import { describe, it, expect } from "vitest";
import memo_html from "../../src/html/memo.html?raw";
import calendar_html from "../../src/html/calendar.html?raw";
import login_html from "../../src/html/login.html?raw";
import manifest_json from "../../src/html/org-manifest.json?raw";

/// The two pages that are the app rather than a way into it. Both have to carry the same shell: the
/// theme applied before the first paint, and the four elements the service worker's bar writes into.
/// A page that loses one of them is a page that silently never says a new version is ready — which
/// is why vite.config.ts checks the same thing about the built files, and why this checks the
/// sources those files are made from.
const PAGES = [
  ["memo.html", memo_html],
  ["calendar.html", calendar_html],
] as const;

const PWA_BAR_IDS = ["pwa_bar", "pwa_bar_message", "pwa_bar_action", "pwa_bar_dismiss"];

describe("the pages that are the app", () => {
  PAGES.forEach(([name, html]) => {
    it(`${name} should apply the stored theme before it draws anything`, () => {
      // A module script would be too late — modules run after the page has been parsed — so this
      // is the classic script reading the one key both pages share.
      expect(html).to.contain('localStorage.getItem("memo_theme")');
      expect(html).to.contain('href="./themes.css"');
    });

    it(`${name} should carry the bar the service worker speaks through`, () => {
      PWA_BAR_IDS.forEach(id => expect(html, `#${id}`).to.contain(`id="${id}"`));
      expect(html).to.contain('import "./dom/pwa.js"');
    });
  });

  it("the calendar should be a page of its own, with its own component and the shared menu", () => {
    expect(calendar_html).to.contain('import "./dom/calendar-page.js"');
    expect(calendar_html).to.contain('import "./dom/app-menu.js"');
    expect(calendar_html).to.contain("<calendar-page>");
  });

  it("the calendar should register the icon its menu button is drawn with", () => {
    // The menu button's three dots are an inline <svg> that img-inline-svg fetches and puts in its
    // own shadow root. Nothing else on this page imports that element, so without this line the
    // button is a 44px square of nothing: still clickable, invisible, and — on a phone — sitting
    // over the theme control in the same corner.
    expect(calendar_html).to.contain('import "./dom/img-inline-svg.js"');
    expect(calendar_html).to.contain("<img-inline-svg");
  });

  it("the memo page should still ask for its router", () => {
    expect(memo_html).to.contain('import * as router from "./dom/memo-router.js"');
  });

  it("both should be installable as the same app", () => {
    PAGES.forEach(([, html]) => expect(html).to.contain('rel="manifest" href="/org-manifest.json"'));
  });

  it("should let the reader ask for a long-term login instead of guessing from the device", () => {
    expect(login_html).to.contain('id="long_term"');
    expect(login_html).to.contain('type="checkbox"');
    // Only a checked box changes the request; an ordinary login sends the fields it always did.
    expect(login_html).to.contain("&long_term=on");
  });

  it("should react while a login is being submitted", () => {
    // The press is immediate; the busy state says the request is out, and the line under the
    // button carries the answer.
    expect(login_html).to.contain("#submit:active");
    expect(login_html).to.contain("#submit.busy");
    expect(login_html).to.contain("submit-spin");
    expect(login_html).to.contain('aria-busy');
    expect(login_html).to.contain('id="loginStatus"');
  });

  it("should offer the calendar as a destination for a shared event", () => {
    // The share sheet is the one door a web app has into another app's "add to calendar": the
    // system's calendar-insert intent belongs to native calendar apps. The action is the page
    // that already exists, so the query parameters land in the calendar itself.
    // A file can only be shared with a multipart POST; the service worker (share-target.js)
    // is what reads the body and hands it to the calendar.
    const manifest = JSON.parse(manifest_json) as {share_target?: unknown};
    expect(manifest.share_target).to.deep.equal({
      action: "/calendar",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{name: "ics", accept: ["text/calendar", ".ics", "application/ics"]}],
      },
    });
  });
});
