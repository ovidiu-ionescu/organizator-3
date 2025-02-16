import { alignedText } from "../../../main/dom/util.js";

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