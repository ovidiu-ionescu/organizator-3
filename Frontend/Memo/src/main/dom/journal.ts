/**
 * @prettier
 *
 * Component that displays the konsole array.
 * Useful for debugging on mobile
 */

import konsole from "./console_log.js";

const template = `
  <div id="journal"></div>
`;

export class Journal extends HTMLElement {
  private $: { [key: string]: HTMLElement };

  constructor() {
    super();
    this.initialize();
  }

  initialize() {
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = template;
    // build a cache of elements with an id
    this.$ = {};
    shadow.querySelectorAll("[id]").forEach((e: HTMLElement) => {
      this.$[e.getAttribute("id")] = e;
    });
  }

  set entries(lines: string[]) {
    this.$.journal.innerText = "";
    lines.forEach((line) => {
      if (line === "<hr>") {
        this.$.journal.appendChild(document.createElement("hr"));
      } else {
        const p = document.createElement("p");
        p.innerText = line;
        this.$.journal.appendChild(p);
      }
    });
  }

  activate() {
    this.entries = konsole.journal();
  }
}

konsole.log("Registering log-journal web component");
customElements.define("log-journal", Journal);
