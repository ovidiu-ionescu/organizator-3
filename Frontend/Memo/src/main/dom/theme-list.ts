/**
 * @prettier
 *
 * The control that chooses how memos are displayed.
 *
 * Built like the group list it sits next to — a shadow root with a `<select>` — but over the theme
 * names rather than the reader's memogroups, and applying the choice as it is made rather than
 * handing it to a caller.
 */

import konsole from "./console_log.js";
import { apply_theme, stored_theme, THEMES } from "./theme.js";
import type { ThemeId } from "./theme.js";

export class ThemeList extends HTMLElement {
  constructor() {
    super();
    this.initialize().catch((err) => konsole.error("Failed to initialize the theme list", err));
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
      <select id="main_select" title="how memos are displayed"></select>
    `;

    this.build_options();
    const select = this._getSelect();
    // Applied as the control is built, not only on change: a stored value that is no longer a
    // theme — an old name, something edited by hand — is corrected across the page, and the
    // control then shows what is really being displayed.
    const stored = stored_theme();
    select.value = stored;
    apply_theme(stored);
    select.addEventListener("change", () => apply_theme(select.value as ThemeId));
  }

  build_options() {
    const select = this._getSelect();
    THEMES.forEach((theme) => {
      const option = document.createElement("option");
      option.value = theme.id;
      option.innerText = theme.name;
      select.appendChild(option);
    });
  }

  _getSelect() {
    return this.shadowRoot!.querySelector("#main_select") as HTMLSelectElement;
  }

  get value(): ThemeId {
    return this._getSelect().value as ThemeId;
  }
}

konsole.log("Registering theme-list web component");
customElements.define("theme-list", ThemeList);
