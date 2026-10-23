/**
 * @prettier
 *
 * The calendar's entry form: a new entry, or the one being changed.
 *
 * The fields are read out of the DOM when the form is submitted rather than tracked as they are
 * typed, which is how the rest of this app reads its inputs and keeps the number of moving parts
 * down. What the form owns is the writing of it: an entry handed to it fills the fields, a submit
 * hands back what they hold, and where that goes is the page's business.
 */
import konsole from "./console_log.js";
import type {Named, Odate, OdateLocation, NewOdate, OdateType} from "./odate_api.js";
import type {RepeatUnit} from "./recurrence.js";
import {load_markdown, render_markdown} from "./markdown.js";
import {barcode_layout_css, markdown_notes_css, presentation_css} from "./presentation_css.js";

/// What the form asks the page to make when Duplicate is confirmed.
export interface DuplicateRequest {
  id: number;
  /// The fields as they stand, so that a time or a note changed in the form is the one copied.
  entry: NewOdate;
  count: number;
  unit: RepeatUnit;
}

/// A time as the `datetime-local` field writes it: built from the local getters, never from
/// `toISOString`, which answers in UTC and would move the value by the zone offset.
const to_local_input = (ms: number): string => {
  const at = new Date(ms);
  const two = (value: number) => `${value}`.padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
};

const HOUR = 3_600_000;

const template = `
  <style>
    :host {
      display: block;
    }
    #trigger {
      font: inherit;
      padding: 0.3rem 0.75rem;
      border: 1px solid var(--memo-border, grey);
      border-radius: 4px;
      background: none;
      color: inherit;
      cursor: pointer;
    }
    form {
      border: 1px solid var(--memo-border, grey);
      border-radius: 4px;
      padding: 0.6rem;
      margin: 0;
    }
    /* A label column and a field column, the same in every row: the fields are all the same width,
       and their left edges line up down the form. Buttons are not fields and keep their own size. */
    .row {
      display: flex;
      gap: 0.5rem;
      align-items: flex-start;
      margin-bottom: 0.4rem;
    }
    label {
      flex: 0 0 5rem;
      padding-top: 0.25rem;
      font-size: 0.9rem;
      opacity: 0.85;
    }
    /* A field is filled a little differently from the page it sits on, so that what can be typed
       into is visible as such before the cursor is in it. A button is not a field: it keeps the
       page behind it and says what it is with its border. */
    input,
    textarea,
    select,
    button {
      font: inherit;
      padding: 0.2rem 0.4rem;
      border: 1px solid var(--memo-border, grey);
      border-radius: 4px;
      background: none;
      color: var(--memo-fg, white);
    }
    input,
    textarea,
    select {
      background-color: var(--memo-field-bg, #2b2b2b);
    }
    /* min-width 0 as well as the flex: a field that will not shrink below the width its own content
       wants is a field that sticks out of the column when it is a date, and the columns stop lining
       up. */
    input,
    select,
    textarea {
      flex: 1 1 auto;
      min-width: 0;
      box-sizing: border-box;
    }
    /* The note's row is the one that wraps: its label and its switch share a line, and the box is
       under both of them. On a desk the box is inset by the label column, so that it is the same
       width as every other field; on a phone there is no label column to inset by and the box takes
       the whole line, which is what a note wants most of. */
    .notes-row {
      flex-wrap: wrap;
      row-gap: 0.25rem;
    }
    .notes-row > .link {
      /* To the far end of the line: on a desk that is where the field column ends, and on a phone
         it is the end of the line the label is on. */
      margin-left: auto;
    }
    .notes-cell {
      flex: 1 1 100%;
      min-width: 0;
      /* The label column and the gap after it. */
      margin-left: 5.5rem;
    }
    @media (max-width: 600px) {
      .notes-cell {
        margin-left: 0;
      }
    }
    /* The box is a field like the rest: it sits in the same column, and it is not left at the width
       its own cols attribute asks for. Block rather than inline-block, so that its top edge stands
       exactly where the preview's does when the switch is pressed — an inline-block rides a line of
       text, and the half-leading above it moves the border down by a few pixels while the preview's
       stays put. */
    .notes-cell textarea {
      width: 100%;
      box-sizing: border-box;
      resize: vertical;
      display: block;
    }
    /* ...and while the preview is up, the box goes: said of the same element, so that it is this
       rule and not the one above that has the last word on whether it is on screen. */
    .notes-cell textarea.hidden {
      display: none;
    }
    .notes-head {
      /* The switch, at the right-hand end of the field column the boxes all end at — and with room
         under it: it was sitting on the box's top border, which is a control with nowhere to be. */
      display: flex;
      justify-content: flex-end;
      align-items: baseline;
      margin-bottom: 0.35rem;
    }
    /* A control that is a word rather than a button: the same one the panels use for Rename and
       Delete, and the same one this app has always had beside the notes. */
    .link {
      font: inherit;
      font-size: 0.9rem;
      /* Its own room above and below, so the word is not a line of text with a target on it. */
      padding: 0.15rem 0;
      border: none;
      background: none;
      color: var(--memo-link, steelblue);
      text-decoration: none;
      cursor: pointer;
    }
    /* A word rather than a line: the colour says what it is, and the underline arrives when the
       pointer does — the way this app's Links theme treats the links in a memo. A device with no
       pointer to hover with gets no underline, which is what having no hover means. */
    @media (hover: hover) {
      .link:hover {
        text-decoration: underline;
      }
    }
    .link:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.6rem;
    }
    /* How many copies, and how far apart. A row of its own under the entry, so the two choices
       read as one question rather than as more fields of the entry. */
    .duplicate {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: baseline;
      margin-top: 0.6rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--memo-border, grey);
    }
    /* The generic field rule stretches these; here they are only as wide as what they hold. */
    .duplicate label {
      flex: 0 0 auto;
      padding-top: 0;
    }
    .duplicate input {
      flex: 0 0 4rem;
    }
    .duplicate select {
      flex: 0 0 auto;
    }
    .duplicate.hidden {
      display: none;
    }
    /* The answer to the last thing asked from this form, under its buttons — where the reader
       is when they asked it, rather than at the top of the page. Always in the page and always
       a line tall, so the form does not grow when a message arrives. */
    .status {
      min-height: 1.1rem;
      margin: 0.5rem 0 0 0;
      font-size: 0.9rem;
    }
    .status.error {
      color: var(--memo-happening, red);
    }
    .primary {
      border-color: var(--memo-link, steelblue);
      color: var(--memo-link, steelblue);
    }

    .preview {
      /* Under the switch with no room of its own: the writing box has none, and the two stand in
         the same place. */
      margin-top: 0;
      padding: 0.4rem;
      border: 1px dashed var(--memo-border, grey);
      border-radius: 4px;
      overflow-wrap: anywhere;
    }
    .preview > :first-child { margin-top: 0; }
    .preview > :last-child { margin-bottom: 0; }
    .editing {
      margin: 0 0 0.4rem 0;
    }
    .hidden {
      display: none;
    }
    a { color: var(--memo-link, steelblue); }
    ${presentation_css(".preview ")}
    ${barcode_layout_css(".preview ")}
    ${markdown_notes_css(".preview ")}
  </style>
  <button id="trigger" type="button" aria-expanded="false" aria-controls="entry_form">Add an entry</button>
  <form id="entry_form" class="hidden">
    <p class="editing hidden">Editing <strong id="editing_what"></strong></p>
    <div class="row">
      <label for="start">Starts</label>
      <input type="datetime-local" id="start" required>
    </div>
    <div class="row">
      <label for="end">Ends</label>
      <input type="datetime-local" id="end" required>
    </div>
    <div class="row">
      <label for="what">What</label>
      <input type="text" id="what" autocomplete="off" placeholder="Dentist">
    </div>
    <div class="row notes-row">
      <label for="notes">Notes</label>
      <button id="preview_toggle" type="button" aria-pressed="false" class="link">Preview</button>
      <div class="notes-cell">
        <textarea id="notes" rows="5" placeholder="Markdown is welcome"></textarea>
        <div id="preview" class="preview hidden"></div>
      </div>
    </div>
    <div class="row">
      <label for="where">Where</label>
      <select id="where"></select>
    </div>
    <div class="row">
      <label for="type">Type</label>
      <select id="type"></select>
    </div>
    <div id="duplicate_panel" class="duplicate hidden">
      <label for="duplicate_count">Copies</label>
      <input type="number" id="duplicate_count" min="1" max="366" step="1" value="2">
      <label for="duplicate_unit">every</label>
      <select id="duplicate_unit">
        <option value="day">day</option>
        <option value="week" selected>week</option>
        <option value="biweekly">2 weeks</option>
        <option value="month">month</option>
      </select>
      <button id="duplicate_confirm" type="button" class="primary">Duplicate</button>
      <button id="duplicate_cancel" type="button">Close</button>
    </div>
    <div class="buttons">
      <button id="save" class="primary" type="submit">Add entry</button>
      <button id="cancel" type="button">Cancel</button>
      <button id="duplicate" type="button">Duplicate…</button>
    </div>
    <p id="form_status" class="status" role="status" aria-live="polite"></p>
  </form>
`;

export class OdateForm extends HTMLElement {
  private $: {[key: string]: HTMLElement} = {};
  private entry: Odate | null = null;
  private open_for_new = false;
  private previewing = false;
  private saving = false;
  /// Whether the copies row is showing under the entry being changed.
  private duplicating = false;
  private places: OdateLocation[] = [];
  private types: OdateType[] = [];
  /// True while closing, so that the focus going back to the trigger is not read as the reader
  /// opening the form again.
  private returning_focus = false;

  constructor() {
    super();
    this.initialize().catch(err => konsole.error("Failed to initialize the entry form", err));
  }

  private async initialize(): Promise<void> {
    const shadow = this.attachShadow({mode: "open"});
    shadow.innerHTML = template;
    shadow.querySelectorAll<HTMLElement>("[id]").forEach(element => {
      this.$[element.id] = element;
    });

    this.$["trigger"].addEventListener("click", () => this.open());
    this.$["cancel"].addEventListener("click", () => this.close());
    this.$["preview_toggle"].addEventListener("click", () => this.toggle_preview());
    this.$["duplicate"].addEventListener("click", () => {
      this.duplicating = !this.duplicating;
      this.draw();
    });
    this.$["duplicate_cancel"].addEventListener("click", () => {
      this.duplicating = false;
      this.draw();
    });
    this.$["duplicate_confirm"].addEventListener("click", () => this.duplicate());
    this.$["end"].addEventListener("focus", () => this.fill_end_from_start());
    this.$["entry_form"].addEventListener("submit", event => {
      event.preventDefault(); // a submit event does not stop the native GET by itself
      this.submit();
    });
  }

  /** The page's lists, so that the two selects can offer them. */
  set known_places(places: OdateLocation[]) {
    this.places = places;
    this.draw_selects();
  }

  set known_types(types: OdateType[]) {
    this.types = types;
    this.draw_selects();
  }

  /** The entry being changed, or null for a new one — which is also how the form is closed. */
  set editing(entry: Odate | null) {
    this.duplicating = false;
    this.show_status("");
    if (entry === null) {
      this.entry = null;
      this.open_for_new = false;
    } else {
      this.entry = entry;
      this.open_for_new = false;
      this.fill(entry);
    }
    this.draw();
  }

  /**
   * Open the form for a new entry and put a shared event's fields in it — the screen another app
   * gets when it asks the calendar to add one. Times are left empty when the share did not carry
   * them, so the required fields ask for what is missing rather than making a date up.
   */
  fill_for_new(entry: {
    start_time?: number;
    end_time?: number;
    description?: string;
    memo_text?: string;
    location_id?: number;
  }): void {
    this.open();
    (this.$["start"] as HTMLInputElement).value =
      entry.start_time === undefined ? "" : to_local_input(entry.start_time);
    (this.$["end"] as HTMLInputElement).value =
      entry.end_time === undefined ? "" : to_local_input(entry.end_time);
    (this.$["what"] as HTMLInputElement).value = entry.description ?? "";
    (this.$["notes"] as HTMLTextAreaElement).value = entry.memo_text ?? "";
    this.previewing = false;
    this.draw_selects();
    (this.$["where"] as HTMLSelectElement).value =
      entry.location_id === undefined ? "" : `${entry.location_id}`;
    // The type was the last entry's choice; a shared event says nothing about it.
    (this.$["type"] as HTMLSelectElement).value = "";
    this.draw();
    this.focus_first_field();
  }

  set is_saving(saving: boolean) {
    this.saving = saving;
    this.draw();
  }

  get expanded(): boolean {
    return this.open_for_new || this.entry !== null;
  }

  private open(): void {
    this.open_for_new = true;
    this.entry = null;
    this.previewing = false;
    this.duplicating = false;
    this.show_status("");
    this.draw_selects();
    this.draw();

    this.focus_first_field();
  }

  /// Into the first field, unless the reader is on a phone: a phone that opens the form and then
  /// raises the keyboard has hidden half of what was just shown, so there the field is left to be
  /// reached. Public because the list puts a form of its own into the row being changed and wants
  /// the same thing to happen.
  focus_first_field(): void {
    if (!window.matchMedia("(pointer: coarse)").matches) {
      this.$["start"].focus();
    }
  }

  close(): void {
    this.open_for_new = false;
    this.entry = null;
    this.previewing = false;
    this.duplicating = false;
    this.show_status("");
    this.draw();

    // Whoever put this form where it is has to hear that it is done with: the form that takes a
    // row's place is drawn by the page, and a form that closed itself without saying so leaves the
    // page still holding the entry as the one being changed — which is a row showing a closed form
    // instead of the entry it stands for.
    this.dispatchEvent(new CustomEvent("form-closed", {bubbles: true, composed: true}));

    this.returning_focus = true;
    this.$["trigger"].focus();
    this.returning_focus = false;
  }

  /**
   * What a new entry leaves behind: the four fields about the entry itself. The two selects keep
   * their answers, because the next entry is very often at the same place and of the same kind.
   */
  clear_after_create(): void {
    this.$["start"].setAttribute("value", "");
    (this.$["start"] as HTMLInputElement).value = "";
    (this.$["end"] as HTMLInputElement).value = "";
    (this.$["what"] as HTMLInputElement).value = "";
    (this.$["notes"] as HTMLTextAreaElement).value = "";
    this.previewing = false;
    this.draw();
    this.$["start"].focus();
  }

  private fill(entry: Odate): void {
    (this.$["start"] as HTMLInputElement).value = to_local_input(entry.start_time);
    (this.$["end"] as HTMLInputElement).value = to_local_input(entry.end_time);
    (this.$["what"] as HTMLInputElement).value = entry.description ?? "";
    (this.$["notes"] as HTMLTextAreaElement).value = entry.memo_text ?? "";
    this.previewing = false;
    this.draw_selects();
    (this.$["where"] as HTMLSelectElement).value =
      entry.location === null ? "" : `${entry.location.id}`;
    (this.$["type"] as HTMLSelectElement).value = entry.type === null ? "" : `${entry.type.id}`;
  }

  /**
   * Fills Ends from Starts when Ends is empty — one hour later, which is what an entry usually is.
   *
   * Through the Date object rather than by adding an hour's worth of milliseconds to the string, so
   * that an entry starting at 23:30 ends at 00:30 the next day rather than at an hour that does not
   * exist on the clock. An End that was already given is never overwritten.
   */
  private fill_end_from_start(): void {
    const start = this.$["start"] as HTMLInputElement;
    const end = this.$["end"] as HTMLInputElement;
    if (start.value === "" || end.value !== "") return;

    const at = new Date(start.value).getTime();
    if (!Number.isFinite(at)) return;
    end.value = to_local_input(at + HOUR);
  }

  private toggle_preview(): void {
    this.previewing = !this.previewing;
    if (this.previewing) {
      // The renderer is a megabyte of wasm that may not be here yet; until it is the note is shown
      // as its own text, and drawn again when it arrives.
      void load_markdown().then(() => this.draw());
    }
    this.draw();
  }

  /// What the fields hold, or null when the times cannot be read.
  private read_entry(): NewOdate | null {
    const start = new Date((this.$["start"] as HTMLInputElement).value).getTime();
    const end = new Date((this.$["end"] as HTMLInputElement).value).getTime();
    // Half-filled times are not a request to make: the browser's own `required` covers the empty
    // field, and this covers the value it cannot read as a time.
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

    const what = (this.$["what"] as HTMLInputElement).value.trim();
    const notes = (this.$["notes"] as HTMLTextAreaElement).value.trim();
    const where = Number((this.$["where"] as HTMLSelectElement).value);
    const type = Number((this.$["type"] as HTMLSelectElement).value);

    // Empty fields are left out rather than sent as empty strings: the server stores what it is
    // given, and "no notes" is not the same answer as "notes that are empty".
    const entry: NewOdate = {start_time: start, end_time: end};
    if (what !== "") entry.description = what;
    if (notes !== "") entry.memo_text = notes;
    if (where) entry.location_id = where;
    if (type) entry.type = type;
    return entry;
  }

  /**
   * What the last change asked from this form did, under its buttons. `error` says it in the
   * colour the page uses for a refusal.
   */
  show_status(text: string, error: boolean = false): void {
    const status = this.$["form_status"];
    status.textContent = text;
    status.classList.toggle("error", error);
    // `nearest` leaves a line that is already on screen where it is.
    if (text !== "") status.scrollIntoView({block: "nearest"});
  }

  /** Everything the server is told, when the reader asks for it to be written. */
  private submit(): void {
    const entry = this.read_entry();
    if (entry === null) return;
    this.show_status("");

    this.dispatchEvent(
      new CustomEvent("entry-submit", {
        detail: {id: this.entry === null ? null : this.entry.id, entry},
        bubbles: true,
        composed: true,
      })
    );
  }

  /// The entry as the fields hold it, and how many copies of it to make and how far apart. The
  /// page decides which of those already exist; this only says what was asked for.
  private duplicate(): void {
    if (this.entry === null) return;
    const entry = this.read_entry();
    if (entry === null) return;

    const typed = Number((this.$["duplicate_count"] as HTMLInputElement).value);
    if (!Number.isFinite(typed) || typed < 1) return;
    const count = Math.min(366, Math.floor(typed));

    const unit = (this.$["duplicate_unit"] as HTMLSelectElement).value as RepeatUnit;
    if (unit !== "day" && unit !== "week" && unit !== "biweekly" && unit !== "month") return;

    this.duplicating = false;
    this.show_status("");
    this.draw();
    this.dispatchEvent(
      new CustomEvent<DuplicateRequest>("entry-duplicate", {
        detail: {id: this.entry.id, entry, count, unit},
        bubbles: true,
        composed: true,
      })
    );
  }

  /**
   * The two selects, and the row an entry names that the list has not got.
   *
   * Without that row a select whose value matches no option falls back to its first — "No location"
   * — and saving would quietly take the field away from the entry.
   */
  private draw_selects(): void {
    const where = this.$["where"] as HTMLSelectElement | undefined;
    const type = this.$["type"] as HTMLSelectElement | undefined;
    if (!where || !type) return;

    const fill = (select: HTMLSelectElement, none: string, rows: Named[], current: Named | null) => {
      const chosen = select.value;
      const options = rows.slice();
      if (current !== null && !options.some(row => row.id === current.id)) options.push(current);
      select.replaceChildren(
        new Option(none, ""),
        ...options.map(row => new Option(row.name, `${row.id}`))
      );
      // Rebuilding the options drops the selection back to the first one — "No location" — and a
      // save would then quietly take the entry's place away from it. So what was chosen goes back,
      // and where nothing was, the entry's own row answers.
      const wanted = chosen !== "" ? chosen : current === null ? "" : `${current.id}`;
      if ([...select.options].some(option => option.value === wanted)) select.value = wanted;
    };

    fill(where, "No location", this.places, this.entry?.location ?? null);
    fill(type, "No type", this.types, this.entry?.type ?? null);
  }

  private draw(): void {
    const shadow = this.shadowRoot;
    if (!shadow) return;

    const form = this.$["entry_form"];
    form.classList.toggle("hidden", !this.expanded);
    this.$["trigger"].classList.toggle("hidden", this.expanded);
    this.$["trigger"].setAttribute("aria-expanded", `${this.expanded}`);

    const editing = this.$["editing_what"];
    const editing_line = shadow.querySelector<HTMLElement>(".editing")!;
    editing_line.classList.toggle("hidden", this.entry === null);
    editing.textContent = this.entry?.description || "this entry";

    const save = this.$["save"] as HTMLButtonElement;
    save.textContent = this.saving ? "Saving…" : this.entry === null ? "Add entry" : "Save";
    save.disabled = this.saving;
    (this.$["cancel"] as HTMLButtonElement).disabled = this.saving;
    for (const id of ["start", "end", "what", "notes", "where", "type"]) {
      (this.$[id] as HTMLInputElement).disabled = this.saving;
    }

    // Duplicating is about an entry that exists; there is nothing to copy while adding one.
    const duplicate = this.$["duplicate"] as HTMLButtonElement;
    duplicate.classList.toggle("hidden", this.entry === null);
    duplicate.disabled = this.saving;

    const duplicate_panel = this.$["duplicate_panel"];
    duplicate_panel.classList.toggle("hidden", !this.duplicating || this.entry === null);
    for (const id of ["duplicate_count", "duplicate_unit", "duplicate_confirm", "duplicate_cancel"]) {
      (this.$[id] as HTMLInputElement).disabled = this.saving;
    }

    const toggle = this.$["preview_toggle"] as HTMLButtonElement;
    toggle.textContent = this.previewing ? "Write" : "Preview";
    toggle.setAttribute("aria-pressed", `${this.previewing}`);
    toggle.disabled = this.saving;

    const notes = this.$["notes"];
    const preview = this.$["preview"];
    notes.classList.toggle("hidden", this.previewing);
    preview.classList.toggle("hidden", !this.previewing);
    if (this.previewing) this.draw_preview(preview);
  }

  private draw_preview(preview: HTMLElement): void {
    const note = (this.$["notes"] as HTMLTextAreaElement).value;
    const html = render_markdown(note);
    if (html === null) {
      preview.textContent = note;
      preview.style.whiteSpace = "pre-wrap";
      return;
    }
    preview.style.whiteSpace = "normal";
    // The renderer's own output, already through ammonia — the same list the memo app holds its
    // memos to, which is why a barcode in a note draws here as it does there.
    preview.innerHTML = html;
  }
}

konsole.log("Registering odate-form web component");
customElements.define("odate-form", OdateForm);
