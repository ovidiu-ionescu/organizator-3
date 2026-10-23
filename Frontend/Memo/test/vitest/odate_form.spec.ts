import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import "@dom/odate-form.js";
import type { DuplicateRequest, OdateForm } from "@dom/odate-form.js";
import type { NewOdate, Odate } from "@dom/odate_api.js";

// The entry form: one new entry, or the one being changed. What it owns is the writing of it — an
// entry handed to it fills the fields, a submit hands back what they hold.
describe("the entry form", () => {
  let form: OdateForm;
  let shadow: ShadowRoot;

  const field = (id: string) => shadow.querySelector<HTMLInputElement>(`#${id}`)!;
  const button = (id: string) => shadow.querySelector<HTMLButtonElement>(`#${id}`)!;
  const open = () => button("trigger").click();

  const ENTRY: Odate = {
    id: 12,
    start_time: new Date(2026, 2, 5, 9, 30).getTime(),
    end_time: new Date(2026, 2, 5, 10, 30).getTime(),
    ongoing: false,
    description: "Dentist",
    memo_text: "Bring the **card**",
    location: { id: 3, name: "Office", latitude: 44.4268, longitude: 26.1025 },
    type: { id: 4, name: "Meeting" },
  };

  beforeEach(() => {
    document.body.innerHTML = "<odate-form></odate-form>";
    form = document.querySelector("odate-form") as OdateForm;
    shadow = form.shadowRoot!;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("should open on the button and close on Cancel", () => {
    expect(shadow.querySelector("#entry_form")!.classList.contains("hidden")).to.equal(true);

    open();
    expect(shadow.querySelector("#entry_form")!.classList.contains("hidden")).to.equal(false);
    expect(button("trigger").getAttribute("aria-expanded")).to.equal("true");

    button("cancel").click();
    expect(shadow.querySelector("#entry_form")!.classList.contains("hidden")).to.equal(true);
    expect(button("trigger").getAttribute("aria-expanded")).to.equal("false");
  });

  it("should say so when it is closed, so that whatever put it there can stop standing for it", () => {
    // The form that takes a row's place is drawn by the page. One that closed itself in silence
    // left the page still holding the entry as the one being changed — and the row went on showing
    // a closed form instead of the entry it stood for.
    const closed: Event[] = [];
    form.addEventListener("form-closed", event => closed.push(event));

    open();
    button("cancel").click();

    expect(closed.length).to.equal(1);
    expect((closed[0] as CustomEvent).bubbles).to.equal(true);
  });

  it("should fill Ends an hour after Starts, and across midnight when that is where it lands", () => {
    open();
    field("start").value = "2026-03-05T09:30";
    field("end").focus();

    expect(field("end").value).to.equal("2026-03-05T10:30");

    // Through the Date object rather than by adding an hour to the string: 23:30 plus an hour is
    // 00:30 the next day, and a number that does not exist on the clock is no answer at all.
    field("start").value = "2026-03-05T23:30";
    field("end").value = "";
    // Away and back: an element that already has the focus does not fire another focus event, and
    // it is the focus that fills the field.
    field("end").blur();
    field("end").focus();
    expect(field("end").value).to.equal("2026-03-06T00:30");
  });

  it("should never overwrite an End that was already given", () => {
    open();
    field("start").value = "2026-03-05T09:30";
    field("end").value = "2026-03-05T17:00";
    field("end").focus();

    expect(field("end").value).to.equal("2026-03-05T17:00");
  });

  it("should hand back only the fields that were given", () => {
    const seen: { id: number | null; entry: NewOdate }[] = [];
    form.addEventListener("entry-submit", event =>
      seen.push((event as CustomEvent<{ id: number | null; entry: NewOdate }>).detail)
    );

    open();
    field("start").value = "2026-03-05T09:30";
    field("end").value = "2026-03-05T10:30";
    field("what").value = "  Dentist  ";
    // Cancelable, like the one a browser sends: the app stops the native submission in its
    // handler, and an event that cannot be cancelled would navigate the test away instead.
    shadow.querySelector("form")!.dispatchEvent(new Event("submit", {cancelable: true, bubbles: true}));

    expect(seen.length).to.equal(1);
    expect(seen[0].id).to.be.null;
    // Trimmed, and with no notes, no place and no type in it at all.
    expect(seen[0].entry).to.deep.equal({
      start_time: new Date(2026, 2, 5, 9, 30).getTime(),
      end_time: new Date(2026, 2, 5, 10, 30).getTime(),
      description: "Dentist",
    });
  });

  it("should ask the server for nothing when the times cannot be read", () => {
    const seen: unknown[] = [];
    form.addEventListener("entry-submit", event => seen.push(event));

    open();
    field("start").value = "";
    field("end").value = "";
    // Cancelable, like the one a browser sends: the app stops the native submission in its
    // handler, and an event that cannot be cancelled would navigate the test away instead.
    shadow.querySelector("form")!.dispatchEvent(new Event("submit", {cancelable: true, bubbles: true}));

    expect(seen.length).to.equal(0);
  });

  it("should fill the fields from the entry being changed, and hand back its id", () => {
    const seen: { id: number | null; entry: NewOdate }[] = [];
    form.addEventListener("entry-submit", event =>
      seen.push((event as CustomEvent<{ id: number | null; entry: NewOdate }>).detail)
    );

    form.editing = ENTRY;
    expect(field("start").value).to.equal("2026-03-05T09:30");
    expect(field("end").value).to.equal("2026-03-05T10:30");
    expect(field("what").value).to.equal("Dentist");
    expect(shadow.querySelector<HTMLTextAreaElement>("#notes")!.value).to.equal("Bring the **card**");
    expect(shadow.querySelector("button[type=submit]")!.textContent).to.equal("Save");
    expect(shadow.textContent).to.contain("Editing");

    // Cancelable, like the one a browser sends: the app stops the native submission in its
    // handler, and an event that cannot be cancelled would navigate the test away instead.
    shadow.querySelector("form")!.dispatchEvent(new Event("submit", {cancelable: true, bubbles: true}));
    expect(seen[0].id).to.equal(12);
  });

  it("should open a new entry from the fields of a shared event", () => {
    form.known_places = [
      { id: 3, name: "Office", latitude: null, longitude: null, timezone: null, last_used: null },
    ];
    form.known_types = [{ id: 4, name: "Meeting" }];
    // The type was chosen for the last entry; a shared event says nothing about it.
    shadow.querySelector<HTMLSelectElement>("#type")!.value = "4";

    form.fill_for_new({
      start_time: new Date(2026, 2, 5, 9, 30).getTime(),
      end_time: new Date(2026, 2, 5, 10, 30).getTime(),
      description: "Dentist",
      memo_text: "Bring the card",
      location_id: 3,
    });

    expect(shadow.querySelector("#entry_form")!.classList.contains("hidden")).to.equal(false);
    expect(field("start").value).to.equal("2026-03-05T09:30");
    expect(field("end").value).to.equal("2026-03-05T10:30");
    expect(field("what").value).to.equal("Dentist");
    expect(shadow.querySelector<HTMLTextAreaElement>("#notes")!.value).to.equal("Bring the card");
    expect(shadow.querySelector<HTMLSelectElement>("#where")!.value).to.equal("3");
    expect(shadow.querySelector<HTMLSelectElement>("#type")!.value).to.equal("");
  });

  it("should leave the times empty when a shared event did not carry them", () => {
    form.fill_for_new({ description: "Dentist", memo_text: "Bring the card" });

    expect(shadow.querySelector("#entry_form")!.classList.contains("hidden")).to.equal(false);
    expect(field("start").value).to.equal("");
    expect(field("end").value).to.equal("");
    expect(field("what").value).to.equal("Dentist");
  });

  it("should offer Duplicate only while changing an entry", () => {
    // Adding one has no id yet, so there is nothing on the server to copy.
    open();
    expect(shadow.querySelector<HTMLButtonElement>("#duplicate")!.classList.contains("hidden")).to.equal(true);

    form.editing = ENTRY;
    const duplicate = shadow.querySelector<HTMLButtonElement>("#duplicate")!;
    expect(duplicate.classList.contains("hidden")).to.equal(false);

    duplicate.click();
    expect(shadow.querySelector("#duplicate_panel")!.classList.contains("hidden")).to.equal(false);
    // Two copies is what "duplicate" usually means: this one and the next.
    expect(shadow.querySelector<HTMLInputElement>("#duplicate_count")!.value).to.equal("2");
    expect(shadow.querySelector<HTMLSelectElement>("#duplicate_unit")!.value).to.equal("week");
  });

  it("should hand the fields, the count and the interval of a duplication to the page", () => {
    const seen: DuplicateRequest[] = [];
    form.addEventListener("entry-duplicate", event =>
      seen.push((event as CustomEvent<DuplicateRequest>).detail)
    );

    form.editing = ENTRY;
    shadow.querySelector<HTMLButtonElement>("#duplicate")!.click();
    shadow.querySelector<HTMLInputElement>("#duplicate_count")!.value = "3";
    shadow.querySelector<HTMLSelectElement>("#duplicate_unit")!.value = "biweekly";
    shadow.querySelector<HTMLButtonElement>("#duplicate_confirm")!.click();

    expect(seen.length).to.equal(1);
    expect(seen[0].id).to.equal(12);
    expect(seen[0].count).to.equal(3);
    expect(seen[0].unit).to.equal("biweekly");
    // The fields as they stand, including the entry's place and type.
    expect(seen[0].entry).to.deep.equal({
      start_time: new Date(2026, 2, 5, 9, 30).getTime(),
      end_time: new Date(2026, 2, 5, 10, 30).getTime(),
      description: "Dentist",
      memo_text: "Bring the **card**",
      location_id: 3,
      type: 4,
    });
    // The row of choices closes once it has handed the request over.
    expect(shadow.querySelector("#duplicate_panel")!.classList.contains("hidden")).to.equal(true);
  });

  it("should put what happened under its buttons, where the reader asked for it", () => {
    form.editing = ENTRY;
    form.show_status("The event already existed on Wed 28 Oct, 10:00.");

    const line = shadow.querySelector<HTMLElement>("#form_status")!;
    expect(line.textContent).to.contain("already existed");
    expect(line.classList.contains("error")).to.equal(false);
    // The bottom of the form: after the row of buttons.
    expect(shadow.querySelector("#entry_form")!.lastElementChild).to.equal(line);

    form.show_status("Could not duplicate the entry.", true);
    expect(line.textContent).to.equal("Could not duplicate the entry.");
    expect(line.classList.contains("error")).to.equal(true);

    // Closing the form takes the message with it.
    button("cancel").click();
    expect(line.textContent).to.equal("");
  });

  it("should keep a place the loaded list has not got, rather than taking the field away", () => {
    // A select whose value matches no option falls back to its first — "No location" — and saving
    // would quietly drop the location the entry has.
    form.known_places = [{ id: 9, name: "Elsewhere", latitude: null, longitude: null, timezone: null, last_used: null }];
    form.editing = ENTRY;

    const where = shadow.querySelector<HTMLSelectElement>("#where")!;
    expect(where.value).to.equal("3");
    expect([...where.options].map(option => option.textContent)).to.deep.equal([
      "No location",
      "Elsewhere",
      "Office",
    ]);
  });

  it("should not take the place away when the lists arrive after the entry", () => {
    // The row that is being changed fills the form before the page has handed it the lists, and
    // rebuilding the options drops a select back to its first one — which is "No location", and
    // which a save would then send.
    form.editing = ENTRY;
    expect(shadow.querySelector<HTMLSelectElement>("#where")!.value).to.equal("3");

    form.known_places = [
      { id: 3, name: "Office", latitude: null, longitude: null, timezone: null, last_used: null },
    ];
    form.known_types = [{ id: 4, name: "Meeting" }];

    expect(shadow.querySelector<HTMLSelectElement>("#where")!.value).to.equal("3");
    expect(shadow.querySelector<HTMLSelectElement>("#type")!.value).to.equal("4");
  });

  it("should give the notes five lines to write in", () => {
    // Five rather than three: a note here is a paragraph about an appointment, not a title.
    expect(shadow.querySelector<HTMLTextAreaElement>("#notes")!.rows).to.equal(5);
  });

  it("should show the notes rendered when Preview is pressed, and put the writing back on Write", async () => {
    form.known_places = [];
    form.known_types = [];
    form.editing = ENTRY;

    await vi.waitFor(() => expect(shadow.querySelector("#preview_toggle")).to.exist);
    const toggle = button("preview_toggle");
    toggle.click();

    await vi.waitFor(() => {
      expect(shadow.querySelector<HTMLElement>("#preview")!.innerHTML).to.contain("<strong>card</strong>");
    });
    expect(toggle.textContent).to.equal("Write");
    expect(toggle.getAttribute("aria-pressed")).to.equal("true");
    // The textarea is hidden rather than removed, which is what keeps what was typed. Checked as
    // the computed display and not as the class: a rule of the form .notes-cell textarea is more
    // particular than .hidden, so a class that is there can be a box that is still on screen —
    // which is exactly how the preview came to open under the box instead of in its place.
    const notes = shadow.querySelector<HTMLTextAreaElement>("#notes")!;
    expect(notes.classList.contains("hidden")).to.equal(true);
    expect(getComputedStyle(notes).display).to.equal("none");
    expect(getComputedStyle(shadow.querySelector<HTMLElement>("#preview")!).display).not.to.equal("none");

    toggle.click();
    expect(shadow.querySelector("#notes")!.classList.contains("hidden")).to.equal(false);
    expect(getComputedStyle(shadow.querySelector<HTMLElement>("#notes")!).display).not.to.equal("none");
    expect(getComputedStyle(shadow.querySelector<HTMLElement>("#preview")!).display).to.equal("none");
    expect(toggle.textContent).to.equal("Preview");
  });
});
