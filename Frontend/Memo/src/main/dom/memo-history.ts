/**
 * @prettier
 *
 * Every version the server kept of one memo, for the memo's owner.
 *
 * The history endpoint answers with the memo as it is now and every state `memo_write` archived
 * before a change, oldest first. The page puts the memo itself first — it is the newest state —
 * and then the archived versions newest first. That display order is not the order of time: the
 * step before a row is the row under it, and that is what a row is compared with.
 *
 * Each row can be read as rendered markdown or as the source that was stored. A row whose text is
 * exactly the previous step's text gets a red border: the server keeps a version per save, and a
 * save that changed nothing is worth seeing as such. Any row with an earlier version under it can
 * be compared with one of those; the one directly before it is the comparison unless the reader
 * chooses another.
 *
 * The diff is the memo app's wasm `diff`, which is `similar`'s line diff behind a thin wrapper.
 */
import konsole from "./console_log.js";
import {ask_confirmation} from "./confirm.js";
import {UnauthenticatedError, go_to_login} from "./http.js";
import * as server_comm from "./server_comm.js";
import * as events from "./events.js";
import * as memo_processing from "./memo_processing.js";
import {wasm_ready} from "./wasm.js";
import {barcode_layout_css, markdown_notes_css, presentation_css} from "./presentation_css.js";
import type {IdName, MemoHistoryReply, ServerMemo, ServerMemoHistory} from "./memo_interfaces.js";

// @ts-ignore
import {process_markdown} from "../pkg/organizator_wasm.js";

interface Version {
  /// "current" for the memo itself, or `history:<row id>` for an archived version.
  key: string;
  /// The row's id in memo_history; null for the memo itself.
  history_id: number | null;
  /// Its place in the archived sequence, oldest first; null for the memo itself.
  number: number | null;
  current: boolean;
  /// The text as the server stored it: the title row and the body row joined, as a read joins them.
  text: string;
  savetime: number | null;
  saver: string;
  /// The memo's group at this version; null when it had none.
  memogroup: IdName | null;
  /// The same text as the step before it in time: this save changed nothing.
  unchanged: boolean;
  /// The latest archived version, saying exactly what the current memo says. Its newer duplicate
  /// is the memo table's row, which is not in the history; this is the copy that can be removed.
  duplicate_current: boolean;
  /// True while the rendered markdown is showing; false while the stored source is.
  previewing: boolean;
  /// The key of the earlier version this one is compared with, or null where there is none.
  diff_with: string | null;
  /// Null until a diff is asked for, and "" when the two texts are identical.
  diff: string | null;
}

const when_format = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const when = (ms: number | null): string =>
  ms === null ? "unknown time" : when_format.format(ms);

/// The text as the server stored it. `server2local` joins the two columns the same way and takes
/// the carriage returns out; a history row is read with the same rule so it compares with a memo.
const history_text = (version: ServerMemoHistory): string =>
  `${version.title ?? ""}${version.memotext ?? ""}`.replaceAll("\r", "");

const memo_text = (memo: ServerMemo): string =>
  `${memo.title ?? ""}${memo.memotext ?? ""}`.replaceAll("\r", "");

const template = `
  <style>
    :host {
      display: block;
      box-sizing: border-box;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.75rem;
      font-family: var(--memo-font, sans-serif);
      font-size: var(--memo-font-size, 1rem);
      line-height: var(--memo-line-height, normal);
      color: var(--memo-fg, white);
      background-color: var(--memo-bg, black);
    }
    header.page {
      /* The menu button hangs over the top-right corner of the page. */
      padding-right: 3.5rem;
      margin-bottom: 0.75rem;
    }
    h1 { margin: 0 0 0.25rem 0; font-size: 1.3rem; }
    .memo-title {
      margin: 0.2rem 0;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .note {
      margin: 0.2rem 0;
      font-size: 0.9rem;
      opacity: 0.75;
    }
    a { color: var(--memo-link, steelblue); }
    a:focus-visible, button:focus-visible, select:focus-visible {
      outline: 2px solid var(--memo-fg, white);
      outline-offset: 2px;
    }
    .status {
      margin: 0.75rem 0;
      white-space: pre-line;
      opacity: 0.85;
    }
    .status.error { color: var(--memo-danger, red); opacity: 1; }
    .version {
      border: 1px solid var(--memo-border, grey);
      border-radius: 6px;
      padding: 0.6rem 0.75rem;
      margin-bottom: 0.9rem;
    }
    /* A step that changed nothing from the one before it. The border is the mark; the line under
       the heading says the same in words, so the colour is not the only message. */
    .version.unchanged { border: 2px solid var(--memo-danger, red); }
    .version-header {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.3rem 1rem;
      margin-bottom: 0.4rem;
    }
    .version-header h2 { margin: 0; font-size: 1rem; }
    .meta { font-size: 0.9rem; opacity: 0.8; }
    .unchanged-note {
      margin: 0.2rem 0 0.5rem 0;
      color: var(--memo-danger, red);
      font-size: 0.9rem;
      font-weight: 600;
    }
    .toggle, .diff-button, .delete {
      font: inherit;
      color: var(--memo-fg, white);
      background: none;
      border: 1px solid var(--memo-border, grey);
      border-radius: 4px;
      padding: 0.2rem 0.6rem;
      cursor: pointer;
    }
    .delete {
      color: var(--memo-danger, red);
      border-color: var(--memo-danger, red);
    }
    .version-header .toggle { margin-left: auto; }
    .preview, .source, .diff { overflow-wrap: anywhere; }
    .preview > :first-child { margin-top: 0; }
    .preview > :last-child { margin-bottom: 0; }
    .source, .diff {
      margin: 0.4rem 0 0 0;
      padding: 0.6rem;
      border-radius: 4px;
      background-color: var(--memo-pre-bg, #1F1F1F);
      white-space: pre-wrap;
      font-family: monospace;
      font-size: 0.9rem;
    }
    .source { max-height: 30rem; overflow: auto; }
    .diff { max-height: 40rem; overflow: auto; }
    .diff span { display: block; }
    .diff .added { color: var(--memo-this-week, #4ac26b); }
    .diff .removed { color: var(--memo-danger, #ff8a80); }
    .diff .same { opacity: 0.7; }
    .diff-area { margin-top: 0.4rem; }
    .diff-caption { margin: 0 0 0.3rem 0; font-size: 0.9rem; opacity: 0.85; }
    .diff-none { margin: 0.3rem 0 0 0; font-size: 0.9rem; opacity: 0.85; }
    .diff-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.6rem;
      font-size: 0.9rem;
    }
    .diff-controls label {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
    }
    .diff-controls select {
      max-width: 100%;
      padding: 0.15rem;
      font: inherit;
      color: inherit;
      background-color: var(--memo-field-bg, #2b2b2b);
      border: 1px solid var(--memo-border, grey);
      border-radius: 4px;
    }
    ${presentation_css(".preview ")}
    ${barcode_layout_css(".preview ")}
    ${markdown_notes_css(".preview ")}
  </style>
  <header class="page">
    <h1>History</h1>
    <p class="memo-title" id="memo_title"></p>
    <p><a id="back_link" href="/memo/">Back to the memo</a></p>
    <p class="note" id="note" hidden>
      The first item is the memo as the server holds it now; the rest are the versions kept
      before each save, newest first. Changes that have not reached the server are not here.
    </p>
  </header>
  <p id="status" class="status" role="status" aria-live="polite" hidden></p>
  <div id="versions"></div>
`;

export class MemoHistory extends HTMLElement {
  private $: {[key: string]: HTMLElement} = {};
  private ready: Promise<void>;
  private memo_id_value: number | null = null;
  private memo: ServerMemo | null = null;
  private versions: Version[] = [];
  private status_text = "";
  private status_error = false;
  private wasm_ok = false;
  private wasm_loading: Promise<void> | null = null;
  private rendered = new Map<string, string>();
  /// Which load is current. A slow answer for a memo the reader has already left must not draw.
  private load_number = 0;

  constructor() {
    super();
    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    const shadow = this.attachShadow({mode: "open"});
    shadow.innerHTML = template;
    shadow.querySelectorAll<HTMLElement>("[id]").forEach(element => {
      this.$[element.id] = element;
    });

    (this.$["back_link"] as HTMLAnchorElement).addEventListener("click", event => {
      // A link inside a shadow root reaches the router as the host element, not as an anchor, so
      // the router's document listener would not recognise it. This one keeps the trip inside the
      // document; a modified click is left to the browser, as any link's would be.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const id = this.memo_id_value;
      if (id === null) return;
      event.preventDefault();
      events.navigate(`/memo/${id}`);
    });

    this.draw();
  }

  /// Open the history of one memo. The router has already read the id from the path.
  async show(memo_id: number): Promise<void> {
    const token = ++this.load_number;
    this.memo_id_value = memo_id;
    await this.ready;
    if (token !== this.load_number) return;
    await this.load(memo_id, token);
  }

  private async load(memo_id: number, token: number): Promise<void> {
    this.memo = null;
    this.versions = [];
    this.status_text = "";
    this.status_error = false;
    this.draw();

    if (memo_id < 0) {
      this.set_status("History is available once the memo has been saved on the server.");
      return;
    }

    this.set_status("Loading…");
    // The module is a megabyte and may not be here yet; the read and the load run together, and
    // a module that cannot load leaves the rows readable as their own text.
    const history_read = server_comm.read_memo_history(memo_id);
    const wasm_load = this.ensure_wasm();

    let reply: MemoHistoryReply;
    try {
      reply = await history_read;
    } catch (e) {
      if (token !== this.load_number) return;
      if (e instanceof UnauthenticatedError) {
        go_to_login();
        return;
      }
      konsole.error("Failed to read the memo history", e);
      this.set_status(
        e instanceof server_comm.HttpError && e.status === 404
          ? "History is not available for this memo."
          : "Could not read the memo's history.",
        true
      );
      return;
    }
    await wasm_load;
    if (token !== this.load_number) return;

    this.memo = reply.memo;
    const history = reply.history ?? [];
    const current_text = memo_text(reply.memo);

    // The archived versions in time order first, so each can be compared with the step before
    // it; the display then turns them round and puts the memo itself on top as the newest step.
    const archived: Version[] = history.map((version, index) => {
      const text = history_text(version);
      const previous = index > 0 ? history_text(history[index - 1]) : null;
      return {
        key: `history:${version.id}`,
        history_id: version.id,
        number: index + 1,
        current: false,
        text,
        savetime: version.savetime,
        saver: version.saveuser?.name ?? version.user.name ?? "unknown",
        memogroup: version.memogroup ?? null,
        unchanged: previous !== null && previous === text,
        duplicate_current: index === history.length - 1 && text === current_text,
        previewing: true,
        // The step before it, until the reader chooses an earlier one.
        diff_with: index > 0 ? `history:${history[index - 1].id}` : null,
        diff: null,
      };
    });

    const latest = archived[archived.length - 1] ?? null;
    const current: Version = {
      key: "current",
      history_id: null,
      number: null,
      current: true,
      text: current_text,
      savetime: reply.memo.savetime ?? null,
      saver: reply.memo.user?.name ?? "unknown",
      memogroup: reply.memo.memogroup ?? null,
      // The memo's text can be the previous version's text when the last save changed only
      // something outside it, such as the group.
      unchanged: latest !== null && latest.text === current_text,
      // The memo itself is not a history row, and has no delete button of its own.
      duplicate_current: false,
      previewing: true,
      diff_with: latest?.key ?? null,
      diff: null,
    };

    this.versions = [current, ...archived.slice().reverse()];

    if (archived.length === 0) {
      this.set_status("No earlier versions. This memo has not been changed since it was written.");
      return;
    }
    this.set_status("");
  }

  /// The markdown renderer and the diff are both wasm; wait for the one module once, and remember
  /// a load that failed so the page still draws.
  private ensure_wasm(): Promise<void> {
    this.wasm_loading ??= wasm_ready()
      .then(() => {
        this.wasm_ok = true;
      })
      .catch(e => konsole.error("Could not load the markdown renderer for the history", e));
    return this.wasm_loading;
  }

  private set_status(text: string, error: boolean = false): void {
    this.status_text = text;
    this.status_error = error;
    this.draw();
  }

  private draw(): void {
    const title = this.memo?.title?.trim() ?? "";
    this.$["memo_title"].textContent =
      title !== ""
        ? title
        : this.memo_id_value === null
          ? ""
          : `Memo ${this.memo_id_value}`;

    const back = this.$["back_link"] as HTMLAnchorElement;
    back.href = this.memo_id_value === null ? "/memo/" : `/memo/${this.memo_id_value}`;

    this.$["note"].hidden = this.memo === null;

    const status = this.$["status"];
    status.textContent = this.status_text;
    status.classList.toggle("error", this.status_error);
    status.hidden = this.status_text === "";

    this.$["versions"].replaceChildren(
      ...this.versions.map(version => this.draw_version(version))
    );
  }

  private draw_version(version: Version): HTMLElement {
    const article = document.createElement("article");
    article.className = version.unchanged ? "version unchanged" : "version";
    article.dataset.historyId = version.current ? "current" : `${version.history_id}`;

    const header = document.createElement("div");
    header.className = "version-header";

    const heading = document.createElement("h2");
    heading.textContent = version.current ? "Current version" : `Version ${version.number}`;

    const saved_when = document.createElement("span");
    saved_when.className = "meta";
    saved_when.textContent = when(version.savetime);

    const saver = document.createElement("span");
    saver.className = "meta";
    saver.textContent = version.current
      ? "the memo as it is now"
      : `saved by ${version.saver}`;

    const group = document.createElement("span");
    group.className = "meta";
    group.textContent = version.memogroup
      ? `group: ${version.memogroup.name || "(unnamed)"}`
      : "group: none";

    const id = document.createElement("span");
    id.className = "meta";
    id.textContent = version.current
      ? `memo id ${this.memo?.id ?? this.memo_id_value ?? "?"}`
      : `history id ${version.history_id ?? "?"}`;

    const which = version.current ? "the current version" : `version ${version.number}`;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle";
    toggle.textContent = version.previewing ? "Source" : "Preview";
    // The visible word is the accessible name too, with the version it belongs to: "Source of
    // version 2" starts with the "Source" the button shows.
    toggle.setAttribute(
      "aria-label",
      `${version.previewing ? "Source" : "Preview"} of ${which}`
    );

    header.append(heading, saved_when, saver, group, id, toggle);

    // The newer of a duplicate pair is the one to remove: the older one is the state that
    // survives. When the latest history row is the duplicate, its newer pair is the memo table's
    // row, which is not in the history, so this version is the copy that can go.
    if (this.duplicate_reason(version) !== null) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", `Delete duplicate version ${version.number}`);
      remove.addEventListener("click", () => void this.delete_duplicate(version, remove));
      header.append(remove);
    }

    article.append(header);

    if (version.unchanged) {
      const note = document.createElement("p");
      note.className = "unchanged-note";
      note.textContent = "No change from the previous version.";
      article.append(note);
    }

    let content = this.draw_content(version);
    article.append(content);

    toggle.addEventListener("click", () => {
      version.previewing = !version.previewing;
      toggle.textContent = version.previewing ? "Source" : "Preview";
      toggle.setAttribute(
        "aria-label",
        `${version.previewing ? "Source" : "Preview"} of ${which}`
      );
      const next = this.draw_content(version);
      article.replaceChild(next, content);
      content = next;
    });

    // The oldest archived version has no earlier step to be compared with. The memo itself and
    // every other version do, and start with the step directly before them.
    const earlier = this.earlier_versions(version);
    if (earlier.length > 0) article.append(this.draw_diff_controls(version, earlier));

    return article;
  }

  /**
   * Why this version can be deleted, or null when it cannot.
   *
   * A version is removable when it says exactly what the step before it said, or when it is the
   * latest archived version and says exactly what the memo on the server says now. The current
   * memo itself is not a history row and is never removable here.
   */
  private duplicate_reason(version: Version): string | null {
    if (version.current) return null;
    const reasons: string[] = [];
    if (version.unchanged) reasons.push(`version ${(version.number ?? 1) - 1}`);
    if (version.duplicate_current) reasons.push("the current memo on the server");
    if (reasons.length === 0) return null;
    return reasons.length === 1 ? reasons[0] : `${reasons[0]} and ${reasons[1]}`;
  }

  /// Remove the newer of a duplicate pair, after asking. The memo itself is not touched.
  private async delete_duplicate(
    version: Version,
    button: HTMLButtonElement
  ): Promise<void> {
    const memo_id = this.memo?.id ?? this.memo_id_value;
    const history_id = version.history_id;
    const reason = this.duplicate_reason(version);
    if (memo_id === null || memo_id === undefined || history_id === null || reason === null) {
      return;
    }

    const go_ahead = await ask_confirmation({
      question: `Delete version ${version.number} from the history?`,
      detail:
        `It has the same text as ${reason}. Its history-row id is ${history_id}.\n\n` +
        "The memo itself is not changed; only this archived version is removed.",
      confirm_label: "Delete it",
    });
    if (!go_ahead) return;

    button.disabled = true;
    button.textContent = "Deleting…";
    try {
      await server_comm.delete_memo_history(history_id);
      // The version numbers, the red borders and the duplicate buttons are all decided from
      // the rows that are left, so the page is read again rather than patched.
      const token = ++this.load_number;
      await this.load(memo_id, token);
    } catch (e) {
      if (e instanceof UnauthenticatedError) {
        go_to_login();
        return;
      }
      konsole.error("Failed to delete the history version", e);
      this.set_status(
        e instanceof server_comm.HttpError && e.status === 409
          ? "That version is not a duplicate any more."
          : "Could not delete that history version.",
        true
      );
    }
  }

  /// The versions before this one in time, newest first — the order the page shows them in.
  private earlier_versions(version: Version): Version[] {
    return this.versions.filter(other => {
      if (other.current) return false;
      if (version.current) return true;
      return (
        version.number !== null && other.number !== null && other.number < version.number
      );
    });
  }

  private draw_content(version: Version): HTMLElement {
    if (!version.previewing) {
      const source = document.createElement("pre");
      source.className = "source";
      source.textContent = version.text;
      return source;
    }

    const preview = document.createElement("div");
    preview.className = "preview";
    const html = this.render(version.text);
    if (html === null) {
      // The module is still on its way, or could not be loaded: show what was stored rather than
      // an empty box.
      preview.textContent = version.text;
      preview.style.whiteSpace = "pre-wrap";
    } else {
      preview.innerHTML = html;
    }
    return preview;
  }

  private render(text: string): string | null {
    if (!this.wasm_ok) return null;
    const already = this.rendered.get(text);
    if (already !== undefined) return already;

    // The same rule the editor reads a memo by: a text that does not begin with a heading is the
    // body of one, and is shown as it was typed rather than as markdown prose.
    let markdown = text;
    if (!markdown.startsWith("#")) markdown = "```\n" + markdown + "\n```";
    const html = process_markdown(markdown, 16);
    this.rendered.set(text, html);
    return html;
  }

  private draw_diff_controls(version: Version, earlier: Version[]): HTMLElement {
    const wrap = document.createElement("div");
    const controls = document.createElement("div");
    controls.className = "diff-controls";

    const label = document.createElement("label");
    label.textContent = "Diff from";

    const select = document.createElement("select");
    // Only the versions before this one in time: the diff reads as what changed on the way to
    // it, and any pair can still be compared by choosing the older one from the later row.
    for (const other of earlier) {
      const other_label = other.current ? "the current version" : `Version ${other.number}`;
      select.append(new Option(`${other_label} — ${when(other.savetime)}`, other.key));
    }

    // The step directly before this one is the default; a version that has gone (a reload, say)
    // falls back to the newest of the earlier ones.
    if (
      version.diff_with === null ||
      !earlier.some(other => other.key === version.diff_with)
    ) {
      version.diff_with = earlier[0]?.key ?? null;
    }
    if (version.diff_with !== null) select.value = version.diff_with;
    label.append(select);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "diff-button";
    button.textContent = version.diff === null ? "Show diff" : "Hide diff";

    const area = document.createElement("div");
    area.className = "diff-area";
    if (version.diff !== null) area.append(this.draw_diff(version));

    select.addEventListener("change", () => {
      version.diff_with = select.value;
      this.hide_diff(version, button, area);
    });

    button.addEventListener("click", () => {
      if (version.diff !== null) {
        this.hide_diff(version, button, area);
        return;
      }
      const base = this.versions.find(other => other.key === version.diff_with);
      if (base === undefined) return;
      if (!this.wasm_ok) {
        area.replaceChildren(this.diff_message("The diff is not available."));
        return;
      }
      try {
        version.diff = base.text === version.text ? "" : memo_processing.diff(base.text, version.text);
      } catch (e) {
        konsole.error("Failed to produce the diff", e);
        area.replaceChildren(this.diff_message("Could not produce a diff for these versions."));
        return;
      }
      button.textContent = "Hide diff";
      area.replaceChildren(this.draw_diff(version));
    });

    controls.append(label, button);
    wrap.append(controls, area);
    return wrap;
  }

  private hide_diff(version: Version, button: HTMLButtonElement, area: HTMLElement): void {
    version.diff = null;
    button.textContent = "Show diff";
    area.replaceChildren();
  }

  private diff_message(text: string): HTMLElement {
    const message = document.createElement("p");
    message.className = "diff-none";
    message.textContent = text;
    return message;
  }

  private draw_diff(version: Version): HTMLElement {
    const wrap = document.createElement("div");
    const base = this.versions.find(other => other.key === version.diff_with);
    if (base === undefined) {
      return this.diff_message("The version to compare with is not here.");
    }

    const label_of = (one: Version) =>
      one.current ? "the current version" : `version ${one.number}`;
    const caption = document.createElement("p");
    caption.className = "diff-caption";
    caption.textContent = `Changes from ${label_of(base)} to ${label_of(version)}`;
    wrap.append(caption);

    if (version.diff === "") {
      wrap.append(this.diff_message("No changes between these versions."));
      return wrap;
    }

    const pre = document.createElement("pre");
    pre.className = "diff";
    const diff = version.diff ?? "";
    // The diff ends every line with a newline, including the last; the split would otherwise
    // leave an empty line at the end.
    const body = diff.endsWith("\n") ? diff.slice(0, -1) : diff;
    for (const line of body.split("\n")) {
      const span = document.createElement("span");
      span.className = line.startsWith("+") ? "added" : line.startsWith("-") ? "removed" : "same";
      span.textContent = line;
      pre.append(span);
    }
    wrap.append(pre);
    return wrap;
  }
}

customElements.define("memo-history", MemoHistory);
