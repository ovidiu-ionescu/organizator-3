/**
 * @prettier
 *
 * Component that builds drop down list
 */

import { IdName, Undef } from "./memo_interfaces.js";
import { read_memo_groups } from "./server_comm.js";
import konsole from "./console_log.js";

class SelectList extends HTMLElement {
  private _groups: IdName[] | undefined;
  private _readonly = false;
  private readonly _fetch_elements: () => Promise<IdName[]>;
  constructor(fetch_elements: () => Promise<IdName[]>) {
    super();
    this._fetch_elements = fetch_elements;
    this.initialize().catch(err => konsole.error("Failed to initialize SelectList", err));
  }

  async initialize() {
    const shadow = this.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>
        * {
          font-family: sans-serif;
          background: #1F1F1F;
          color: white;
        }
        select {
          border: none;
          text-align: center;
        }
        select, option {
          -webkit-appearance: none; /* WebKit/Chromium */
          -moz-appearance: none; /* Gecko */
           appearance: none; /* future (or now) */
        }
      </style>
      <select id="main_select">
        <option value="-1" style="text-align:center;"> --- </option>
      </select>
    `;
    await this.build_options();
  }

  async build_options(force_refresh: boolean = false) {
    konsole.log("Build options");
    if (!this._groups ||force_refresh) {
      try {
        this._groups = await this._fetch_elements();
      } catch (e) {
        // Offline, or the server would not say: the reader's groups are not known and the
        // control goes on showing what it was showing. This is called while a memo is being
        // opened — show_group puts that memo's own group in a moment later — and an error here
        // used to cost the memo the rest of its setup: its group, who owns it, whether it is
        // read only, and the colour of the save button.
        konsole.log("Could not fetch the groups, keeping the control as it is", e);
        return;
      }
    }
    const sel = this.shadowRoot!.querySelector("#main_select") as HTMLSelectElement;
    // What the control is showing survives being filled again. It is where the editor reads the
    // group it is about to save, and the options are fetched twice over: once when the component
    // is made and again when a memo is opened, with the first of those still in flight while the
    // reader is already opening something. Clearing the control and not putting the group back
    // leaves the memo looking like it is in none, which is then what gets saved.
    const showing = sel.value;
    const showing_label = sel.selectedOptions[0]?.text ?? "";
    // remove all options apart the default empty one
    sel.options.length = 1;
    this._groups
        .map((group) => this._option(group.id.toString(), group.name))
        .forEach((opt) => {
          sel.appendChild(opt);
        });
    // A select only takes a value it has an option for. The group that was showing may be one of
    // the reader's own or one belonging to whoever shared the memo with them, and in the second
    // case it has just been dropped with the rest — so it is put back before the value is set.
    if (showing && !Array.from(sel.options).some((option) => option.value === showing)) {
      sel.appendChild(this._option(showing, showing_label));
    }
    if (showing) {
      sel.value = showing;
    }
  }

  /**
   * Show a group the reader does not own.
   *
   * A memo shared with them is in the group of whoever shared it, which is not in the list of
   * their own groups this control is built from. A select ignores a value it has no option for,
   * and the editor reads the group it saves from this control: without this, opening a shared
   * memo and saving it wrote the memo as though it had no group at all.
   */
  show_group(group: IdName) {
    const sel = this._getSelect();
    const value = String(group.id);
    if (!Array.from(sel.options).some((option) => option.value === value)) {
      sel.appendChild(this._option(value, group.name));
    }
    sel.value = value;
  }

  _option(value: string, label: string): HTMLOptionElement {
    const option = document.createElement("option");
    option.setAttribute("value", value);
    option.innerText = label;
    return option;
  }

  /// The group the control is showing, or nothing when it is showing none.
  get memogroup(): Undef<IdName> {
    const select = this._getSelect();
    const id = parseInt(select.value);
    if (isNaN(id) || id < 0) {
      return undefined;
    }
    konsole.log(`group-list returns the memogroup with id ${id}`);
    // Taken from the control rather than from `_groups`: a memo shared with the reader is in the
    // group of whoever shared it, and that group is in no list of the reader's own. Looking it up
    // there answered "no group", which is what got written.
    return { id, name: select.selectedOptions[0]?.text ?? "" };
  }

  set value(v: string) {
    this._getSelect().value = "" + v;
  }

  get value() {
    return this._getSelect().value;
  }

  /// A read-only list still shows which group the memo is in — it just cannot be changed. Used
  /// for a memo the requester does not own: the server refuses that change for anybody else
  /// (2F002, enforced by the trigger on memo), so an enabled control would offer nothing but a
  /// refusal.
  set readonly(readonly: boolean) {
    this._readonly = readonly;
    this._getSelect().disabled = readonly;
  }

  get readonly(): boolean {
    return this._readonly;
  }

  _getSelect() {
    return this.shadowRoot!.querySelector("#main_select") as HTMLSelectElement;
  }
}

export class MemoGroupList extends SelectList {
  constructor() {
    super(read_memo_groups);
    konsole.log("MemoGroupList constructor");
  }
}

konsole.log("Registering memogroup web component");
customElements.define("memogroup-list", MemoGroupList);
