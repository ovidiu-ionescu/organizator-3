import { describe, it, expect } from "vitest";
import { load_markdown, render_markdown } from "@dom/markdown.js";

// The renderer the calendar reads its notes with: the same wasm the memo editor draws memos with.
// The order of these tests matters — the first one is about the state before anything has asked for
// the module, and a module cannot be unloaded once it is up.
describe("rendering a note", () => {
  it("should answer nothing until the module has arrived", () => {
    // The caller shows the note as it was written until then, rather than an empty space.
    expect(render_markdown("# anything")).to.be.null;
  });

  it("should render markdown once it has", async () => {
    await load_markdown();
    expect(render_markdown("Bring the **card**")).to.contain("<strong>card</strong>");
  });

  it("should render a barcode as the markup the stylesheet draws bars from", async () => {
    await load_markdown();
    const html = render_markdown("```barcode13\n5901234123457\n```");
    // The attribute is what the plate and the face are selected by; without it a barcode is a line
    // of digits.
    expect(html).to.contain('data-gen="barcode13"');
    expect(html).to.contain("5901234123457");
  });

  it("should keep what it has already rendered", async () => {
    await load_markdown();
    const first = render_markdown("**kept**");
    expect(render_markdown("**kept**")).to.equal(first);
  });

  it("should load once, however many times it is asked", async () => {
    const first = load_markdown();
    expect(load_markdown()).to.equal(first);
    await first;
  });
});
