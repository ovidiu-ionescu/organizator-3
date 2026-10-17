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
import {load_markdown, render_markdown} from "./markdown.js";
import {barcode_layout_css, markdown_notes_css, presentation_css} from "./presentation_css.js";

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
      gap: 0.5rem;
      margin-top: 0.6rem;
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
    <div class="buttons">
      <button id="save" class="primary" type="submit">Add entry</button>
      <button id="cancel" type="button">Cancel</button>
    </div>
  </form>
`;

export class OdateForm extends HTMLElement {
  private $: {[key: string]: HTMLElement} = {};
  private entry: Odate | null = null;
  private open_for_new = false;
  private previewing = false;
  private saving = false;
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

  /** Everything the server is told, when the reader asks for it to be written. */
  private submit(): void {
    const start = new Date((this.$["start"] as HTMLInputElement).value).getTime();
    const end = new Date((this.$["end"] as HTMLInputElement).value).getTime();
    // Half-filled times are not a request to make: the browser's own `required` covers the empty
    // field, and this covers the value it cannot read as a time.
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;

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

    this.dispatchEvent(
      new CustomEvent("entry-submit", {
        detail: {id: this.entry === null ? null : this.entry.id, entry},
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
