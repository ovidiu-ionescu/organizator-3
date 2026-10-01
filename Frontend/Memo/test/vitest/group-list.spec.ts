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

  it("should show a group the reader does not own, and go on reporting it", async () => {
    // A memo shared with the reader is in the group of whoever shared it. That group is not in
    // the list this control is built from, and a select ignores a value it has no option for —
    // so the control showed nothing, and the editor saved the memo as though it had no group.
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ memogroups: [{ id: 3, name: "mine" }], requester: { id: 1, name: "ovidiu" } }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    const list = make_list();
    await vi.waitFor(() => {
      expect(get_select(list)?.options.length).to.be.greaterThan(1);
    });

    list.show_group({ id: 20, name: "someone else's" });
    expect(list.value).to.be.equal("20");
    expect(list.memogroup?.id).to.be.equal(20);
    expect(list.memogroup?.name).to.be.equal("someone else's");

    // And it survives the list being built again — which happens on every memo that is opened.
    await list.build_options();
    expect(list.value).to.be.equal("20");
    expect(list.memogroup?.id).to.be.equal(20);

    // Showing none is still none.
    list.value = "-1";
    expect(list.memogroup).to.be.undefined;
  });

  it("should keep the group the memo is in when the list is built again", async () => {
    // The select is filled from the server when the component is made, and again whenever the
    // editor opens a memo. Those two overlap — the first is still in flight while the reader is
    // already opening something — so a build that clears the control and does not put back what
    // it was showing leaves the memo looking like it is in no group at all, and the editor reads
    // the group it saves from this control.
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          memogroups: [{ id: 3, name: "three" }, { id: 4, name: "four" }],
          requester: { id: 1, name: "ovidiu" },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    const list = make_list();
    await vi.waitFor(() => {
      expect(get_select(list)?.options.length).to.be.greaterThan(1);
    });

    list.value = "4";
    await list.build_options();

    expect(list.value).to.be.equal("4");
  });
});
