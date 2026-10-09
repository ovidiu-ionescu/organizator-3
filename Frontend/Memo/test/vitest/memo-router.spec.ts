import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import * as db from "@dom/memo_db.js";
import * as events from "@dom/events.js";
// Registered by the import, as it is in the page: the router only ever names the editor as a type,
// so nothing else here would define the element or the date helper the router logs with.
import "@dom/memo-editor.js";
import {load_route, searchMemos} from "@dom/memo-router.js";
import type {CacheMemo} from "@dom/memo_interfaces.js";
import type {MemoEditor} from "@dom/memo-editor.js";

// The list is drawn from the server's titles, and the server cannot know which memos have been
// edited here since they were fetched — only this device can. So the markers are overlaid with
// what the cache says, and redrawn when the page comes back to the list.

const real_fetch = globalThis.fetch;

const seed = async (cache_memo: CacheMemo) => {
  const transaction = await db.get_memo_write_transaction();
  await db.raw_write_memo(transaction, cache_memo);
};

// The marker the list is showing for a memo, from the bullet's data-status.
const marker_for = (id: number): string | null =>
  document
    .getElementById(`memo_title_link_${id}`)
    ?.parentElement?.getAttribute("data-status") ?? null;

describe("The title list", () => {
  beforeEach(() => {
    document.body.innerHTML = '<section id="memoTitles" page><ul id="memoTitlesList"></ul></section>';
    // The server knows nothing about what has been edited here, which is the point.
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("/organizator/memo/")) {
        return new Response(
          JSON.stringify({
            memos: [
              { id: 7, title: "a memo", user_id: 1, savetime: 1 },
              { id: 8, title: "another memo", user_id: 1, savetime: 1 },
            ],
            requester: { id: 1, name: "alice" },
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      return real_fetch(url, init);
    });
    history.pushState(null, "", "/memo/");
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("should show a memo edited since it was fetched as dirty when the list comes back", async () => {
    await seed({ id: 7, local: { id: 7, text: "a memo" }, server: { id: 7, text: "a memo" } });

    load_route();
    await vi.waitFor(() => {
      expect(marker_for(7)).to.be.equal("server");
    });

    // Edited here, written locally, not on the server yet.
    await seed({
      id: 7,
      local: { id: 7, text: "a memo, edited here" },
      server: { id: 7, text: "a memo" },
    });

    // Back to the list, which is still on screen and so not fetched again.
    load_route();
    await vi.waitFor(() => {
      expect(marker_for(7)).to.be.equal("dirty");
    });
  });

  it("should leave the marker the server gave for a memo that is in step", async () => {
    await seed({ id: 8, local: { id: 8, text: "a memo" }, server: { id: 8, text: "a memo" } });

    load_route();
    await vi.waitFor(() => {
      expect(marker_for(8)).to.be.equal("server");
    });
  });

  it("should show the list for a path without the trailing slash", async () => {
    // nginx redirects organizator.ro/memo to /memo/, so this path only reaches the app from the
    // service worker, whose clean-URL handling finds the precached /memo.html for it. With no
    // route for it the reader would get the shell with every section hidden.
    history.pushState(null, "", "/memo");
    await seed({ id: 7, local: { id: 7, text: "a memo" }, server: { id: 7, text: "a memo" } });

    load_route();
    await vi.waitFor(() => {
      expect(marker_for(7)).to.be.equal("server");
    });
  });

  // The status bar, with the offer to cache everything on its summary line.
  const status_bar = (): { info: HTMLDetailsElement; cache: HTMLElement } => {
    document.body.innerHTML = `
      <section id="memoTitles" page>
        <details id="titles_info">
          <summary><span id="titles_info_summary">Memos from the server</span>
            <a href="#" id="cache_all" hidden>Cache all</a></summary>
          <p id="titles_info_message"></p>
        </details>
        <ul id="memoTitlesList"></ul>
      </section>`;
    return {
      info: document.getElementById("titles_info") as HTMLDetailsElement,
      cache: document.getElementById("cache_all") as HTMLElement,
    };
  };

  it("should offer to cache everything only while the list comes from the server", async () => {
    const { cache } = status_bar();

    load_route();
    await vi.waitFor(() => {
      expect(cache.hidden).to.be.false;
    });

    // The server goes away. The list falls back to this device — which is what the empty list
    // makes it fetch again for — and the offer goes with it: the server has just failed us, so
    // there is nothing left to fetch from, and what it would fetch is already here.
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    (document.getElementById("memoTitlesList") as HTMLElement).innerHTML = "";
    load_route();
    await vi.waitFor(() => {
      expect(cache.hidden).to.be.true;
    });
  });

  it("should not fold the status open when the cache link is clicked", async () => {
    const { info, cache } = status_bar();
    // Never answered, so the run the click starts does not get anywhere; this is about the click
    // itself, and the link sits on the summary line, where a click would otherwise fold it.
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));

    cache.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(info.open).to.be.false;
  });

  // The page as the drop command needs it: the search box to give it the command, the status
  // bar to report into, and the list to draw again.
  const titles_page = () => {
    document.body.innerHTML = `
      <section id="memoTitles" page>
        <nav><input id="searchCriteria"></nav>
        <details id="titles_info">
          <summary><span id="titles_info_summary">Memos from the server</span></summary>
          <p id="titles_info_message"></p>
        </details>
        <ul id="memoTitlesList"></ul>
      </section>`;
  };

  const run_command = (command: string) => {
    (document.getElementById("searchCriteria") as HTMLInputElement).value = command;
    return searchMemos();
  };

  const dialog_button = (value: string): HTMLButtonElement | null =>
    document.querySelector(`dialog button[value="${value}"]`) as HTMLButtonElement | null;

  it("should still be showing the search hits when the reader comes back to the list", async () => {
    // A search of its own: three memos in the list, two of them matching. Two, because a single
    // hit is opened straight away rather than listed.
    let searches = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const target = String(url);
      const memo = (id: number, title: string) => ({ id, title, user_id: 1, savetime: 1 });
      const reply = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      if (target.includes("/organizator/memo/search")) {
        searches++;
        return reply({
          memos: [memo(8, "another memo"), memo(9, "yet another")],
          requester: { id: 1, name: "alice" },
        });
      }
      if (target.includes("/organizator/memo/")) {
        return reply({
          memos: [memo(7, "a memo"), memo(8, "another memo"), memo(9, "yet another")],
          requester: { id: 1, name: "alice" },
        });
      }
      return real_fetch(url, init);
    });
    titles_page();

    load_route();
    await vi.waitFor(() => {
      expect(marker_for(7)).not.to.be.null;
    });

    (document.getElementById("searchCriteria") as HTMLInputElement).value = "another";
    await searchMemos();
    await vi.waitFor(() => {
      expect(marker_for(8)).not.to.be.null;
      expect(marker_for(7)).to.be.null;
    });
    expect(searches).to.be.equal(1);

    const hit_before = document.getElementById("memo_title_link_8");

    // Back to the list, which is where opening a memo and coming out of it leaves the reader.
    // What the memo route does in between touches nothing the list is drawn from, so this goes
    // straight there — with the criteria still in the box, as it is on the way back.
    load_route();

    // The list is drawn again a moment after the route is loaded — it reads the access times
    // first — so waiting for it to be showing the hits already would pass before it had drawn
    // anything at all, and the test would say nothing. A link that is a different element is how
    // a redraw shows itself: the old links are thrown away and built again.
    await vi.waitFor(() => {
      const link = document.getElementById("memo_title_link_8");
      expect(link).not.to.be.null;
      expect(link).not.toBe(hit_before);
    });

    expect(marker_for(8)).not.to.be.null;
    expect(marker_for(7)).to.be.null;
    // And the search was not asked again: the same hits, put back. Asking again would let the
    // list move under a reader who is opening one hit after another.
    expect(searches).to.be.equal(1);
  });

  it("should mark a memo as edited as soon as it is written to this device", async () => {
    titles_page();
    await seed({ id: 7, local: { id: 7, text: "a memo" }, server: { id: 7, text: "a memo" } });

    load_route();
    await vi.waitFor(() => {
      expect(marker_for(7)).to.be.equal("server");
    });

    // The reader edits it. The editor writes the change to this device only once it has read the
    // memo and digested it, which is after they are already back at the list — so the list cannot
    // count on being drawn again afterwards, and is told instead.
    await seed({
      id: 7,
      local: { id: 7, text: "a memo, edited here", timestamp: 200 },
      server: { id: 7, text: "a memo", timestamp: 100 },
    });
    events.memo_saved_locally(7);

    await vi.waitFor(() => {
      expect(marker_for(7)).to.be.equal("dirty");
    });
  });

  it("should show a memo as edited when the reader edits it and comes straight back", async () => {
    // The real thing, as far as it can be had here: the reader's own route in and out of a memo,
    // with the editor doing the writing. Its own memo id, because the other tests in this file
    // leave theirs behind in the database, and this one has to start in step with the server.
    const id = 12;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const target = String(url);
      const reply = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      const requester = { id: 1, name: "alice" };
      if (target.includes("memogroup")) {
        return reply({ memogroups: [], requester });
      }
      if (target.includes(`/organizator/memo/${id}`)) {
        return reply({
          memo: { id, title: "a memo", memotext: "\nbody", savetime: 100, user: requester, access_level: 3 },
          requester,
        });
      }
      if (target.includes("/organizator/memo/")) {
        return reply({ memos: [{ id, title: "a memo", user_id: 1, savetime: 100 }], requester });
      }
      return real_fetch(url, init);
    });
    document.body.innerHTML = `
      <section id="memoTitles" page>
        <nav><input id="searchCriteria"></nav>
        <details id="titles_info">
          <summary><span id="titles_info_summary">Memos from the server</span></summary>
          <p id="titles_info_message"></p>
        </details>
        <ul id="memoTitlesList"></ul>
      </section>
      <section id="singleMemo" page><memo-editor id="editor"></memo-editor></section>`;

    history.pushState(null, "", "/memo/");
    load_route();
    await vi.waitFor(() => {
      expect(marker_for(id)).to.be.equal("server");
    });

    // Open it and type.
    history.pushState(null, "", `/memo/${id}`);
    load_route();
    const editor = document.getElementById("editor") as MemoEditor;
    await vi.waitFor(() => {
      expect(editor.memoId).to.be.equal(id);
    });
    editor.value = "a memo, edited here";

    // Back, which is both a popstate — the editor writes what it holds when it hears one — and
    // the list being shown again.
    history.pushState(null, "", "/memo/");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await vi.waitFor(() => {
      expect(marker_for(id)).to.be.equal("dirty");
    });
  });

  it("should show a memo written here when the reader comes back to the list", async () => {
    titles_page();
    load_route();
    await vi.waitFor(() => {
      expect(marker_for(7)).not.to.be.null;
    });

    // A memo written here has no server id yet, which is what makes it new — and the list on
    // screen was drawn from the server's answer, which will never mention it.
    await seed({ id: -6, local: { id: -6, text: "written here just now" } });

    load_route();

    await vi.waitFor(() => {
      expect(marker_for(-6)).to.be.equal("new");
    });
  });

  it("should say a new memo is not on this device rather than loading for ever", async () => {
    document.body.innerHTML = `
      <section id="memoTitles" page>
        <nav><input id="searchCriteria"></nav>
        <ul id="memoTitlesList"></ul>
      </section>
      <section id="singleMemo" page><memo-editor id="editor"></memo-editor></section>`;
    const editor = document.getElementById("editor") as MemoEditor;

    // An id from somewhere else — a bookmark, another device, or a list drawn before this
    // device's copy was dropped. There is nothing here to show and nothing to fetch.
    history.pushState(null, "", "/memo/-9");
    load_route();

    // The editor shows what it has to say where the memo would be, which is the textarea.
    await vi.waitFor(() => {
      const source = editor.shadowRoot?.querySelector("#source") as HTMLTextAreaElement | null;
      expect(source?.value).to.contain("No memo -9");
    });
  });

  // These empty the database every spec file shares, so they run last.
  it("should redraw the markers when the local cache is dropped", async () => {    titles_page();

    // Edited here and not on the server yet: the pencil comes from the cache, and the server's
    // own list says nothing about it. That also means there is something to lose, which the
    // command asks about first.
    await seed({ id: 7, local: { id: 7, text: "a memo, edited here" }, server: { id: 7, text: "a memo" } });

    load_route();
    await vi.waitFor(() => {
      expect(marker_for(7)).to.be.equal("dirty");
    });

    const dropping = run_command("$$$drop local cache");
    await vi.waitFor(() => {
      expect(dialog_button("go")).not.to.be.null;
    });
    dialog_button("go")!.click();
    await dropping;

    // The cache is gone, so there is nothing left that could say the memo is dirty. Waited for,
    // because the redraw is not awaited: it clears the list and fills it again a moment later.
    await vi.waitFor(() => {
      expect(marker_for(7)).to.be.equal("server");
    });
  });

  it("should warn before dropping a memo that was never saved, and keep it if told to", async () => {
    titles_page();
    // Written here and never sent: dropping the cache is the end of it, which is what the
    // warning is for.
    await seed({ id: -3, local: { id: -3, text: "never been to the server" } });

    const dropping = run_command("$$$drop local cache");
    await vi.waitFor(() => {
      expect(dialog_button("cancel")).not.to.be.null;
    });

    // It names what is at stake rather than asking about a number.
    expect(document.getElementById("confirm_detail")?.innerText).to.contain("never been to the server");

    dialog_button("cancel")!.click();
    await dropping;

    expect((await db.read_memo(-3))?.text).to.be.equal("never been to the server");
    expect(document.getElementById("titles_info_summary")?.innerText).to.be.equal("Nothing was dropped");
  });

  it("should not ask when there is nothing waiting to be saved", async () => {
    titles_page();
    // Whatever the other specs left in the database, this is about a database with nothing
    // outstanding in it.
    await db.drop_database();
    expect(await db.unsaved_memos()).to.be.empty;

    await run_command("$$$drop local cache");

    expect(document.querySelector("dialog")).to.be.null;
    expect(document.getElementById("titles_info_summary")?.innerText).to.be.equal("Local cache dropped");
  });

  it("should warn before deleting a memo that was never saved, and keep it if told to", async () => {
    titles_page();
    await seed({ id: -4, local: { id: -4, text: "never been to the server" } });

    const dropping = run_command("$$$drop memo -4");
    await vi.waitFor(() => {
      expect(dialog_button("cancel")).not.to.be.null;
    });
    expect(document.getElementById("confirm_detail")?.innerText).to.contain("never been to the server");

    dialog_button("cancel")!.click();
    await dropping;

    expect(await db.read_memo(-4)).not.to.be.null;
    expect(document.getElementById("titles_info_summary")?.innerText).to.be.equal("Nothing was dropped");
  });

  it("should delete a memo the server has never seen once that is confirmed", async () => {
    titles_page();
    await seed({ id: -5, local: { id: -5, text: "never been to the server" } });

    const dropping = run_command("$$$drop memo -5");
    await vi.waitFor(() => {
      expect(dialog_button("go")).not.to.be.null;
    });
    dialog_button("go")!.click();
    await dropping;

    expect(await db.read_memo(-5)).to.be.null;
  });

  it("should delete a memo the server has without asking", async () => {
    titles_page();
    // In step with the server: deleting it here costs nothing, because opening it fetches it
    // again.
    await seed({ id: 5, local: { id: 5, text: "a memo" }, server: { id: 5, text: "a memo" } });

    await run_command("$$$drop memo 5");

    expect(document.querySelector("dialog")).to.be.null;
    expect(await db.read_memo(5)).to.be.null;
  });
});
