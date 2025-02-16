/**
 * @prettier
 *
 * Component that builds drop down list
 */

import { IdName } from "./memo_interfaces.js";
import { read_memo_groups } from "./server_comm.js";
import konsole from "./console_log.js";

class GroupList extends HTMLElement {
  private _groups: IdName[];
  private _fetch_elements: () => Promise<IdName[]>;
  constructor(fetch_elements: () => Promise<IdName[]>) {
    super();
    this._fetch_elements = fetch_elements;
    this.initialize();
  }

  async initialize() {
    const shadow = this.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style type="text/css">
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
    if (!this._groups) {
      this._groups = await this._fetch_elements();
    }

    const sel = this.shadowRoot.querySelector("#main_select");
    this._groups
      .map((group) => {
        const opt = document.createElement("option");
        opt.setAttribute("value", group.id.toString());
        opt.innerText = group.name;
        return opt;
      })
      .forEach((opt) => {
        sel.appendChild(opt);
      });
  }

  get memogroup() {
    const id = this._getSelect().value;
    konsole.log(`group-list return memogroup for memogroup_id ${id}`);
    const sel = parseInt(id);
    return this._groups.find((e) => e.id === sel);
  }

  set value(v: string) {
    this._getSelect().value = "" + v;
  }

  get value() {
    return this._getSelect().value;
  }

  _getSelect() {
    return this.shadowRoot.querySelector("#main_select") as HTMLInputElement;
  }
}

export class MemoGroupList extends GroupList {
  constructor() {
    super(read_memo_groups);
    konsole.log("MemoGroupList constructor");
  }
}

konsole.log("Registering memogroup web component");
customElements.define("memogroup-list", MemoGroupList);
