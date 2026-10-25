import {describe, it, expect, afterEach, vi} from "vitest";
import "@dom/memo-history.js";
import type {MemoHistory} from "@dom/memo-history.js";
import type {IdName, MemoHistoryReply, ServerMemoHistory} from "@dom/memo_interfaces.js";

// The history of a memo: every version the server kept, rendered or as its source, with the
// versions that changed nothing marked, and a line diff between any two of them. The diff is the
// same wasm `diff` the rest of the app uses — `similar`'s line diff — so what is checked here is
// the page around it, not the diff algorithm.

const real_fetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {"Content-Type": "application/json"},
  });

/// One history row as the server stores it: the title column is the first line, and the body
/// column starts with the newline that separated it.
const version = (
  id: number,
  text: string,
  savetime: number | null,
  saver: string = "alice",
  memogroup: IdName | null = null
): ServerMemoHistory => {
  const newline = text.indexOf("\n");
  return {
    id,
    memo_id: 7,
    title: newline === -1 ? text : text.slice(0, newline),
    memotext: newline === -1 ? "" : text.slice(newline),
    savetime,
    memogroup,
    user: {id: 1, name: "alice"},
    saveuser: {id: 1, name: saver},
  };
};

const reply = (
  history: ServerMemoHistory[],
  current_text: string = "# One\nthe current text",
  current_group: IdName | null = {id: 4, name: "Home"}
): MemoHistoryReply => {
  const newline = current_text.indexOf("\n");
  return {
    memo: {
      id: 7,
      title: newline === -1 ? current_text : current_text.slice(0, newline),
      memotext: newline === -1 ? "" : current_text.slice(newline),
      savetime: 4000,
      memogroup: current_group,
      user: {id: 1, name: "alice"},
      access_level: 3,
    },
    history,
    requester: {id: 1, name: "alice"},
  };
};

/// Answer the history read with this body, and leave every other request — the wasm module above
/// all — to the server the test runner starts.
const stub_history = (body: unknown, status = 200): string[] => {
  const asked: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("/organizator/memo/7/history")) {
      asked.push(target);
      return json(body, status);
    }
    return real_fetch(url, init);
  });
  return asked;
};

/// A server whose history can lose a version: DELETE removes it from what the next read gives.
const serve_history = (
  initial: ServerMemoHistory[],
  current_text?: string
): {deleted: string[]} => {
  let history = initial;
  const deleted: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const target = String(url);
    if ((init?.method ?? "GET") === "DELETE" && target.includes("/history/")) {
      deleted.push(target);
      const id = Number(/history\/(\d+)/.exec(target)?.[1]);
      history = history.filter(row => row.id !== id);
      return new Response(null, {status: 204});
    }
    if (target.includes("/organizator/memo/7/history")) {
      return json(reply(history, current_text));
    }
    return real_fetch(url, init);
  });
  return {deleted};
};

const mount = (): MemoHistory => {
  document.body.innerHTML = "<memo-history></memo-history>";
  return document.querySelector("memo-history") as MemoHistory;
};

const cards = (page: MemoHistory): HTMLElement[] =>
  Array.from(page.shadowRoot?.querySelectorAll<HTMLElement>(".version") ?? []);

const part = (page: MemoHistory, selector: string): HTMLElement | null =>
  page.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;

const open = (page: MemoHistory, id: number = 7) => void page.show(id);

describe("The history of a memo", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("should show the memo itself first, then the versions newest first", async () => {
    const asked = stub_history(
      reply([
        version(11, "# One\nfirst", 1_000),
        version(12, "# One\nsecond", 2_000, "bob", {id: 3, name: "Office"}),
        version(13, "# One\nthird", 3_000),
      ])
    );
    const page = mount();
    open(page);

    await vi.waitFor(() => expect(cards(page).length).to.equal(4));
    expect(asked).to.have.length(1);
    expect(asked[0]).to.contain("/organizator/memo/7/history");
    expect(cards(page).map(card => card.dataset.historyId)).to.deep.equal([
      "current",
      "13",
      "12",
      "11",
    ]);
    expect(cards(page).map(card => card.querySelector("h2")?.textContent)).to.deep.equal([
      "Current version",
      "Version 3",
      "Version 2",
      "Version 1",
    ]);
    expect(part(page, "#memo_title")?.textContent).to.equal("# One");
    expect(cards(page)[0].textContent).to.contain("the memo as it is now");
    expect(cards(page)[0].textContent).to.contain("memo id 7");
    expect(cards(page)[0].textContent).to.contain("group: Home");
    const saved_by_bob = cards(page).find(card => card.dataset.historyId === "12");
    expect(saved_by_bob?.textContent).to.contain("saved by bob");
    expect(saved_by_bob?.textContent).to.contain("history id 12");
    expect(saved_by_bob?.textContent).to.contain("group: Office");
    // A version with no group says so, and every history row carries its own table id.
    const third = cards(page).find(card => card.dataset.historyId === "13");
    expect(third?.textContent).to.contain("history id 13");
    expect(third?.textContent).to.contain("group: none");
    expect((part(page, "#note") as HTMLElement).hidden).to.equal(false);
  });

  it("should mark a version that did not change at all from the one before it", async () => {
    // The current memo is the same text as the newest archived version, and the second archived
    // version is the same as the first. Both are steps that changed nothing.
    stub_history(
      reply(
        [
          version(11, "# One\nsame", 1_000),
          version(12, "# One\nsame", 2_000),
          version(13, "# One\nchanged", 3_000),
        ],
        "# One\nchanged"
      )
    );
    const page = mount();
    open(page);
    await vi.waitFor(() => expect(cards(page).length).to.equal(4));

    const [current, newest, same, oldest] = cards(page);
    expect(current.classList.contains("unchanged")).to.equal(true);
    expect(newest.classList.contains("unchanged")).to.equal(false);
    expect(same.classList.contains("unchanged")).to.equal(true);
    expect(oldest.classList.contains("unchanged")).to.equal(false);
    expect(current.textContent).to.contain("No change from the previous version.");
    expect(same.textContent).to.contain("No change from the previous version.");
    // A red border, rather than only a class: wider than the ordinary one and a different colour.
    expect(getComputedStyle(current).borderTopWidth).to.equal("2px");
    expect(getComputedStyle(same).borderTopWidth).to.equal("2px");
    expect(getComputedStyle(newest).borderTopWidth).to.equal("1px");
    expect(getComputedStyle(current).borderTopColor).not.to.equal(
      getComputedStyle(newest).borderTopColor
    );
  });

  it("should preview the markdown and switch to the source it was stored as", async () => {
    stub_history(reply([version(11, "# One\nfirst line\nsecond line", 1_000)]));
    const page = mount();
    open(page);
    await vi.waitFor(() => expect(cards(page).length).to.equal(2));

    const card = cards(page)[1];
    const preview = card.querySelector<HTMLElement>(".preview");
    expect(preview).not.to.be.null;
    expect(preview?.innerHTML).to.contain("<h1");
    expect(preview?.textContent).to.contain("first line");

    const toggle = card.querySelector<HTMLButtonElement>(".toggle")!;
    expect(toggle.textContent).to.equal("Source");
    toggle.click();

    const source = card.querySelector<HTMLPreElement>(".source");
    expect(source?.textContent).to.equal("# One\nfirst line\nsecond line");
    expect(card.querySelector(".preview")).to.be.null;
    expect(toggle.textContent).to.equal("Preview");

    toggle.click();
    expect(card.querySelector(".preview")?.innerHTML).to.contain("<h1");
  });

  it("should diff a version with the adjacent one by default and with an earlier one on request", async () => {
    stub_history(
      reply([
        version(11, "# One\nline one\nold", 1_000),
        version(12, "# One\nline one\nnew", 2_000),
        version(13, "# One\nline one\nnew", 3_000),
        version(14, "# One\nline two\nnew", 4_000),
      ])
    );
    const page = mount();
    open(page);
    await vi.waitFor(() => expect(cards(page).length).to.equal(5));

    const card_for = (id: string): HTMLElement =>
      cards(page).find(card => card.dataset.historyId === id)!;
    const current = card_for("current");
    const fourth = card_for("14");
    const third = card_for("13");
    const second = card_for("12");
    const first = card_for("11");

    // Adjacent unless told otherwise: the step before each row is selected. The current memo's
    // step before it is the newest archived version.
    expect(current.querySelector<HTMLSelectElement>("select")?.value).to.equal("history:14");
    expect(fourth.querySelector<HTMLSelectElement>("select")?.value).to.equal("history:13");
    expect(third.querySelector<HTMLSelectElement>("select")?.value).to.equal("history:12");
    expect(second.querySelector<HTMLSelectElement>("select")?.value).to.equal("history:11");
    // The oldest version has no earlier one to compare with.
    expect(first.querySelector(".diff-controls")).to.be.null;
    // Only the versions before a row are offered; any pair can be compared from the later row.
    expect(current.querySelectorAll("select option")).to.have.length(4);
    expect(fourth.querySelectorAll("select option")).to.have.length(3);
    expect(second.querySelectorAll("select option")).to.have.length(1);

    // The newest step: from the most recent archived version to the memo itself.
    current.querySelector<HTMLButtonElement>(".diff-button")!.click();
    await vi.waitFor(() => expect(current.querySelector(".diff")).not.to.be.null);
    expect(current.querySelector(".diff-caption")?.textContent).to.contain(
      "from version 4 to the current version"
    );

    // The second version's default: the adjacent step that brought it into being.
    second.querySelector<HTMLButtonElement>(".diff-button")!.click();
    await vi.waitFor(() => expect(second.querySelector(".diff")).not.to.be.null);
    const diff = second.querySelector(".diff")!;
    expect(diff.querySelector(".removed")?.textContent).to.equal("-old");
    expect(diff.querySelector(".added")?.textContent).to.equal("+new");
    expect(second.querySelector(".diff-caption")?.textContent).to.contain(
      "from version 1 to version 2"
    );

    // The adjacent pair that changed nothing says so instead of drawing a wall of unchanged lines.
    third.querySelector<HTMLButtonElement>(".diff-button")!.click();
    await vi.waitFor(() =>
      expect(third.querySelector(".diff-none")?.textContent).to.contain(
        "No changes between these versions."
      )
    );

    // An earlier version can be chosen as the one to compare from.
    const fourth_select = fourth.querySelector<HTMLSelectElement>(".diff-controls select")!;
    fourth_select.value = "history:11";
    fourth_select.dispatchEvent(new Event("change"));
    expect(fourth.querySelector(".diff")).to.be.null;
    fourth.querySelector<HTMLButtonElement>(".diff-button")!.click();
    await vi.waitFor(() => expect(fourth.querySelector(".diff")).not.to.be.null);
    expect(fourth.querySelector(".diff-caption")?.textContent).to.contain(
      "from version 1 to version 4"
    );
    const lines = Array.from(fourth.querySelectorAll(".diff span")).map(span => span.textContent);
    expect(lines).to.include("-line one");
    expect(lines).to.include("+line two");
  });

  it("should delete the newer of two identical history versions, but only after confirmation", async () => {
    const {deleted} = serve_history([
      version(11, "# One\nsame", 1_000),
      version(12, "# One\nsame", 2_000),
      version(13, "# One\nother", 3_000),
    ]);
    const page = mount();
    open(page);
    await vi.waitFor(() => expect(cards(page).length).to.equal(4));

    const by_id = (id: string): HTMLElement =>
      cards(page).find(card => card.dataset.historyId === id)!;
    const newer = by_id("12");
    expect(newer.querySelector(".delete")).not.to.be.null;
    expect(by_id("11").querySelector(".delete")).to.be.null;
    expect(by_id("13").querySelector(".delete")).to.be.null;
    expect(by_id("current").querySelector(".delete")).to.be.null;

    // Cancelling leaves the version and sends no delete.
    newer.querySelector<HTMLButtonElement>(".delete")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('dialog button[value="cancel"]')).not.to.be.null
    );
    expect(document.getElementById("confirm_question")?.textContent).to.contain(
      "Delete version 2 from the history?"
    );
    expect(document.getElementById("confirm_detail")?.innerText).to.contain(
      "same text as version 1"
    );
    expect(document.getElementById("confirm_detail")?.innerText).to.contain(
      "history-row id is 12"
    );
    document.querySelector<HTMLButtonElement>('dialog button[value="cancel"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("dialog")).to.be.null);
    expect(deleted).to.have.length(0);

    // Confirming sends the delete and reads the history again without that version.
    newer.querySelector<HTMLButtonElement>(".delete")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('dialog button[value="go"]')).not.to.be.null
    );
    document.querySelector<HTMLButtonElement>('dialog button[value="go"]')!.click();

    await vi.waitFor(() => expect(deleted).to.have.length(1));
    expect(deleted[0]).to.contain("/organizador/memo/history/12");
    await vi.waitFor(() => expect(cards(page).length).to.equal(3));
    expect(cards(page).some(card => card.dataset.historyId === "12")).to.equal(false);
  });

  it("should offer to delete the latest history version when it equals the current memo", async () => {
    const {deleted} = serve_history(
      [
        version(11, "# One\nother", 1_000),
        version(12, "# One\nthe current text", 2_000),
      ],
      "# One\nthe current text"
    );
    const page = mount();
    open(page);
    await vi.waitFor(() => expect(cards(page).length).to.equal(3));

    const by_id = (id: string): HTMLElement =>
      cards(page).find(card => card.dataset.historyId === id)!;
    // The newest history row is the duplicate of the memo table's row; the memo itself has no
    // delete button, and the older history row is not a duplicate.
    const latest = by_id("12");
    expect(latest.querySelector(".delete")).not.to.be.null;
    expect(by_id("11").querySelector(".delete")).to.be.null;
    expect(by_id("current").querySelector(".delete")).to.be.null;

    latest.querySelector<HTMLButtonElement>(".delete")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('dialog button[value="cancel"]')).not.to.be.null
    );
    expect(document.getElementById("confirm_question")?.textContent).to.contain(
      "Delete version 2 from the history?"
    );
    expect(document.getElementById("confirm_detail")?.innerText).to.contain(
      "the current memo on the server"
    );
    expect(document.getElementById("confirm_detail")?.innerText).to.contain(
      "history-row id is 12"
    );
    document.querySelector<HTMLButtonElement>('dialog button[value="cancel"]')!.click();
    await vi.waitFor(() => expect(document.querySelector("dialog")).to.be.null);
    expect(deleted).to.have.length(0);
  });

  it("should say so when the server will not give the history", async () => {
    stub_history({error: "memo 7 not found"}, 404);
    const page = mount();
    open(page);

    await vi.waitFor(() =>
      expect(part(page, "#status")?.textContent).to.contain("History is not available for this memo.")
    );
    expect(cards(page)).to.have.length(0);
  });

  it("should show the memo itself and say it has no earlier versions", async () => {
    stub_history(reply([]));
    const page = mount();
    open(page);

    await vi.waitFor(() =>
      expect(part(page, "#status")?.textContent).to.contain("No earlier versions.")
    );
    expect(cards(page)).to.have.length(1);
    expect(cards(page)[0].dataset.historyId).to.equal("current");
    expect(cards(page)[0].querySelector("h2")?.textContent).to.equal("Current version");
    expect(cards(page)[0].querySelector(".diff-controls")).to.be.null;
    expect(part(page, "#memo_title")?.textContent).to.equal("# One");
    expect((part(page, "#note") as HTMLElement).hidden).to.equal(false);
  });

  it("should not ask the server for the history of a memo made here and never saved", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("/history")) asked.push(String(url));
      return real_fetch(url, init);
    });
    const page = mount();
    open(page, -3);

    await vi.waitFor(() =>
      expect(part(page, "#status")?.textContent).to.contain(
        "History is available once the memo has been saved on the server."
      )
    );
    expect(asked).to.have.length(0);
    expect(cards(page)).to.have.length(0);
  });
});
