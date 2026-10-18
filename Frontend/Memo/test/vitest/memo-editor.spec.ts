import {describe, it, expect, beforeAll, afterEach, vi} from "vitest";
// Registered by the import; the type comes separately, because an import used only as a type is
// dropped by the compiler and the element would then never be defined.
import "@dom/memo-editor.js";
import type {MemoEditor} from "@dom/memo-editor.js";
import {raspandac} from "@dom/events.js";
import * as db from "@dom/memo_db.js";
import type {MemoGroupList} from "@dom/group-list.js";
import type {ThemeList} from "@dom/theme-list.js";
import {apply_theme} from "@dom/theme.js";
// The palettes, as the page loads them: without this the variables the editor reads are undefined
// and every colour falls back to the hard-coded default.
import "../../src/html/themes.css";
import init, {memo_encrypt, memo_decrypt} from "@wasm/organizator_wasm";

// The editor's icons are inlined by fetching them, and the group list inside it fetches its
// options; there is no API here, so answer those two. Everything else — the wasm module the
// markdown rendering pulls in — goes to the real server, which serves it with the MIME type
// WebAssembly insists on.
const real_fetch = globalThis.fetch;

// The wasm module is not initialized by importing it; the editor waits for it through wasm.ts.
// This spec encrypts a memo itself, so it has to wait for it too.
beforeAll(async () => {
  await init();
});

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

/// Forget the groups this browser has cached. `read_memo_groups` answers from that cache before
/// it gives up, so a fetch that fails is only an error when there is nothing cached to fall back
/// on — which is the state a first run with the server unreachable is in.
const forget_cached_memogroups = async () => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(db.DBName, 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(["general_store"], "readwrite");
    transaction.objectStore("general_store").delete("memogroups");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
};

const make_editor = (): MemoEditor => {
  const editor = document.createElement("memo-editor") as MemoEditor;
  document.body.appendChild(editor);
  return editor;
};

/// The cache record a memo has once the server has answered for it. A positive id without one is
/// a lost record, not a memo that was never fetched, so a test that saves such a memo has to
/// start from the state the app is in.
const cache_a_memo = (id: number) =>
  db.save_memo_after_fetching_from_server({
    memo: {
      id,
      title: "# a memo",
      memotext: "",
      savetime: 100,
      user: { id: 1, name: "ovidiu" },
      access_level: 3,
    },
    requester: { id: 1, name: "ovidiu" },
  });

const get_source = (editor: MemoEditor): HTMLTextAreaElement | null =>
  editor.shadowRoot?.querySelector("#source") ?? null;

describe("The memo editor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    // A theme is on <html>, so it would follow the next test into its stylesheet — and the
    // textarea test below reads the size the default theme gives it.
    delete document.documentElement.dataset.theme;
    localStorage.clear();
    // The geolocation spies: unstubAllGlobals does not put those back.
    vi.restoreAllMocks();
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
    await cache_a_memo(4);

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

  it("should keep the group of a memo shared with the reader when it saves it", async () => {
    // Shared with the reader, so its group belongs to whoever shared it and is in none of the
    // reader's own lists. The editor reads the group it saves from the control, so a control
    // that cannot hold that group writes the memo as though it had none — and the server refuses
    // the change, because only the owner may move a memo.
    const replied_with_groups = vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("memogroup")) {
        return new Response(
          JSON.stringify({ memogroups: [{ id: 3, name: "mine" }], requester: { id: 2, name: "bob" } }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      if (target.endsWith(".svg")) {
        return new Response("<svg></svg>", { headers: { "Content-Type": "image/svg+xml" } });
      }
      return real_fetch(url, init);
    });
    void replied_with_groups;

    const editor = make_editor();
    await editor.set_memo(
      {
        id: 26,
        text: "# a shared memo",
        timestamp: 100,
        memogroup: { id: 20, name: "someone else's" },
        owned: false,
      },
      true
    );

    const saved = await editor.get_memo();
    expect(saved?.memogroup?.id).to.be.equal(20);
    // And the reader still cannot move it: the control is there to show, not to change.
    expect((editor.shadowRoot?.querySelector("#edit_memogroup") as MemoGroupList).readonly).to.be.true;
  });

  it("should not mark a memo dirty when it was only decrypted", async () => {
    stub_the_server();
    const password = "correct horse battery";
    const plaintext = "# a memo\n\u300csecret\u300d";
    // What the server holds for an encrypted memo, as the editor stored it.
    const stored = memo_encrypt(plaintext, password, 1700000000000);
    await db.save_memo_after_fetching_from_server({
      memo: {
        id: 25,
        // The memo's own text, split as memo_write splits it: the first line is the title and
        // the rest comes after it. Only the part between the markers is encrypted.
        title: "# a memo",
        memotext: `\n${stored.substring("# a memo\n".length)}`,
        savetime: 100,
        user: { id: 1, name: "ovidiu" },
        access_level: 3,
      },
      requester: { id: 1, name: "ovidiu" },
    });

    const editor = make_editor();
    (editor as unknown as { _password: string })._password = password;
    await editor.set_memo((await db.read_memo(25))!, true);

    // The reader clicks decrypt to read it — not an edit. The editor's text becomes the clear
    // text, and the record it writes must not now claim the memo has changed.
    (editor.shadowRoot?.querySelector("#decrypt_button") as HTMLElement).click();
    const source = editor.shadowRoot?.querySelector("#source") as HTMLTextAreaElement;
    // Editing, which is where a reader is when they decrypt: the clear text goes into the
    // textarea, and the ciphertext that was there is what gets lost.
    (editor.shadowRoot?.querySelector("#edit_button") as HTMLElement).click();
    await vi.waitFor(() => {
      expect(source.value).to.contain("secret");
    });

    await editor.save_local_only({ type: "test" });

    expect((await db.read_memo(25))?.dirty).to.be.false;
  });

  it("should say so when it has written a memo to this device", async () => {
    stub_the_server();
    await cache_a_memo(6);
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

  it("should keep the memo's group when the list of groups arrives late", async () => {
    // The element asks the server for the groups as it is made, and a memo can be opened while
    // that is still in flight. The late answer rebuilds the control, and the group the memo is in
    // has to survive it: the editor reads the group it saves from that control.
    let group_fetches = 0;
    let release_the_first: () => void = () => {};
    const first_is_waiting = new Promise<void>((resolve) => {
      release_the_first = resolve;
    });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("memogroup")) {
        group_fetches++;
        if (group_fetches === 1) {
          await first_is_waiting;
        }
        return new Response(
          JSON.stringify({ memogroups: [{ id: 3, name: "three" }], requester: { id: 1, name: "ovidiu" } }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      if (target.endsWith(".svg")) {
        return new Response("<svg></svg>", { headers: { "Content-Type": "image/svg+xml" } });
      }
      return real_fetch(url, init);
    });

    const editor = make_editor();
    await editor.set_memo(
      { id: 9, text: "# a memo", timestamp: 100, memogroup: { id: 3, name: "three" } },
      false
    );
    const group_control = editor.shadowRoot?.querySelector("#edit_memogroup") as MemoGroupList;
    const option_before = group_control.shadowRoot?.querySelector('option[value="3"]');

    release_the_first();
    // Wait for the late answer to have rebuilt the control — new option elements are what that
    // looks like — rather than for it to have been fetched, which happens before the rebuild.
    await vi.waitFor(() => {
      const option = group_control.shadowRoot?.querySelector('option[value="3"]');
      expect(option).not.to.be.null;
      expect(option).not.toBe(option_before);
    });

    expect(group_control.value).to.be.equal("3");
    expect((await editor.get_memo())?.memogroup?.id).to.be.equal(3);
  });

  it("should finish opening a memo when the groups cannot be fetched", async () => {
    // The service worker lets the app start with the server unreachable, and then the fetch the
    // group control makes on the way into a memo fails. It is made in the middle of set_memo:
    // an error out of it left the editor holding the memo but not its group, not its read-only
    // state and with nothing said about the save button.
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("memogroup")) {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      }
      if (target.endsWith(".svg")) {
        return new Response("<svg></svg>", { headers: { "Content-Type": "image/svg+xml" } });
      }
      return real_fetch(url, init);
    });
    await forget_cached_memogroups();

    const editor = make_editor();
    await editor.set_memo(
      {
        id: 27,
        text: "# a shared memo",
        timestamp: 100,
        memogroup: { id: 20, name: "someone else's" },
        owned: false,
        readonly: true,
      },
      false
    );

    // Everything after the fetch in set_memo, which is what the throw used to skip.
    const group_control = editor.shadowRoot?.querySelector("#edit_memogroup") as MemoGroupList;
    expect(group_control.value).to.be.equal("20");
    expect((await editor.get_memo())?.memogroup?.id).to.be.equal(20);
    expect(group_control.readonly).to.be.true;
  });

  it("should refuse to save a memo that asks for encryption when no password is given", async () => {
    stub_the_server();
    const editor = make_editor();
    await editor.set_memo({ id: 21, text: "# a memo", timestamp: 100 }, true);

    // Text between these markers asks to be encrypted, and there is no password to do it with.
    editor.value = "# a memo\n「restaurant bill: 120」";
    const saving = editor.save_local_only({ type: "test" });

    // The prompt opens; the reader cancels it, which is what Escape and the Cancel button do.
    await vi.waitFor(() => {
      expect(document.querySelector('dialog button[value="cancel"]')).not.to.be.null;
    });
    (document.querySelector('dialog button[value="cancel"]') as HTMLButtonElement).click();
    await saving;

    // Nothing was written — in particular not the secret in the clear — and the reader is told
    // rather than left to find out.
    expect((await db.read_memo(21))?.text ?? "").not.to.contain("120");
    expect(editor.shadowRoot?.querySelector("#status")?.textContent).to.contain("not saved");
  });

  it("should not go on calling an encrypted memo edited when nothing has changed", async () => {
    stub_the_server();
    await cache_a_memo(22);
    const editor = make_editor();
    await editor.set_memo({ id: 22, text: "# a memo", timestamp: 100 }, true);
    const colour = () =>
      (editor.shadowRoot?.querySelector("#save_all_button") as HTMLElement | null)?.style.color;
    // A password the editor already holds, so the save does not stop at the prompt.
    (editor as unknown as { _password: string })._password = "correct horse battery";

    editor.value = "# a memo\n「restaurant bill: 120」";
    await editor.save_local_only({ type: "test" });
    // Written to this device and not to the server: orange, which is where it stays.
    expect(colour()).to.be.equal("orange");

    // Saving it again writes nothing and says nothing has changed, rather than encrypting the
    // same text a second time — a fresh nonce makes different bytes, which would leave the memo
    // claiming an edit that never happened, and uploading itself on every save.
    await editor.save_local_only({ type: "test" });
    expect(colour()).to.be.equal("orange");
    // The record holds the encrypted form; the editor keeps the text the reader typed.
    expect((await db.read_memo(22))?.text ?? "").not.to.contain("120");
  });

  it("should insert at the very start of a memo", async () => {
    stub_the_server();
    const editor = make_editor();
    await editor.set_memo({ id: 23, text: "# a memo", timestamp: 100 }, true);
    const source = editor.shadowRoot?.querySelector("#source") as HTMLTextAreaElement;

    // The caret at the start of the memo is offset zero, which is not the same as no caret.
    source.selectionStart = 0;
    source.selectionEnd = 0;
    (editor.shadowRoot?.querySelector("#checkbox_button") as HTMLElement).click();

    expect(source.value.startsWith("- [ ] ")).to.be.true;
  });

  it("should react to an edit as it is made, not when the memo is next saved", async () => {
    stub_the_server();
    await cache_a_memo(3);
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

  it("should paint the memo in the colours of the theme the page is showing", () => {
    stub_the_server();
    const editor = make_editor();
    const shown = editor.shadowRoot?.querySelector("#presentation") as HTMLElement;
    // Written straight in rather than rendered: what is being checked is the stylesheet, and a
    // memo rendered through wasm would only mean waiting on a promise that has nothing to do with
    // the colours.
    shown.innerHTML = "<h1>a heading</h1><p>and a paragraph</p>";
    const heading = shown.querySelector("h1") as HTMLElement;

    apply_theme("light");
    // The container *and* what is inside it: the `*` rule puts a background on every element, so a
    // theme applied to #presentation alone would leave the heading dark grey on white.
    expect(getComputedStyle(shown).backgroundColor).to.be.equal("rgb(255, 255, 255)");
    expect(getComputedStyle(heading).color).to.be.equal("rgb(26, 26, 26)");

    apply_theme("paper");
    expect(getComputedStyle(shown).backgroundColor).to.be.equal("rgb(244, 236, 216)");
    expect(getComputedStyle(heading).fontFamily).to.contain("Georgia");
    // No theme narrows the memo: whatever is on, it fills the width it is given. A reading
    // column with margins around it was tried and is not wanted.
    expect(getComputedStyle(shown).maxWidth).to.be.equal("none");
    // The textarea takes the same colours and type, so writing on Paper is not writing on black.
    const source = editor.shadowRoot?.querySelector("#source") as HTMLTextAreaElement;
    expect(getComputedStyle(source).backgroundColor).to.be.equal("rgb(244, 236, 216)");
    expect(getComputedStyle(source).fontSize).to.be.equal("17px");
  });

  it("should put link groups in boxes only under the Links theme", () => {
    stub_the_server();
    const editor = make_editor();
    const shown = editor.shadowRoot?.querySelector("#presentation") as HTMLElement;
    shown.innerHTML =
      "<ul><li>Reading</li><li><a href='#'>one</a></li></ul><ul><li>only words</li></ul>";
    const [with_links, words_only] = Array.from(shown.querySelectorAll("ul")) as HTMLElement[];

    // Every other theme lays a list out exactly as the app always has: bullets, one item per line.
    for (const theme of ["dark", "light", "paper"] as const) {
      apply_theme(theme);
      expect(getComputedStyle(with_links).display, theme).to.be.equal("block");
      expect(getComputedStyle(with_links).listStyleType, theme).to.be.equal("disc");
      expect(getComputedStyle(shown).maxWidth, theme).to.be.equal("none");
      // No extra air either: the spacing between rows belongs to the Links theme like the rest.
      expect(getComputedStyle(with_links.querySelector("li") as HTMLElement).paddingTop, theme)
        .to.be.equal("0px");
    }

    apply_theme("links");
    // The group of links becomes a box, and its first item the title bar over it...
    expect(getComputedStyle(with_links).display).to.be.equal("inline-block");
    expect(
      getComputedStyle(with_links.querySelector("li") as HTMLElement).position
    ).to.be.equal("absolute");
    // ...with air between the links, which is read by scanning down them. (The band under the
    // pointer is the theme's highlight colour; Firefox only applies :hover to a real pointer, so
    // that half is checked in the browser pass rather than here.)
    const a_link = with_links.querySelectorAll("li")[1] as HTMLElement;
    expect(getComputedStyle(a_link).paddingTop).to.be.equal("2px");
    // ...while a list of plain text is left alone even here.
    expect(getComputedStyle(words_only).display).to.be.equal("block");

    // And choosing another theme puts it back.
    apply_theme("dark");
    expect(getComputedStyle(with_links).display).to.be.equal("block");
  });

  it("should leave a barcode legible whatever theme is on", () => {
    stub_the_server();
    const editor = make_editor();
    const shown = editor.shadowRoot?.querySelector("#presentation") as HTMLElement;
    shown.innerHTML = '<div data-gen="barcode13"><span>1234567890123</span></div>';

    apply_theme("light");

    const plate = shown.querySelector("span") as HTMLElement;
    // White behind black bars is what a scanner reads. `#presentation *` would repaint this if
    // the barcode rules were not restated in front of it.
    expect(getComputedStyle(plate).backgroundColor).to.be.equal("rgb(255, 255, 255)");
    expect(getComputedStyle(plate).color).to.be.equal("rgb(0, 0, 0)");

    // And the face that draws the bars, which is the other half of the same rule: a barcode set in
    // a text face is a line of digits. Paper is the theme that changes the memo's font, so it is
    // the one that would take it away.
    apply_theme("paper");
    expect(getComputedStyle(plate).fontFamily).to.contain("Libre Barcode EAN13 Text");
  });

  it("should insert a link that opens where the reader is", async () => {
    stub_the_server();
    const found = vi.spyOn(navigator.geolocation, "getCurrentPosition").mockImplementation((ok) => {
      ok({
        coords: { latitude: 51.507353, longitude: -0.127758 },
      } as GeolocationPosition);
    });

    const editor = make_editor();
    await editor.set_memo({ id: 40, text: "# a memo", timestamp: 100 }, true);
    // The button lives in the editing toolbar, so this is where the reader is when they press it.
    (editor.shadowRoot?.querySelector("#edit_button") as HTMLElement).click();
    const source = editor.shadowRoot?.querySelector("#source") as HTMLTextAreaElement;
    source.selectionStart = source.value.length;
    source.selectionEnd = source.value.length;

    (editor.shadowRoot?.querySelector("#location_button") as HTMLElement).click();
    await vi.waitFor(() => {
      expect(source.value).to.contain("google.com/maps");
    });

    found.mockRestore();
    // The label is the coordinates, and the same ones the link opens: a memo with two of these
    // says where each is rather than "location" twice.
    expect(source.value).to.contain("[51.50735, -0.12776]");
    expect(source.value).to.contain("query=51.50735,-0.12776");
  });

  it("should say why the browser will not say where the reader is", async () => {
    stub_the_server();
    const refused = vi
      .spyOn(navigator.geolocation, "getCurrentPosition")
      .mockImplementation((_ok, failed) => {
        failed?.({
          code: 1,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: "denied",
        } as GeolocationPositionError);
      });

    const editor = make_editor();
    await editor.set_memo({ id: 41, text: "# a memo", timestamp: 100 }, true);
    (editor.shadowRoot?.querySelector("#edit_button") as HTMLElement).click();
    const source = editor.shadowRoot?.querySelector("#source") as HTMLTextAreaElement;
    const before = source.value;

    (editor.shadowRoot?.querySelector("#location_button") as HTMLElement).click();

    await vi.waitFor(() => {
      expect(editor.shadowRoot?.querySelector("#status")?.textContent ?? "").to.contain(
        "not allowed"
      );
    });
    refused.mockRestore();
    // Nothing goes into the memo: a link to nowhere is worse than no link.
    expect(source.value).to.be.equal(before);
  });

  it("should lay its toolbars out as rows without gaps", () => {
    stub_the_server();
    const editor = make_editor();
    const toolbar = editor.shadowRoot?.querySelector("#edit_toolbar") as HTMLElement;
    const button = toolbar.querySelector("img-inline-svg") as HTMLElement;

    // Flex, not inline flow: the whitespace between the tags in the template is a gap between
    // buttons in a sentence, and on a phone that gap is what pushes the last button onto a row of
    // its own. What the icons are worth on a narrow screen is the other half of the same fix; this
    // checks the half a test can hold.
    expect(getComputedStyle(toolbar).display).to.be.equal("flex");
    expect(getComputedStyle(button).flexShrink).to.be.equal("0");
  });

  it("should offer the theme picker wherever the memo is", () => {
    stub_the_server();
    const editor = make_editor();
    const picker = editor.shadowRoot?.querySelector("#edit_theme") as ThemeList | null;

    expect(picker).not.to.be.null;
    // In the metadata row, which is the one row that is on screen in both the reading view and
    // the editor — it is moved between them, so one control serves both.
    expect(picker?.parentElement?.id).to.be.equal("edit_meta");
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
