/**
 * @prettier
 *
 * Component that displays the konsole array.
 * Useful for debugging on mobile
 *
 * Only the lines in view are in the page. A journal is a log, and a log grows: rendering a node per
 * line made showing a large one take a quarter of a second at thirty thousand lines and cost that
 * many nodes to scroll through. Here the lines are measured but not built — a spacer holds the
 * height of the whole log, and the window inside it is filled with the few that fit on screen.
 *
 * That needs every line to be exactly one line tall, which is why the text is monospaced and
 * `white-space: pre`: a long line runs off to the right instead of wrapping. A wrapped line would
 * be two heights, and the arithmetic below would stop holding. A separator is one line tall too,
 * with the rule drawn inside it.
 */

import konsole from "./console_log.js";

/// One line's height, from the stylesheet below. The window's arithmetic is written in these.
const LINE_HEIGHT = 22;
/// Rendered above and below the visible part, so that a flick of the scroll wheel does not show a
/// gap before the next frame fills it in.
const OVERSCAN = 20;

const template = `
  <style>
    :host {
      display: block;
      height: 100%;
      overflow: hidden;
    }
    #scroll {
      height: 100%;
      overflow: auto;
      font-family: monospace;
      font-size: 0.8125rem;
      line-height: ${LINE_HEIGHT}px;
    }
    /* The whole log's height, so that the scrollbar is honest about it. */
    #spacer {
      position: relative;
    }
    /* The lines that are in the page, standing where they would be among all the others. */
    #window {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
    }
    p {
      margin: 0;
      white-space: pre;
    }
    .separator {
      height: ${LINE_HEIGHT}px;
      display: flex;
      align-items: center;
    }
    .separator hr {
      flex: 1;
      margin: 0;
      border: none;
      border-top: 1px solid #666;
    }
  </style>
  <div id="scroll"><div id="spacer"><div id="window"></div></div></div>
`;

const escape_html = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export class Journal extends HTMLElement {
  private $: { [key: string]: HTMLElement } = {};
  private lines: string[] = [];
  private painting = false;

  constructor() {
    super();
    this.initialize();
  }

  initialize() {
    const shadow = this.attachShadow({ mode: "open" });
    shadow.innerHTML = template;
    // build a cache of elements with an id
    shadow.querySelectorAll<HTMLElement>("[id]").forEach((e) => {
      this.$[e.id] = e;
    });

    // One frame at a time: a scroll fires many events and each render is a window rebuild.
    this.$["scroll"].addEventListener("scroll", () => {
      if (this.painting) return;
      this.painting = true;
      requestAnimationFrame(() => {
        this.painting = false;
        this.paint();
      });
    });
  }

  set entries(lines: string[]) {
    this.lines = lines;
    this.$["spacer"].style.height = `${lines.length * LINE_HEIGHT}px`;
    this.paint();
  }

  activate() {
    this.entries = konsole.journal();
  }

  /// Fills the window with the lines that are in view, and puts it where they belong.
  private paint() {
    const scroll = this.$["scroll"];
    const first = Math.max(0, Math.floor(scroll.scrollTop / LINE_HEIGHT) - OVERSCAN);
    const on_screen = Math.ceil(scroll.clientHeight / LINE_HEIGHT) + 2 * OVERSCAN;
    const last = Math.min(this.lines.length, first + on_screen);

    this.$["window"].style.top = `${first * LINE_HEIGHT}px`;

    const rows: string[] = [];
    for (let at = first; at < last; at++) {
      const line = this.lines[at];
      if (line === "<hr>") rows.push('<div class="separator"><hr></div>');
      else rows.push(`<p>${escape_html(line)}</p>`);
    }
    this.$["window"].innerHTML = rows.join("");
  }
}

konsole.log("Registering log-journal web component");
customElements.define("log-journal", Journal);
