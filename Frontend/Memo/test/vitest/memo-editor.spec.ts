import {describe, it, expect, afterEach, vi} from "vitest";
// Registered by the import; the type comes separately, because an import used only as a type is
// dropped by the compiler and the element would then never be defined.
import "@dom/memo-editor.js";
import type {MemoEditor} from "@dom/memo-editor.js";
import {raspandac} from "@dom/events.js";

// The editor's icons are inlined by fetching them, and the group list inside it fetches its
// options; there is no API here, so answer those two. Everything else — the wasm module the
// markdown rendering pulls in — goes to the real server, which serves it with the MIME type
// WebAssembly insists on.
const real_fetch = globalThis.fetch;

const stub_the_server = () => {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const target = String(url);
    if (target.includes("memogroup")) {
      return new Response(
        JSON.stringify({ memogroups: [], requester: { id: 1, name: "ovidiu" } }),
        { headers: { "Content-Type": "application/json" } }
      );
    }
    if (target.endsWith(".svg")) {
      return new Response("<svg></svg>", { headers: { "Content-Type": "image/svg+xml" } });
    }
    return real_fetch(url, init);
  });
};

// The editor builds itself from a template string, so a mistake inside its <style> is invisible
// to tsc and to any query: the CSS parser drops the rule it cannot read and the textarea quietly
// falls back to the browser's defaults. Reading the computed style is what tells the two apart,
// which is the only reason this test exists.

const make_editor = (): MemoEditor => {
  const editor = document.createElement("memo-editor") as MemoEditor;
  document.body.appendChild(editor);
  return editor;
};

const get_source = (editor: MemoEditor): HTMLTextAreaElement | null =>
  editor.shadowRoot?.querySelector("#source") ?? null;

describe("The memo editor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("should style its textarea rather than leave it to the browser defaults", () => {
    stub_the_server();

    const source = get_source(make_editor());
    expect(source).not.to.be.null;

    const style = getComputedStyle(source as HTMLTextAreaElement);
    // All three come from the one #source rule. Without it the textarea is 13px monospace, sized
    // by the browser, and resizable by dragging its corner.
    expect(style.fontSize).to.be.equal("16px");
    expect(style.resize).to.be.equal("none");
    expect(style.boxSizing).to.be.equal("border-box");
    // flex: 1 lives in the same rule. It used to be repeated in a second #source rule further
    // down, which was the only one doing anything while the first was unparseable — so this
    // guards against the repeat coming back as the only copy.
    expect(style.flexGrow).to.be.equal("1");
  });

  it("should open a memo neutral, and turn orange once an edit is written", async () => {
    stub_the_server();

    const editor = make_editor();
    const colour = () =>
      (editor.shadowRoot?.querySelector("#save_all_button") as HTMLElement | null)?.style.color;

    // Someone else's colour from a moment ago, to be sure opening the memo clears it.
    editor.shadowRoot?.querySelector("#save_all_button")?.setAttribute("style", "color: green");

    // No cache record, so nothing has ever said what the server holds for this memo.
    await editor.set_memo({ id: 4, text: "# a memo", timestamp: 100 }, true);
    expect(colour()).to.be.equal("");

    // An edit, written to the local database: not on the server yet, so orange.
    editor.value = "# a memo, edited";
    await editor.save_local_only({ type: "test" });
    expect(colour()).to.be.equal("orange");
  });

  it("should say so when it has written a memo to this device", async () => {
    stub_the_server();
    const written: number[] = [];
    const listener = (event: Event) => written.push((event as CustomEvent<number>).detail);
    raspandac.on("memoSavedLocally", listener as (event: CustomEvent<number>) => void);

    const editor = make_editor();
    await editor.set_memo({ id: 6, text: "# a memo", timestamp: 100 }, true);
    editor.value = "# a memo, edited";
    await editor.save_local_only({ type: "test" });

    raspandac.removeEventListener("memoSavedLocally", listener);

    // The list of titles draws its markers from the cache, so a write it is not told about is a
    // memo that goes on looking untouched. Said once per write rather than once per test.
    expect(written.length).to.be.greaterThan(0);
    expect(written).to.include(6);
  });

  it("should react to an edit as it is made, not when the memo is next saved", async () => {
    stub_the_server();
    const editor = make_editor();
    const colour = () =>
      (editor.shadowRoot?.querySelector("#save_all_button") as HTMLElement | null)?.style.color;
    const source = () => editor.shadowRoot?.querySelector("#source") as HTMLTextAreaElement | null;

    await editor.set_memo({ id: 3, text: "# a memo", timestamp: 100 }, true);
    expect(colour()).to.be.equal("");

    const textarea = source() as HTMLTextAreaElement;
    const type = (text: string) => {
      textarea.value = text;
      textarea.dispatchEvent(new Event("input"));
    };

    // Typing: the browser raises input, and nothing is written anywhere yet — not even to this
    // device's database — so the button says that, rather than claiming the memo is merely
    // waiting to sync.
    type("# a memo, being typed");
    expect(colour()).to.be.equal("yellow");

    // Undone before anything was saved: nothing is outstanding, so the colour goes back too.
    type("# a memo");
    expect(colour()).to.be.equal("");

    // Typed again and written to the local database: now it is waiting for the server, which is
    // the other colour.
    type("# a memo, being typed");
    expect(colour()).to.be.equal("yellow");
    await editor.save_local_only({ type: "test" });
    expect(colour()).to.be.equal("orange");
  });

  it("should open a memo that is still dirty in the colour that says so", async () => {
    stub_the_server();

    const editor = make_editor();
    // What read_memo hands over for a memo whose cached copy has moved on from the server's.
    await editor.set_memo({ id: 2, text: "# a memo", timestamp: 100, dirty: true }, true);

    const colour = (
      editor.shadowRoot?.querySelector("#save_all_button") as HTMLElement | null
    )?.style.color;
    expect(colour).to.be.equal("orange");
  });

  it("should keep the memo it is holding when a status message arrives", () => {
    stub_the_server();

    const editor = make_editor();
    editor.memoId = 42;

    // This is what a database error emits, and the only thing that emits it today.
    raspandac.emit("savingEvent", "the database complained");

    expect(editor.shadowRoot?.querySelector("#status")?.textContent).to.be.equal(
      "the database complained"
    );
    // Still holding its memo. Clearing it here is what turned one database error into an editor
    // that saved nothing at all until the page was reloaded.
    expect(editor.memoId).to.be.equal(42);
  });
});
