import { merge } from "../../../main/dom/diff_match_patch_uncompressed.js";
import { alignedText } from "../../../main/dom/util.js";

const base = alignedText`
  This is the main
  initial text.
  Mainly used for adding tests.
`;

describe("Testing text merging", () => {
  it("should add a line at the end and one at the beginning", () => {
    const base = "initial line";
    const local = "added first line\ninitial line";
    const remote = "initial line\nadded last line";

    const merged = merge(base, local, remote);

    expect(merged).to.be.equal(
      "added first line\ninitial line\nadded last line"
    );
  });

  it("should fail to merge unrelated stuff", () => {
    const base = "abcd";
    const local = "ebgd";
    const remote = "ibkd";

    const merged = merge(base, local, remote);
    console.log(merged);
  });



  it('should combine two modifications', () => {
    const add1 = alignedText`
      _2020_01_02_
      - [ ] Add feature 1
    `;

    const add2 = alignedText`
      _2020_01_02_
      - [ ] Add feature 2
    `;
  
    console.log(`Prepending 1: [${add1}${base}]`)
    const merged = merge(base, `${add1}${base}`, `${add2}${base}`);
    console.log(merged);

  });

});
