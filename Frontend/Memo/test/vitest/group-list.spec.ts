import {describe, it, expect, afterEach, vi} from "vitest";
// The element has to be registered, so the module is imported for that alone. The type comes
// separately: an import used only as a type is dropped by the compiler, which is exactly how the
// element ends up undefined in the document while the test still looks right.
import "@dom/group-list.js";
import type {MemoGroupList} from "@dom/group-list.js";

// The component fetches its options from the server when it is constructed, which fails here —
// there is no server — and is caught by the component itself. What these check is the control,
// which exists either way.

const make_list = (): MemoGroupList => {
  document.body.innerHTML = '<memogroup-list id="list"></memogroup-list>';
  return document.getElementById("list") as MemoGroupList;
};

const get_select = (list: MemoGroupList): HTMLSelectElement | null =>
  list.shadowRoot?.querySelector("#main_select") ?? null;

describe("The memogroup list", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("should offer its select by default", () => {
    const list = make_list();
    expect(get_select(list)).not.to.be.null;
    expect(list.readonly).to.be.false;
    expect(get_select(list)?.disabled).to.be.false;
  });

  it("should disable the select when it is read only", () => {
    const list = make_list();
    list.readonly = true;
    expect(list.readonly).to.be.true;
    expect(get_select(list)?.disabled).to.be.true;
  });

  it("should keep showing the selected group while read only", async () => {
    // A select only takes a value it has an option for, so the groups have to arrive first —
    // which means answering the fetch the component makes for them.
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ memogroups: [{ id: 3, name: "three" }], requester: { id: 1, name: "ovidiu" } }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    const list = make_list();
    await vi.waitFor(() => {
      expect(get_select(list)?.options.length).to.be.greaterThan(1);
    });

    list.value = "3";
    list.readonly = true;
    expect(list.value).to.be.equal("3");
    expect(get_select(list)?.disabled).to.be.true;
  });

  it("should give the select back when it is no longer read only", () => {
    const list = make_list();
    list.readonly = true;
    list.readonly = false;
    expect(get_select(list)?.disabled).to.be.false;
  });
});
