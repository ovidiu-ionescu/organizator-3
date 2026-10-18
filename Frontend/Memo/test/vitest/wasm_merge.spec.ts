import {describe, it, expect, beforeAll} from 'vitest';
import init, {merge} from '../../../organizator-wasm/pkg/organizator_wasm';
import { alignedText } from "@dom/util.js";

beforeAll(async () => {
    await init();
});

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

        // The merge no longer ends its answer with a newline of its own; the old one did, and
        // the app stripped it again. Neither version here ended with one, so neither does this.
        expect(merged).to.be.equal(
            "added first line\ninitial line\nadded last line"
        );
    });

    it("should merge unrelated edits instead of failing", () => {
        // The merge this replaced answered a conflict with a `# Merge failed:` block and diff3
        // markers. This one always merges: "abcd" is one word, both sides replace it with a word
        // of their own, and the two replacements are kept one after the other. What matters here
        // is that no failure block comes back.
        const base = "abcd";
        const local = "ebgd";
        const remote = "ibkd";

        const merged = merge(base, local, remote);

        expect(merged).not.toContain("# Merge failed:");
        expect(merged).not.toContain("<<<<<<<");
        expect(merged).toBe("ebgdibkd");
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
