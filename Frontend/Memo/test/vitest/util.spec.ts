import {describe, it, expect, beforeEach, afterEach, beforeAll, vi} from "vitest";
import { alignedText, failure_message, fold } from "@dom/util.js";

describe("Testing template functions", () => {
  it("should remove spaces from the beginning of lines and the first empty line", () => {
    const t = alignedText`
    line two`;
    expect(t).to.be.equal("line two");
  });
  it("should remove spaces from the beginning of lines relative to the first line", () => {
    const t = alignedText`
    line two
      line three`;
    expect(t).to.be.equal("line two\n  line three");
  });
  it("should only modify the text if the template starts with an empty line", () => {
    const t = alignedText`line one
    line two`;
    expect(t).to.be.equal("line one\n    line two");
  });
});

describe("Folding text for a search", () => {
  it("should drop the accents off an accented letter, as unaccent does on the server", () => {
    expect(fold("café")).to.be.equal("cafe");
    expect(fold("CAFÉ")).to.be.equal("cafe");
    expect(fold("Über")).to.be.equal("uber");
  });

  it("should fold the comma below that Romanian letters carry", () => {
    expect(fold("și")).to.be.equal("si");
    expect(fold("București")).to.be.equal("bucuresti");
  });

  it("should leave unaccented text alone", () => {
    expect(fold("plain text")).to.be.equal("plain text");
    expect(fold("")).to.be.equal("");
  });

  it("should make a search for an unaccented word match an accented memo", () => {
    const memo = "Am băut o cafea la café-ul din colț";
    expect(fold(memo).includes(fold("cafea"))).to.be.true;
    expect(fold(memo).includes(fold("café"))).to.be.true;
    expect(fold(memo).includes(fold("Cafea"))).to.be.true;
    expect(fold(memo).includes(fold("ceai"))).to.be.false;
  });
});

describe("Describing a failed request", () => {
  it("should name the status the router could not branch on before", () => {
    expect(failure_message(404, "memo 42")).to.be.equal("# No memo 42 on server");
    expect(failure_message(403, "memo 42")).to.be.equal("# No access to memo 42");
    expect(failure_message(400, "memo 42")).to.be.equal(
      "# The server refused the request for memo 42"
    );
    expect(failure_message(500, "memo 42")).to.be.equal(
      "# Failed to load memo 42, server status 500"
    );
  });

  it("should fall back to the status for anything else, including teapots", () => {
    expect(failure_message(418, "memo 7")).to.be.equal(
      "# Failed to load memo 7, server status 418"
    );
    expect(failure_message(0, "memo 7")).to.be.equal(
      "# Failed to load memo 7, server status 0"
    );
  });
});