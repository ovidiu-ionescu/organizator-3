import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import "@dom/journal.js";
import type { Journal } from "@dom/journal.js";

// The journal draws only the lines that are in view: a log grows, and a node per line made a large
// one slow to show and heavy to scroll. What this pins is exactly that — the page holds a window,
// not the log.
describe("the journal", () => {
  let journal: Journal;
  let shadow: ShadowRoot;

  const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i}: something logged`);

  const shown = () => [...shadow.querySelectorAll<HTMLElement>("#window > *")].map(row => row.textContent);

  beforeEach(() => {
    document.body.innerHTML = "<log-journal style='display:block; height: 300px'></log-journal>";
    journal = document.querySelector("log-journal") as Journal;
    shadow = journal.shadowRoot!;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("should build a handful of nodes for a very long log", () => {
    journal.entries = lines(30000);

    // The whole log's height, so the scrollbar tells the truth...
    expect(shadow.querySelector<HTMLElement>("#spacer")!.style.height).to.equal(`${30000 * 22}px`);
    // ...and a window of it in the page, not thirty thousand paragraphs.
    expect(shadow.querySelectorAll("#window > *").length).to.be.lessThan(200);
    expect(shadow.querySelectorAll("#window > p").length).to.be.greaterThan(0);
  });

  it("should start at the beginning, at the first lines", () => {
    journal.entries = lines(1000);

    expect(shown()[0]).to.contain("line 0:");
  });

  it("should draw the window the scroll is looking at, scrolled well into the log", async () => {
    journal.entries = lines(30000);
    const scroll = shadow.querySelector<HTMLElement>("#scroll")!;
    scroll.scrollTop = 20000 * 22; // line 20000 at the top of the view
    scroll.dispatchEvent(new Event("scroll"));

    await vi.waitFor(() => expect(shown().some(text => text?.includes("line 20000:"))).to.equal(true));
    // and nothing like the whole log came with it
    expect(shadow.querySelectorAll("#window > *").length).to.be.lessThan(200);
  });

  it("should escape what was logged rather than parse it as markup", () => {
    journal.entries = ["<img src=x onerror=alert(1)>", "a < b & c > d"];

    const rows = [...shadow.querySelectorAll("#window > p")];
    expect(rows[0].querySelector("img")).to.be.null;
    expect(rows[0].textContent).to.equal("<img src=x onerror=alert(1)>");
    expect(rows[1].textContent).to.equal("a < b & c > d");
  });

  it("should draw a separator as a rule on a line of its own", () => {
    journal.entries = ["before", "<hr>", "after"];

    const rows = [...shadow.querySelectorAll("#window > *")];
    expect(rows.length).to.equal(3);
    expect(rows[1].querySelector("hr")).to.not.be.null;
    // still one line tall: the window's arithmetic depends on it
    expect(getComputedStyle(rows[1]).height).to.equal("22px");
  });
});
