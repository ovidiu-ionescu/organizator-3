import {describe, it, expect, beforeAll, afterEach, vi} from "vitest";
import * as db from "@dom/memo_db.js";
import * as server_comm from "@dom/server_comm.js";
import {raspandac} from "@dom/events.js";
import type {CacheMemo} from "@dom/memo_interfaces.js";

// New memos, so save_all goes straight to the server for each one: an existing memo is read back
// first, which is a path of its own.
//
// These assertions are written to survive other spec files sharing the same IndexedDB — the
// browser test runner gives every file the same origin — so they say "this memo was attempted
// after that one" rather than "exactly two memos were attempted".
const seed = async (id: number, text: string) => {
  const transaction = await db.get_memo_write_transaction();
  await db.raw_write_memo(transaction, { id, local: { id, text } } as CacheMemo);
};

const reply_for = (id: number) =>
  new Response(
    JSON.stringify({
      memo: { id, title: "saved", memotext: "body", savetime: 1, user: { id: 1, name: "alice" } },
      requester: { id: 1, name: "alice" },
    }),
    { headers: { "Content-Type": "application/json" } }
  );

const record_report = (): { reports: string[]; statuses: string[]; stop: () => void } => {
  const reports: string[] = [];
  const statuses: string[] = [];
  const report_listener = (event: Event) => reports.push((event as CustomEvent<string>).detail);
  const status_listener = (event: Event) => statuses.push((event as CustomEvent<string>).detail);
  raspandac.on("saveAllReport", report_listener as (event: CustomEvent<string>) => void);
  raspandac.on("saveAllStatus", status_listener as (event: CustomEvent<string>) => void);
  return {
    reports,
    statuses,
    stop: () => {
      raspandac.removeEventListener("saveAllReport", report_listener);
      raspandac.removeEventListener("saveAllStatus", status_listener);
    },
  };
};

// Which of the two memos a request is for, by what it carries in its body.
const which = (init?: RequestInit): string => {
  const body = String(init?.body ?? "");
  if (body.includes(encodeURIComponent("this one is refused"))) return "refused";
  if (body.includes(encodeURIComponent("this one is fine"))) return "fine";
  return "other";
};

describe("Saving everything that is dirty", () => {
  let attempts: string[] = [];

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      const request = window.indexedDB.deleteDatabase(db.DBName);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });

  afterEach(() => {
    attempts = [];
    vi.unstubAllGlobals();
  });

  it("should keep going when one memo will not save", async () => {
    // Keys come out in ascending order, so the refused memo has to be the lower id for it to be
    // the one that comes first — otherwise this proves nothing about continuing past a failure.
    await seed(-112, "this one is refused");
    await seed(-111, "this one is fine");

    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      attempts.push(which(init));
      return which(init) === "refused"
        ? new Response("no", { status: 403 })
        : reply_for(500);
    });

    const { reports, statuses, stop } = record_report();
    await server_comm.save_all();
    stop();

    // Both were attempted, the refused one first — so the run did not stop at the failure.
    expect(attempts).to.include("refused");
    expect(attempts).to.include("fine");
    expect(attempts.indexOf("fine")).to.be.greaterThan(attempts.indexOf("refused"));

    expect(reports).to.have.lengthOf(1);
    expect(reports[0]).to.contain("did not");
    expect(reports[0]).to.contain("memo -112");
    expect(reports[0]).to.contain("403");

    // Orange, not red: the memo is still on this device, so "not synced yet" is where it stays.
    expect(statuses).to.deep.equal(["orange"]);
  });

  it("should turn the button red only when the local database refused the memo", async () => {
    await seed(-121, "this one is fine");

    // A reply with no id: the save reaches the local database and fails there, which is the one
    // case the button is red for. The server always sends an id, so this is forced deliberately.
    vi.stubGlobal("fetch", async () => {
      attempts.push("reply without an id");
      return new Response(
        JSON.stringify({ memo: { title: "t", memotext: "b", user: { id: 1, name: "alice" } },
                         requester: { id: 1, name: "alice" } }),
        { headers: { "Content-Type": "application/json" } }
      );
    });

    const { reports, statuses, stop } = record_report();
    await server_comm.save_all();
    stop();

    expect(statuses).to.deep.equal(["orange", "red"]);
    expect(reports).to.have.lengthOf(1);
    expect(reports[0]).to.contain("memo -121");
  });

  it("should stop once the session is gone, and say so", async () => {
    await seed(-201, "this one is refused");
    await seed(-202, "this one is fine");

    vi.stubGlobal("fetch", async () => {
      attempts.push(which());
      return new Response("no", { status: 401 });
    });

    const { reports, statuses, stop } = record_report();
    await server_comm.save_all();
    stop();

    // Nothing can save without a session: the first attempt ends the run rather than asking the
    // rest and collecting the same answer.
    expect(attempts).to.have.lengthOf(1);
    expect(reports).to.have.lengthOf(1);
    expect(reports[0]).to.contain("not attempted, the session had expired");
    // Still orange: a session that expired says nothing about what is on this device.
    expect(statuses).to.deep.equal(["orange"]);
  });

  it("should say nothing when everything saved", async () => {
    await seed(-301, "this one is fine");

    vi.stubGlobal("fetch", async () => reply_for(600));

    const { reports, statuses, stop } = record_report();
    await server_comm.save_all();
    stop();

    expect(reports).to.deep.equal([]);
    // Green: everything reached the server.
    expect(statuses).to.deep.equal(["orange", "green"]);
  });
});
