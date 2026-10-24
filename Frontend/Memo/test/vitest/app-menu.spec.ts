import { describe, it, expect, afterEach, vi } from "vitest";
import { open_app_menu, set_app_entries } from "@dom/app-menu.js";
import { memo_menu_entries } from "@dom/memo_menu.js";
import { raspandac } from "@dom/events.js";
import * as db from "@dom/memo_db.js";

// The menu behind the three dots: taking every memo onto this device, and signing out. The dialog
// is built in the page rather than in the browser's own box, so what it offers and what its entries
// do are checked the same way as anything else.
//
// Which entries the menu holds is the page's to say, so the memo app's list is registered by
// importing its own module — the same way memo.html gets it. The dialog itself knows only the two
// screens beside the app and signing out, which is what a page that registers nothing gets.
//
// Signing out is not here: it ends by sending the page to the login screen, which would take the
// test run with it. The stub server in this file answers the caching runs.

const real_fetch = globalThis.fetch;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

const requester = { id: 1, name: "alice" };

const memo_reply = (id: number, memotext: string) =>
  json({
    memo: { id, title: "a memo", memotext, savetime: 1, user: requester, access_level: 3 },
    requester,
  });

/// The server as the list page sees it: what it holds, and what it answers for each memo.
const stub_server = (ids: number[], memo_for: (id: number) => unknown) => {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (!target.includes("/organizator/memo/")) {
      return real_fetch(url, init);
    }
    if (target.includes("/organizator/memo/?")) {
      return json({
        memos: ids.map((id) => ({ id, title: "a memo", user_id: 1, savetime: 1 })),
        requester,
      });
    }
    return memo_for(Number(/\/organizator\/memo\/(\d+)/.exec(target)?.[1]));
  });
};

const entries = (): string[] =>
  Array.from(document.querySelectorAll(".menu-entry")).map((entry) => entry.textContent ?? "");

const progress = (): string =>
  document.querySelector("#menu_progress")?.textContent?.trim() ?? "";

const click_entry = (label: string) => {
  const entry = Array.from(document.querySelectorAll<HTMLButtonElement>(".menu-entry")).find(
    (candidate) => candidate.textContent === label
  );
  entry?.click();
};

/// The run is over when the dialog holds a finished sentence: something rather than nothing, and
/// nothing that still counts.
const settled = () =>
  vi.waitFor(() => {
    expect(progress()).not.to.be.equal("");
    expect(progress()).not.to.contain("Caching");
  });

describe("The app menu", () => {
  afterEach(() => {
    // Closing it is what takes the dialog and its style back out of the page.
    document.querySelector("dialog")?.close();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("should offer what is about the app rather than about the memo", () => {
    open_app_menu();

    expect(document.querySelector("dialog")?.open).to.be.true;
    expect(entries()).to.deep.equal([
      "Calendar",
      "User administration",
      "Cache all memos on this device",
      "Memo Maintenance",
      "Journal",
      "Log out",
    ]);
  });

  it("should wear the icons its two destinations are known by", () => {
    open_app_menu();

    const with_icon = Array.from(document.querySelectorAll(".menu-entry")).map(entry => ({
      label: entry.textContent?.trim(),
      icon: entry.querySelector("img-inline-svg")?.getAttribute("src") ?? null,
    }));
    expect(with_icon.filter(entry => entry.icon !== null)).to.deep.equal([
      {label: "Calendar", icon: "/images/ic_today_48px.svg"},
      {label: "User administration", icon: "/images/ic_people_48px.svg"},
    ]);
  });

  it("should hold what the page registers, whatever that is", () => {
    // The calendar is a page of its own and its menu links are ordinary links; what it must not do
    // is inherit "Cache all memos", which is the memo app's business and not the dialog's.
    set_app_entries(() => [
      { label: "Memos", run: () => {} },
      { label: "Log out", run: () => {} },
    ]);

    open_app_menu();
    expect(entries()).to.deep.equal(["Memos", "Log out"]);

    // Back to the memo app's list, so the tests after this one see the page they are testing.
    set_app_entries(memo_menu_entries);
  });

  it("should go to the memo maintenance page and the journal from the menu", async () => {
    const went: string[] = [];
    const listener = (event: CustomEvent<string>) => went.push(event.detail);
    raspandac.on("navigate", listener as (event: CustomEvent<string>) => void);

    open_app_menu();
    click_entry("Memo Maintenance");
    open_app_menu();
    click_entry("Journal");

    raspandac.removeEventListener("navigate", listener);
    // The two pages that used to be links in the corner of the list, kept together with the rest
    // of what is about the app rather than about the memo on screen.
    expect(went).to.deep.equal(["/memo/$$$admin", "/journal"]);
  });

  it("should cache every memo and say what it did", async () => {
    stub_server([31, 32], (id) => memo_reply(id, `\nthe body of ${id}`));

    open_app_menu();
    click_entry("Cache all memos on this device");
    await settled();

    expect(progress()).to.contain("All 2 memos are now on this device");
    expect((await db.read_memo(31))?.text ?? "").to.contain("the body of 31");
    expect((await db.read_memo(32))?.text ?? "").to.contain("the body of 32");
    // The entries are gone: the run has been started, and pressing it again would start another.
    expect(entries()).to.deep.equal([]);
  });

  it("should say which memos would not come", async () => {
    stub_server([33, 34], (id) =>
      id === 33 ? new Response("no", { status: 403 }) : memo_reply(id, "\nits body")
    );

    open_app_menu();
    click_entry("Cache all memos on this device");
    await settled();

    expect(progress()).to.contain("1 of 2 memos are now on this device");
    expect(progress()).to.contain("33");
    expect((await db.read_memo(34))?.text ?? "").to.contain("its body");
  });

  it("should say so when the server cannot be reached at all", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("NetworkError when attempting to fetch resource.");
    });

    open_app_menu();
    click_entry("Cache all memos on this device");
    await settled();

    // The reader is told, and stays where they are: there is nothing to log in to when the
    // network is what is missing.
    expect(progress()).to.contain("Could not cache the memos");
    expect(window.location.pathname).not.to.contain("login");
  });
});
