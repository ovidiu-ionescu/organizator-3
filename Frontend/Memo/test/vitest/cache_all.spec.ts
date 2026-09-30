import {describe, it, expect, afterEach, vi} from "vitest";
import * as db from "@dom/memo_db.js";
import * as server_comm from "@dom/server_comm.js";
import type {CacheMemo} from "@dom/memo_interfaces.js";

// Fetching the whole library into this device, so the app works with the server down. Each memo
// is merged the way a save merges, which is what these check.
//
// Nothing here initializes the wasm module the merge needs, deliberately: on the list page no
// editor has been opened, so this is the state the app is in too. A test that loaded it first
// would pass while the button failed with "wasm is undefined".

const real_fetch = globalThis.fetch;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

const requester = { id: 1, name: "alice" };

// What the server answers for one memo. The access level is the owner's, which is what
// get_memo_access_level_for_requester returns for a memo the reader wrote: leaving it out would
// make the cached copy read-only, and a read-only copy is never queued for saving.
const memo_reply = (id: number, memotext: string, savetime: number, title = "a memo") =>
  json({
    memo: { id, title, memotext, savetime, user: requester, access_level: 3 },
    requester,
  });

const seed = async (cache_memo: CacheMemo) => {
  const transaction = await db.get_memo_write_transaction();
  await db.raw_write_memo(transaction, cache_memo);
};

// Which memos the server lists, and what it answers for each.
const stub_server = (ids: number[], memo_for: (id: number) => unknown) => {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (!target.includes("/organizator/memo/")) {
      // The wasm module and the rest of the page still go where they were going.
      return real_fetch(url, init);
    }
    if (target.includes("/organizator/memo/?")) {
      return json({
        memos: ids.map((id) => ({ id, title: "a memo", user_id: 1, savetime: 1 })),
        requester,
      });
    }
    const id = Number(/\/organizator\/memo\/(\d+)/.exec(target)?.[1]);
    return memo_for(id);
  });
};

describe("Caching every memo from the server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should fetch every memo the server lists", async () => {
    const asked: number[] = [];
    stub_server([21, 22], (id) => {
      asked.push(id);
      return memo_reply(id, "\nits body", 1);
    });

    const result = await server_comm.cache_all_memos();

    expect(asked).to.deep.equal([21, 22]);
    expect(result.cached).to.be.equal(2);
    expect((await db.read_memo(21))?.text).to.contain("its body");
  });

  it("should keep going when one memo will not come", async () => {
    const asked: number[] = [];
    stub_server([23, 24], (id) => {
      asked.push(id);
      if (id === 23) {
        return new Response("no", { status: 403 });
      }
      return memo_reply(id, "\nits body", 1);
    });

    const result = await server_comm.cache_all_memos();

    expect(asked).to.deep.equal([23, 24]);
    expect(result.cached).to.be.equal(1);
    expect(result.failures).to.have.lengthOf(1);
    expect(result.failures[0]).to.contain("memo 23");
    expect(result.failures[0]).to.contain("403");
    expect((await db.read_memo(24))?.text).to.contain("its body");
  });

  it("should merge a memo that changed here and on the server", async () => {
    // Cached: the server's copy as it was when fetched, and an edit made here on top of it.
    await seed({
      id: 31,
      local: { id: 31, text: "added first line\ninitial line", timestamp: 200 },
      server: { id: 31, text: "initial line", timestamp: 100 },
    });
    // The server's copy has moved on as well, since it was fetched.
    stub_server([31], () => memo_reply(31, "\nadded last line", 300, "initial line"));

    await server_comm.cache_all_memos();

    const cached = await db.read_memo(31);
    // Neither side was dropped: the line added here is still there, and so is the one added
    // there. That is the whole reason for asking for the library rather than replacing it.
    expect(cached?.text).to.contain("added first line");
    expect(cached?.text).to.contain("added last line");
    // And the merged copy is the one that has to go back: it holds both edits and the server has
    // neither, so it is queued for the next save rather than left sitting here.
    expect(cached?.dirty).to.be.true;
  });

  it("should fetch several memos at once, but not all of them", async () => {
    // Every memo takes 50 ms to answer. Twelve of them one after another is 600 ms; several at a
    // time is a fraction of that, which is the whole point of the change.
    const ids = Array.from({ length: 12 }, (_, i) => 40 + i);
    let in_flight = 0;
    let most_at_once = 0;

    stub_server(ids, async (id) => {
      in_flight++;
      most_at_once = Math.max(most_at_once, in_flight);
      await new Promise((resolve) => setTimeout(resolve, 50));
      in_flight--;
      return memo_reply(id, "\nits body", 1);
    });

    const start = performance.now();
    const result = await server_comm.cache_all_memos();
    const elapsed = performance.now() - start;

    expect(result.cached).to.be.equal(12);
    expect(elapsed).to.be.lessThan(400);
    // And the server is asked for a few at a time, not for all twelve.
    expect(most_at_once).to.be.greaterThan(1);
    expect(most_at_once).to.be.at.most(server_comm.SIMULTANEOUS_FETCHES);
  });
});
