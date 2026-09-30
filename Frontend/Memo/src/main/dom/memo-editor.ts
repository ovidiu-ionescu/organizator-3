/**
 * @prettier
 *
 * Component for editing a memo
 */

import * as db from "./memo_db.js";
import konsole from "./console_log.js";
import * as server_comm from "./server_comm.js";
import {GroupList, HasType, IdName, Memo, PasswordThen, Undef} from "./memo_interfaces.js";
import {raspandac} from "./events.js";
import * as events from "./events.js";
import "./img-inline-svg.js";
import "./group-list.js";
import * as memo_processing from "./memo_processing.js";
import {alignedText, digestMessage} from "./util.js";
import { promptPassword} from "./password.js";

// @ts-ignore
import {memo_decrypt, memo_encrypt, process_markdown,} from "../pkg/organizator_wasm.js";
import {MemoGroupList} from "./group-list";
import {wasm_ready} from "./wasm.js";

const template = `
    <style>
      :host {
        height: 100%;
        display: flex;
        flex: 1;
      }
      #editing {
        display: flex;
        flex-flow: column;
        flex: 1;
      }
      #source {
        resize: none;
        width: 100%;
        min-height: 20px;
        padding: 5px;
        overflow: scroll;
        box-sizing: border-box;
        flex: 1;
        font-size: 16px;
      }
      * {
        font-family: sans-serif;
        background-color: #1F1F1F;
        color: white;
      }
      #presentation {
        padding: 0;
        flex: 1;
        margin-top: 10px;
      }
      #presentation del {
        color: gray;
      }
      #presentation  a {
        color: steelblue;
      }
      #presentation img {
        max-width: 100%;
      }
      #presentation pre code {
        color: yellow;
      }
      #container {
        position: relative;
        margin: 5px 2px 10px 2px;
        padding: 1px 2px 1px 5px;
        border-radius: 10px;
        display: flex;
        flex-flow: column;
        flex: 1;
      }
      #expand_img {
        position: absolute;
        top: 0;
        right: 0;
        border-radius: 10px;
      }
      nav img, img-inline-svg {
        width: 48px;
      }
      #modal_password {
        position: fixed;
        top: 0;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
        height: 100%;
        backdrop-filter: blur(2px);
        justify-content: center;
        background-color: rgb(0,0,0,0.3);
        display: none;
      }
      #password_dialog {
        display: inline-block;
        width: 300px;
        margin: 0 auto 0 auto;
        border-radius: 10px;
        box-shadow: 5px 5px #101010;
        position: absolute;
        top: 150px;
        left:0;
        right: 0;
        background-color: #383838;
        padding: 0 10px 0 10px;
        opacity: 1;
      }
      #password_dialog * {
        background-color: #383838;
      }
      #password_dialog footer {
        text-align: right;
      }
      #password_dialog input {
        font-size: 16px;
        border-radius: 5px;
      }
      #password {
        width: 100%;
      }
      #edit_meta {
        display: flex;
        justify-content: space-between;
      }
      #edit_meta:has(+ #presentation) {
        border-bottom: 1px solid white;
      }
      #presentation table, #presentation th, #presentation td {
        border: 1px solid grey;
        border-collapse: collapse;
      }
      #presentation th, #presentation td {
        padding: 3px;
      }
      #presentation p {
/*
        overflow-wrap: anywhere;
        word-break: break-all;
*/
      }
      #status {
        padding: 2px;
        /* a report is one line per memo that was left behind */
        white-space: pre-line;
      }
      
      div[data-gen="barcode"] {
        text-align: center;
      }
      div[data-gen="barcode-text"] {
        text-align: center;
      }
      
      div[data-gen="barcode128"], div[data-gen="barcode13"] {
        text-align: center;
      }
      div[data-gen="barcode128"] span, div[data-gen="barcode13"] span  {
        border-width: 10px 40px 10px 40px;
        border-style: solid;
        border-color: white;
        color: black;
        background-color: white;
        margin: 10px;
        display: inline-block;
      }
      div[data-gen="barcode128"] span {
        font-family: "Libre Barcode 128 Text", system-ui;
        font-size: 65px;
      }
      div[data-gen="barcode13"] span {
        font-family: "Libre Barcode EAN13 Text", system-ui;
        font-size: 200px;
      }
    </style>
    
    <div id="container">
      <nav id="toolbar">
        <img-inline-svg id="password_button" src="/images/vpn_key-white-48dp.svg" title="password"></img-inline-svg>
        <img-inline-svg id="decrypt_button" src="/images/ic_lock_open_48px.svg" title="decrypt"></img-inline-svg>
        <img-inline-svg id="encrypt_button" src="/images/ic_lock_48px.svg" title="encrypt"></img-inline-svg>
        <img-inline-svg id="edit_button" src="/images/ic_create_48px.svg" title="toggle edit/view"></img-inline-svg>
        <img-inline-svg id="share_button" src="/images/share-white-48dp.svg" title="show sharing status"></img-inline-svg>
        <img-inline-svg id="journal_button" src="/images/menu_book-white-48dp.svg" title="event journal (for debugging)"></img-inline-svg>
      </nav>
      <!-- Above the memo rather than below it: what a save did is read before the text is, not
           after scrolling to the end of it. -->
      <footer id="status"></footer>
      <!-- <img id="expand_img" src="/images/ic_expand_more_48px.svg"> -->
      <div id="presentation">Loading...</div>
      <div id="editing" style="display: none">
        <nav id="edit_toolbar">
          <img-inline-svg id="today_button" src="/images/ic_today_48px.svg" title="insert date"></img-inline-svg>
          <img-inline-svg id="checkbox_button" src="/images/check_box-white-48dp.svg" title="insert markdown checkbox"></img-inline-svg>
          <img-inline-svg id="link_button" src="/images/ic_link_48px.svg" title="insert markdown link"></img-inline-svg>
          <img-inline-svg id="table_button" src="/images/border_all-white-48dp.svg" title="insert markdown table"></img-inline-svg>
          <img-inline-svg id="crypto_button" src="/images/enhanced_encryption-white-48dp.svg" title="insert secret info"></img-inline-svg>
          <img-inline-svg id="upload_button" src="/images/publish-white-48dp.svg" title="insert image (or any file)"></img-inline-svg>
          <input type="file" id="file_upload" style="display: none">
          <img-inline-svg id="save_all_button" src="/images/save_alt-24px.svg" title="save to server"></img-inline-svg>
        </nav>
        <div id="edit_meta">
          <span id="edit_user"></span>
          <time id="edit_timestamp"></time>
          <memogroup-list id="edit_memogroup" title="sharing"></memogroup-list>
        </div>
        <textarea id="source" autocomplete="off" ></textarea>
      </div>
    </div>
`;

declare global {
  interface Date {
    toIsoString: () => string;
  }
}

Date.prototype.toIsoString = function () {
  let tzo = -this.getTimezoneOffset(),
    dif = tzo >= 0 ? "+" : "-",
    pad = (num) => num.toString().padStart(2, '0');
  return (
    this.getFullYear() +
    "-" +
    pad(this.getMonth() + 1) +
    "-" +
    pad(this.getDate()) +
    "T" +
    pad(this.getHours()) +
    ":" +
    pad(this.getMinutes()) +
    ":" +
    pad(this.getSeconds()) +
    dif +
    pad(tzo / 60) +
    ":" +
    pad(tzo % 60)
  );
};

type MyElement = HTMLElement & HTMLInputElement & PasswordThen;
export class MemoEditor extends HTMLElement {
  private $: { [key: string]: MyElement } = {};
  private _edit: Undef<boolean>;
  private _memoId: Undef<number>;
  private _memogroup: Undef<IdName>;
  private _user: Undef<IdName>;
  private _timestamp: Undef<number>;
  private _readonly: Undef<boolean>;
  private _owned: Undef<boolean>;
  private _uploading: Undef<boolean>;
  private _digest: Undef<string>;
  private _password: Undef<string>;
  /// The text as it stood when it was last in step with the local database, and whether the
  /// cached record says that copy still holds changes the server has not seen. Between saves
  /// these two are what the save button's colour is decided from.
  private _saved_text: Undef<string>;
  private _dirty: Undef<boolean>;

  constructor() {
    super();
    this.initialize();
  }

  get memoId(): Undef<number> {
    return this._memoId;
  }
  async initialize() {
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = template;

    // build a cache of elements with an id
    shadow.querySelectorAll<MyElement>("[id]").forEach((e) => {
      this.$[e.id] = e;
    });

    // show the password dialog
    this.$.password_button.addEventListener("click", async () => {
      const pwd = await promptPassword(this._password);
      this._password = pwd ? pwd : this._password;
    });

    this.$.decrypt_button.addEventListener("click", async () => {
      konsole.log(`Starting decryption of memo ${this._memoId}`);
      const password = await this._get_password();
      const clear_text = memo_decrypt(this.$.source.value, password);
      if (this._edit) {
        this.value = clear_text;
      } else {
        this.$.presentation.innerHTML = process_markdown(clear_text, 0);
      }
    });

    this.$.encrypt_button.addEventListener("click", async () => {
      this.value = await this._encrypt();
      this.save_local_only({ type: "Encryption button" });
    });

    // Editing
    this.$.edit_button.addEventListener("click", () => {
      if (this._readonly) {
        return;
      }
      if (this._edit) {
        this._show_presentation();
      } else {
        this._show_editor();
      }
    });

    this.$.share_button.addEventListener("click", () => {
      this._show_sharing();
    });

    this.$.crypto_button.addEventListener("click", async () => {
      if (!this._edit) return;
      await this._get_password();

      const start_quote = "\u300c";
      const end_quote = "\u300d";

      const start_offset = this.$.source.selectionStart ?? undefined;
      const end_offset = this.$.source.selectionEnd ?? undefined;
      let s = this.$.source.value;
      s = s.slice(0, end_offset) + end_quote + s.slice(end_offset);
      s = s.slice(0, start_offset) + start_quote + s.slice(start_offset);
      this.$.source.value = s;
    });

    /**
     * It will insert the text into the memo.
     * If the parameter is a function, will insert into the memo the processing
     * of the selection
     * @param process
     */
    const insertText = (process) => {
      const editor = this.$.source;
      const start_offset = editor.selectionStart;
      const end_offset = editor.selectionEnd;
      if(! start_offset || !end_offset) {
        return;
      }
      const toInsert = (process instanceof Function) ?
        process(editor.value.substring(start_offset, end_offset))
        : process;
      if(toInsert) {
        let s = editor.value;
        editor.value = s.substring(0, start_offset) + toInsert + s.substring(end_offset);
        editor.selectionStart = start_offset;
        editor.selectionEnd = start_offset + toInsert.length;
        // Writing the value in code raises no input event, and the memo has changed just as much
        // as if it had been typed — the button should say so.
        editor.dispatchEvent(new Event("input"));
      }
    };

    this.$.today_button.addEventListener("click", () => {
      const today = new Date().toISOString().substring(0, 10);
      insertText(`\n_${today}_  \n`);
    });

    this.$.checkbox_button.addEventListener("click", async () => {
      insertText("- [ ] ");
    });

    this.$.link_button.addEventListener("click", async () => {
      insertText(s => {
        let text = "";
        try {
          text = new URL(s).hostname;
        } catch (error) {}
        return `[${text}](${s})`;
      });
    });

    this.$.table_button.addEventListener("click", async () => {
      insertText(alignedText`
      | head1 | head2 |  | 
      |:---|---|---:|
      | cell 1 | cell2 |  |
      |  |  |  |
      `);
    });

    this.$.save_all_button.addEventListener("click", async () => {
      await this.save_local_only({ type: "Sync with server" });
      await server_comm.save_all();
    });

    // React to an edit as it is made, rather than when the memo next reaches the database.
    this.$.source.addEventListener("input", () => this._show_save_colour());

    // pasting links
    this.$.source.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text?.startsWith("http://") && !text?.startsWith("https://")) return;
      event.preventDefault();
      insertText(`[${new URL(text).hostname}](${text})`);
    });

    this.$.source.addEventListener("click", (event) => {
      const editor = this.$.source;
      const interestPoint = editor.selectionStart;
      if(interestPoint !== null) {
        const new_text = memo_processing.toggle_checkbox(
            editor.value,
            interestPoint
        );
        if (new_text) {
          editor.value = new_text;
          editor.selectionStart = interestPoint;
          editor.selectionEnd = interestPoint;
          editor.dispatchEvent(new Event("input"));
        }
      }
    });

    this.$.upload_button.addEventListener('click', (event) => {
      if(this._uploading) {
        konsole.log('upload already in progress, debouncing');
        return;
      }
      this._uploading = true;
      this.$.file_upload.click();
      setTimeout(() => this._uploading = false, 2000);
    });

    this.$.file_upload.addEventListener('change', async (event) => {
      let filename: Undef<string>;
      let original_filename: Undef<string>;
      for(let i = 0; i < 3 && !filename; i++) {
        if(i) {
          konsole.log(`Attempt ${i + 1} to upload file`);
        }
       [filename, original_filename] = await server_comm.upload_file(this.$.file_upload, this.$.edit_memogroup.value);
      }
      if(!filename) {
        konsole.error(`will not create a link, upload did not succeed`);
        return;
      }
      const editor = this.$.source;
      // remove leading ! if file type can not be displayed by the browser
      const fileExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']);
      const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
      const prefix = fileExtensions.has(extension) ? '!' : '';
      const fileLink= `\n${prefix}[${original_filename}](/files/${filename})\n`;
      //editor.value = `${editor.value}\n`;
      insertText(fileLink);
    });

    // listen to saving events
    raspandac.on("savingEvent", (event) => {
      konsole.log("Received saving event", event);
      this.$.status.innerText = event.detail;
      // Not this._memoId = undefined. A status line is a message to show, not a reason to forget
      // which memo is open: save_local_only returns early when there is no memo, so clearing it
      // here meant a single database error — the only thing that emits this today — stopped the
      // editor saving anything at all until the page was reloaded. show_status clears it where
      // that is the point, because there really is no memo to hold.
    });

    raspandac.on("saveAllStatus", event => {
      konsole.log(
        `Received saveAllStatus event, detail ${event.detail}`
      );
      this.$.save_all_button.style.color = (event as CustomEvent).detail;
      konsole.log(`Button color is: [${this.$.save_all_button.style.color}]`);
    });

    // What a save-all run did with the memos it could not save. Deliberately not the
    // savingEvent above: that one clears the memo this editor is holding, and a report about a
    // save is no reason to stop editing.
    raspandac.on("saveAllReport", event => {
      konsole.log(`Received saveAllReport event, detail ${event.detail}`);
      this.$.status.innerText = event.detail;
    });

    raspandac.on("memoChangeId", (event: CustomEvent) => {
      konsole.log(
        `Received memoChangeId event, detail ${event.detail}`
      );
      if (event.detail.old_id === this._memoId) {
        this._memoId = event.detail.new_id;
        window.history.replaceState(null, "", `/memo/${event.detail.new_id}`);
      }
    });

    raspandac.on("memoDeleted", (event: CustomEvent) => {
      konsole.log(
        `Received memoDeleted event, detail ${event.detail}`
      );
      if (this.memoId === event.detail) {
        this.show_status(`# Memo ${this.memoId} has been deleted`);
      }
    });

    // save every time we might get rid of the page content
    const save = this.save_local_only.bind(this);
    window.addEventListener("blur", save);
    window.addEventListener("beforeunload", save);
    window.addEventListener("pagehide", save);
    window.addEventListener("pageshow", save);
    window.addEventListener("popstate", save);
    raspandac.on("navigate", save);

    this.$.journal_button.addEventListener("click", (evt) => {
      evt.stopPropagation();
      events.navigate("/journal");
    });
  } // end of initialize

  _show_presentation() {
    this._move_header_in_presentation();
    this.$.presentation.style.display = "block";
    this.$.editing.style.display = "none";
    this._edit = false;
    this._display_markdown();
  }
  _show_editor() {
    this._move_header_in_editor();
    this.$.presentation.style.display = "none";
    this.$.editing.style.display = "";
    this._edit = true;
  }

  _move_header_in_presentation() {
    const header = this.$.edit_meta;
    header.parentElement?.removeChild(header);
    konsole.log(`insert memo header before presentation`);
    const target = this.$.presentation;
    target?.parentNode?.insertBefore(header, target);

  }

  _move_header_in_editor() {
    const header = this.$.edit_meta;
    header.parentElement?.removeChild(header);
    konsole.log(`insert memo header before source`);
    const target = this.$.source;
    target?.parentNode?.insertBefore(header, target);
  }

  _resizeTextArea() {
    console.log('_resizeTextArea', this.$.source.scrollHeight, this.$.source.style.height);
    let scrollHeight = this.$.source.scrollHeight;
    if (scrollHeight > 400) scrollHeight = 400;
    this.$.source.style.height = scrollHeight + "px";
  }

  connectedCallback() {
    this._resizeTextArea();
  }

  set memoId(memoId: number) {
    this._memoId = memoId;
  }

  set memogroup(memogroup: Undef<IdName>) {
    this._memogroup = memogroup;
  }

  _display_markdown() {
    let text = this.$.source.value;
    if (!text.startsWith("#")) {
      text = "```\n" + text + "\n```";
    }
    wasm_ready().then(() => {
      this.$.presentation.innerHTML = process_markdown(text, 16);
    });
  }

  set value(markdown: string) {
    this.$.source.value = markdown;
    this._display_markdown();
    if (this.isConnected) this._resizeTextArea();
  }

  async _get_password() {
    if (this._password) {
      return Promise.resolve<string>(this._password);
    }
    const pwd = await promptPassword(this._password);
    this._password = pwd ? pwd : this._password;
    return pwd;
  }
  __get_password() {
    if (this.$.password.value) {
      return Promise.resolve<string>(this.$.password.value);
    }
    return new Promise<string>((resolve, reject) => {
      this.$.password.then = { resolve, reject };
      this.$.modal_password.style.display = "flex";
    });
  }

  async _encrypt() {
    let src = this.$.source.value;
    if (src.indexOf("\u300c") > -1) {
      const password = await this._get_password();
      return memo_encrypt(this.$.source.value, password, +new Date());
    } else {
      return src;
    }
  }

  async save_local_only(event: HasType) {
    const cause = (event && event.type) || "no event supplied";
    if (!this._memoId) {
      konsole.log("save_local_only, triggered by", cause, "; no memo in the editor, nothing to save");
      return;
    }
    const current_memo = await this.get_memo();
    if(current_memo === undefined) {
      konsole.log("Current memo is undefined, probably has no id, not saving");
      return
    }
    const digest = await digestMessage(current_memo.text);
    if(this._digest === digest && this._memogroup === current_memo.memogroup) {
      konsole.log("save_local_only, triggered by", cause, "; digest and memogroup are identical, no need to save");
      // Nothing was written, so nothing about the record has changed — but the reader may have
      // typed and undone since the button was last coloured, so let it catch up.
      this._show_save_colour();
      return;
    }
    konsole.log(`save_local_only ${this._memoId}, triggered by: ${cause}`);
    let saved_memo: Memo;
    try {
      saved_memo = await db.save_local_only(current_memo);
      // Say so, because the record has changed and anything drawn from it is now out of date.
      // The list of titles is the one that matters: it draws its markers from the cache, and
      // without this a memo edited and left behind went on looking untouched until the list
      // happened to be drawn again.
      events.memo_saved_locally(this._memoId);
    } catch (e) {
      // Writing to this device's database failed, which is the one thing the red button means:
      // the memo is not on the server and it is not here either, so there is nothing left to
      // retry from. Failing to *sync* is the other thing — the memos are safe locally and the
      // button stays orange, where "not on the server yet" already lives.
      konsole.error(
        `save_local_only ${this._memoId} could not be written to the local database`,
        e
      );
      events.save_all_status(events.SaveAllStatus.Failed);
      // The red button alone says something is wrong; this says what, and what to do about it.
      // The text on screen is all that is left of the memo — the database did not take it — so
      // copying it out is the one thing that helps.
      this.$.status.innerText =
        `Could not save memo ${this._memoId} to this device's database, and it is not on the ` +
        `server either. Copy the text somewhere safe before closing the page.`;
      return;
    }
    if (saved_memo.timestamp && this._timestamp && (saved_memo.timestamp > this._timestamp)) {
      konsole.log(
        `save_local_only ${this._memoId}, save happened, current timestamp: ${this._timestamp ? new Date(this._timestamp).toIsoString(): "none"}, cache timestamp ${new Date(saved_memo.timestamp).toIsoString()}`
      );
      this._timestamp = saved_memo.timestamp;
      this._display_timestamp();
      this._digest = digest;
    } else {
      konsole.log(
        `Save local of memo ${this._memoId} did not happen, we didn't get a new timestamp, old ${this._timestamp}, new ${saved_memo.timestamp}`
      );
    }
    // Whatever the database made of it, this is what the editor has written and what the record
    // now says about it — so this is what the button should be coloured from.
    this._saved_text = current_memo.text;
    this._dirty = saved_memo.dirty;
    this._show_save_colour();
  }

  new_memo() {
    this._memoId = -+new Date();
    konsole.log("New memo in editor", this._memoId);
    window.history.replaceState(null, "", `/memo/${this._memoId}`);
    this.memogroup = undefined;
    this._user = undefined;
    this.$.edit_user.innerText = "";
    this._timestamp = 0;
    this.$.source.value = "";
    this.$.edit_memogroup.value = "-1";
    this._readonly = false;
    // Whoever writes a new memo owns it, so the group is theirs to choose from the start.
    this._show_memogroup_editable(true);
    this._digest = undefined;
    // Empty, unsaved and unchanged: neutral, like any other memo just opened. Nothing is stored
    // yet, so the empty text is what the editor has written.
    this._saved_text = "";
    this._dirty = false;
    this._show_save_colour();
    this._show_editor();
  }

  /**
   * Extracts a full memo structure. It is always encrypted
   */
  async get_memo(): Promise<Undef<Memo>> {
    // Every memo should have an id
    // TODO investigate the case where it does not have one
    if(this._memoId === undefined) {
      return;
    }
    const encrypted_source = await this._encrypt();
    return {
      id: this._memoId,
      memogroup: (this.$.edit_memogroup as unknown as GroupList).memogroup,
      text: encrypted_source,
      user: this._user,
      timestamp: this._timestamp,
      readonly: this._readonly,
    };
  }

  async set_memo(memo: Memo, from_local: boolean) {
    konsole.log("Activating memo in editor", memo.id);

    await this.save_local_only({ type: "set_memo" });

    this._memoId = memo.id;
    this._memogroup = memo.memogroup;
    this._user = memo.user;
    this.value = memo.text;
    // maybe just keeping a full copy of the text is better
    this._digest = await digestMessage(memo.text);
    this.$.edit_user.innerText = memo?.user?.name ?? "";
    await (this.$.edit_memogroup as unknown as MemoGroupList).build_options(!from_local);
    if (memo.memogroup) {
      this.$.edit_memogroup.value = memo.memogroup.id.toString();
    } else {
      this.$.edit_memogroup.value = "-1";
    }
    this._timestamp = memo.timestamp;
    this._readonly = !!memo.readonly;
    this._show_memogroup_editable(memo.owned);
    this._display_timestamp();

    // Whatever the memo before this one did is not news about this one. The text now in the
    // editor is what was last written, and the cached record says whether that copy still holds
    // changes the server has not seen — from those two the button gets its colour.
    this._saved_text = memo.text;
    this._dirty = memo.dirty;
    this._show_save_colour();

    this._show_presentation();
  }

  /**
   * Display some status text like loading... etc
   * @param text
   */
  show_status(text: string) {
    konsole.log("Display status in editor", text);
    this._memoId = undefined;
    this._memogroup = undefined;
    this._user = undefined;
    this.value = text;
    this.$.edit_user.innerText = "";
    this.$.edit_memogroup.value = "-1";
    this._timestamp = undefined;
    this._readonly = true;
    // There is no memo here, so there is nothing to change the group of.
    this._show_memogroup_editable(undefined);
    // Neither is there anything to save, and no memo for a text to be in step with.
    this._saved_text = undefined;
    this._dirty = undefined;
    events.save_all_status(events.SaveAllStatus.Neutral);
    this._display_timestamp();
    this._show_presentation();
  }

  _display_timestamp() {
    if (!this._timestamp) {
      return "";
    }
    this.$.edit_timestamp.innerText = new Date(this._timestamp).toIsoString();
  }

  /**
   * Colour the save button for what is in the editor at this moment.
   *
   * The button follows the editing, not only the database, and it says which of the two places
   * the memo has reached. Text that has moved on from what was last written is in this browser
   * and nowhere else, which is its own colour; once written it is in the local database and
   * waiting for the server, which is the other one. Putting the text back the way it was puts
   * the colour back with it, rather than leaving it claiming a change that is no longer there.
   */
  _show_save_colour() {
    const edited = this.$.source.value !== this._saved_text;
    if (edited) {
      events.save_all_status(events.SaveAllStatus.Edited);
    } else if (this._dirty) {
      events.save_all_status(events.SaveAllStatus.Dirty);
    } else {
      events.save_all_status(events.SaveAllStatus.Neutral);
    }
  }

  /**
   * Whether the reader may put this memo in another group: only its owner may, and the server
   * refuses it for anybody else (2F002). This only takes the control away — enforcement is the
   * trigger on memo, not a disabled dropdown.
   *
   * A memo that has not said whose it is keeps the control enabled. Unknown ownership is not a
   * reason to take an action away from the owner, and a memo that is only cached, or being
   * edited offline, may not have been asked yet. If it turns out to be somebody else's, the save
   * is refused and the reader is told.
   */
  _show_memogroup_editable(owned: Undef<boolean>) {
    this._owned = owned;
    const list = this.$.edit_memogroup as unknown as MemoGroupList;
    if (list) {
      list.readonly = owned === false;
    }
  }

  async _show_sharing() {
    const memogroup_id = (this.$.edit_memogroup as unknown as GroupList)?.memogroup?.id;
    if(!memogroup_id) {
      konsole.log(`Memo ${this._memoId} has no extra permissions`);
      return;
    }
    const DIVID = "explicit_permissions";
    let perm_div = this.$.presentation.querySelector(`#${DIVID}`);
    if(perm_div) {
      konsole.log(`Hide explicit permissions for memo ${this._memoId}`)
      perm_div.parentNode!.removeChild(perm_div);
      return;
    }

    const permission_lines = await server_comm.get_explicit_permission(memogroup_id);
    perm_div = document.createElement("div");
    perm_div.id = DIVID;
    this.$.presentation.insertBefore(perm_div, this.$.presentation.firstChild);
    const title = document.createElement("h3");
    title.innerText = permission_lines?.length ? permission_lines[0].memo_group_name : `No extra rights defined`;
    perm_div.appendChild(title);
    const dl = perm_div.appendChild(document.createElement("dl"));
    let ug = "";
    const PERM = [' ', 'R', 'W'];
    if(permission_lines)
    permission_lines.forEach(p => {
      if(p.user_group_name != ug) {
        ug = p.user_group_name;
        dl.appendChild(document.createElement("dt")).innerText = `${p.user_group_name}: ${PERM[p.access]}`;
      }
      dl.appendChild(document.createElement('dd')).innerText = p.username;
    })
  }
}

konsole.log("Registering memo-editor web component");
customElements.define("memo-editor", MemoEditor);
