/**
 * @prettier
 *
 * The calendar's list of entries: when each one is, what it is, its notes and where it is.
 *
 * A note is markdown, drawn with the same wasm the memo app draws memos with — barcodes and all —
 * so the same text reads the same on both pages. Until that module has loaded the note is shown as
 * it was written, which is worth reading and is not nothing.
 */
import konsole from "./console_log.js";
import type {Odate, OdateLocation, OdateType} from "./odate_api.js";
// The form a row turns into while it is being changed: the same element the page uses for a new
// entry, put where the entry is rather than at the top of the page.
import "./odate-form.js";
import type {OdateForm} from "./odate-form.js";
import {map_url} from "./coordinates.js";
import {barcode_layout_css, markdown_notes_css, presentation_css} from "./presentation_css.js";
import {load_markdown, render_markdown} from "./markdown.js";
import {start_of_day, whole_days_between} from "./day_range.js";

const when_format = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const end_format = new Intl.DateTimeFormat(undefined, {hour: "2-digit", minute: "2-digit"});

const template = `
  <style>
    :host {
      display: block;
    }
    h2 {
      margin: 0 0 0.4rem 0;
      font-size: 1.1rem;
    }
    .muted {
      color: var(--memo-fg, white);
      opacity: 0.7;
    }
    /* The rows themselves, and only them: a note is markdown too, and a list inside one is a list
       of somebody's items rather than a set of entries. Unscoped, these rules put the entry line
       down the side of every checklist in every note. */
    #entries {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    /* The line beside an entry is how soon it is; the colours are the theme's, and each of them is
       said in words as well — the badge, or the date — because a colour on its own is not a
       message everybody receives. */
    #entries > li {
      border-left: 3px solid var(--memo-border, grey);
      padding: 0.35rem 0.6rem 0.5rem 0.6rem;
      margin-bottom: 0.5rem;
    }
    #entries > li.happening { border-left-color: var(--memo-happening, red); }
    #entries > li.today { border-left-color: var(--memo-today, orange); }
    #entries > li.week { border-left-color: var(--memo-this-week, green); }
    .when {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: baseline;
      font-variant-numeric: tabular-nums;
    }
    .badge {
      background-color: var(--memo-happening, red);
      color: white;
      border-radius: 3px;
      padding: 0 0.3rem;
      font-size: 0.85rem;
    }
    .until { opacity: 0.8; }
    .what { font-weight: bold; }
    .notes { margin: 0.2rem 0; overflow-wrap: anywhere; }
    .notes > :first-child { margin-top: 0; }
    .notes > :last-child { margin-bottom: 0; }
    /* Where the entry is and what kind it is. It is optional, and what is above it is prose — a
       note can be any number of lines — so it has to read as something other than the note's last
       paragraph. A rule over it said that too, and read as a line the page had drawn across the
       entry rather than as the start of anything; a band of its own colour says the same thing
       without looking like a divider. It appears only when there is something to put in it. */
    .about {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
      align-items: baseline;
      margin-top: 0.45rem;
      padding: 0.3rem 0.45rem;
      border-radius: 4px;
      background-color: var(--memo-field-bg, #2b2b2b);
      font-size: 0.85rem;
      opacity: 0.8;
    }
    .type {
      padding: 0 0.4rem;
      border: 1px solid var(--memo-border, grey);
      border-radius: 4px;
    }
    a {
      color: var(--memo-link, steelblue);
      text-decoration: none;
    }
    /* The form that takes a row's place. The row keeps its coloured edge, so which entry is being
       changed is still the thing the line says. */
    odate-form.in-row {
      display: block;
      margin-top: 0.3rem;
    }
    .edit {
      font: inherit;
      font-size: 0.85rem;
      color: var(--memo-link, steelblue);
      background: none;
      border: none;
      padding: 0.1rem 0;
      cursor: pointer;
      text-decoration: none;
    }
    .edit.danger {
      color: var(--memo-danger, red);
    }
    /* The row's two actions stay together, after what the entry says. The question takes the
       place of the actions while a deletion is being confirmed: the entry itself stays in the
       row, so the reader is looking at what they are about to remove. */
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: baseline;
      margin-top: 0.2rem;
    }
    .confirm-question {
      font-weight: bold;
    }
    @media (hover: hover) {
      a:hover,
      .edit:hover {
        text-decoration: underline;
      }
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    ${presentation_css(".notes ")}
    ${barcode_layout_css(".notes ")}
    ${markdown_notes_css(".notes ")}
  </style>
  <h2 id="heading">Coming up</h2>
  <p class="muted" id="state" hidden></p>
  <ul id="entries"></ul>
`;

export class CalendarList extends HTMLElement {
  private entries: Odate[] = [];
  private loading = false;
  private failed = false;
  private heading_text = "Coming up";
  private empty_text = "Nothing coming up. Add an entry above.";
  /// The entry being changed, whose row is the form. Held here because it is a row that changes
  /// shape, and rebuilt only when the reader moves to another entry — a form rebuilt under the
  /// hands of somebody typing in it would be a form that loses what they typed.
  private editing: Odate | null = null;
  private editing_form: OdateForm | null = null;
  /// The entry whose Delete has been pressed and which is waiting for a second press. Held here,
  /// like `editing`, because it is a row that changes shape.
  private confirming: Odate | null = null;
  private saving = false;
  private places: OdateLocation[] = [];
  private types: OdateType[] = [];

  constructor() {
    super();
    this.initialize().catch(err => konsole.error("Failed to initialize the calendar list", err));
  }

  private async initialize(): Promise<void> {
    const shadow = this.attachShadow({mode: "open"});
    shadow.innerHTML = template;

    // The renderer is a megabyte of wasm and arrives after this list has been drawn the first time,
    // so a note is on screen as its own text until then — and drawn again, once, when it is ready.
    await load_markdown().then(() => this.draw());
  }

  set entries_to_show(entries: Odate[]) {
    // An entry that is gone cannot still be the one waiting to be deleted.
    const confirming_id = this.confirming?.id;
    this.entries = entries;
    if (confirming_id !== undefined && !entries.some(entry => entry.id === confirming_id)) {
      this.confirming = null;
    }
    this.draw();
  }

  set show_loading(loading: boolean) {
    this.loading = loading;
    this.draw();
  }

  set show_failed(failed: boolean) {
    this.failed = failed;
    this.draw();
  }

  set title(text: string) {
    this.heading_text = text;
    this.draw();
  }

  set empty_message(text: string) {
    this.empty_text = text;
    this.draw();
  }

  /// The entry whose row becomes the form, or null when no row is being changed. The page hands
  /// this over when Edit is pressed on a row and takes it back when the change is done or given up.
  set editing_entry(entry: Odate | null) {
    // A row of its own per form: moving to another entry builds anew, and staying on this one keeps
    // what has been typed into it.
    if (entry === null || this.editing === null || this.editing.id !== entry.id) {
      this.editing_form = null;
    }
    this.editing = entry;
    // Changing an entry and deleting it are two different intentions; the second press on Delete
    // is not also a confirmation of a form that was left open on another row.
    if (entry !== null) this.confirming = null;
    this.draw();
  }

  /// Into the form that has just taken a row's place. Called after the row has been drawn, since a
  /// field that is not in the page cannot take the focus.
  focus_editing_form(): void {
    this.editing_form?.focus_first_field();
  }

  set is_saving(saving: boolean) {
    this.saving = saving;
    if (this.editing_form !== null) this.editing_form.is_saving = saving;
  }

  /// What the form inside a row offers in its two selects — the same lists the page gives the form
  /// at the top.
  set known_places(places: OdateLocation[]) {
    this.places = places;
    if (this.editing_form !== null) this.editing_form.known_places = places;
  }

  set known_types(types: OdateType[]) {
    this.types = types;
    if (this.editing_form !== null) this.editing_form.known_types = types;
  }

  /** Everything this list shows, drawn from the fields above. */
  draw(): void {
    const shadow = this.shadowRoot;
    if (!shadow) return;

    const heading = shadow.querySelector<HTMLElement>("#heading")!;
    const state = shadow.querySelector<HTMLElement>("#state")!;
    const list = shadow.querySelector<HTMLUListElement>("#entries")!;

    heading.textContent = this.heading_text;
    list.replaceChildren(...this.entries.map(entry => this.draw_entry(entry)));

    // A failed read must not be dressed as an empty list: "nothing coming up" under "could not read
    // your calendar" says the calendar is empty when the request merely failed.
    const message = this.loading ? "Loading…" : this.entries.length === 0 && !this.failed ? this.empty_text : "";
    state.textContent = message;
    state.hidden = message === "";
  }

  private draw_entry(entry: Odate): HTMLLIElement {
    const row = document.createElement("li");
    const soon = this.how_soon(entry);
    if (soon !== null) row.classList.add(soon);

    // The row being changed is the form, in the place the entry was: the reader's eye stays where
    // it was, and the top of the page stays what it has always been — the way to add one.
    if (this.editing !== null && this.editing.id === entry.id) {
      row.append(this.form_for(entry));
      return row;
    }

    const when = document.createElement("div");
    when.className = "when";
    if (entry.ongoing) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Happening now";
      when.append(badge);
    }
    const start = document.createElement("time");
    start.dateTime = new Date(entry.start_time).toISOString();
    start.textContent = when_format.format(entry.start_time);
    when.append(start);

    const end = document.createElement("span");
    end.className = "until";
    end.textContent = `→ ${end_format.format(entry.end_time)}`;
    when.append(end);
    row.append(when);

    const what = document.createElement("div");
    what.className = "what";
    what.textContent = entry.description || "No description";
    row.append(what);

    if (entry.memo_text) row.append(this.draw_notes(entry.memo_text));

    if (entry.location !== null || entry.type !== null) {
      const about = document.createElement("div");
      about.className = "about";
      if (entry.location !== null) {
        const place = document.createElement("span");
        place.textContent = entry.location.name;
        about.append(place);
        const at = this.coordinates_of(entry);
        if (at !== null) {
          const link = document.createElement("a");
          link.href = map_url(at);
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Map";
          const for_whom = document.createElement("span");
          for_whom.className = "visually-hidden";
          for_whom.textContent = ` of ${entry.location.name}, on Google Maps`;
          link.append(for_whom);
          about.append(link);
        }
      }
      if (entry.type !== null) {
        // A label rather than another word on the line: the type is the one thing here that is a
        // category — something the reader has decided means the same on every entry — and the thin
        // box is what says so at a glance.
        const type = document.createElement("span");
        type.className = "type";
        type.textContent = entry.type.name;
        about.append(type);
      }
      row.append(about);
    }

    row.append(this.draw_actions(entry));

    return row;
  }

  /// Edit and Delete, or the question that stands in for them while a deletion is being
  /// confirmed. The entry itself stays above, so the question is asked about something in view.
  private draw_actions(entry: Odate): HTMLElement {
    const actions = document.createElement("div");
    actions.className = "actions";

    if (this.confirming !== null && this.confirming.id === entry.id) {
      const question = document.createElement("span");
      question.className = "confirm-question";
      question.textContent = entry.description
        ? `Delete “${entry.description}”?`
        : "Delete this entry?";
      actions.append(question);

      actions.append(
        this.button("Yes, delete", "danger confirm", () => {
          this.confirming = null;
          this.draw();
          this.dispatchEvent(
            new CustomEvent("delete-entry", {detail: entry, bubbles: true, composed: true})
          );
        }),
        this.button("Cancel", "cancel", () => {
          this.confirming = null;
          this.draw();
        })
      );
      return actions;
    }

    const edit = this.button("Edit", "", () =>
      this.dispatchEvent(new CustomEvent("edit-entry", {detail: entry, bubbles: true, composed: true}))
    );
    edit.append(this.visually_hidden(` ${entry.description || "this entry"}`));

    const remove = this.button("Delete", "danger delete", () => {
      this.confirming = entry;
      this.draw();
    });
    remove.append(this.visually_hidden(` ${entry.description || "this entry"}`));

    actions.append(edit, remove);
    return actions;
  }

  private button(label: string, extra: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.classList.add("edit");
    // One token at a time: classList.add takes a single name per call and throws on a space.
    extra
      .split(" ")
      .filter(name => name !== "")
      .forEach(name => button.classList.add(name));
    button.addEventListener("click", run);
    return button;
  }

  private visually_hidden(text: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "visually-hidden";
    span.textContent = text;
    return span;
  }

  /// The form for the row being changed, built once and then handed back on every redraw: the same
  /// element keeps what is in its fields, where a new one would not.
  private form_for(entry: Odate): OdateForm {
    if (this.editing_form === null) {
      const form = document.createElement("odate-form") as OdateForm;
      form.classList.add("in-row");
      this.editing_form = form;
      // Filled before it is in the page, and only once: `editing` draws the fields from the entry.
      form.editing = entry;
      form.known_places = this.places;
      form.known_types = this.types;
      form.is_saving = this.saving;
    }
    return this.editing_form;
  }

  private draw_notes(note: string): HTMLElement {
    const html = render_markdown(note);
    if (html === null) {
      const plain = document.createElement("p");
      plain.className = "notes";
      plain.style.whiteSpace = "pre-wrap";
      plain.textContent = note;
      return plain;
    }

    const notes = document.createElement("div");
    notes.className = "notes";
    // The renderer's own output, which it has already put through ammonia: the same list the memo
    // app holds its memos to, and the reason a barcode in a note draws here as it does there.
    notes.innerHTML = html;
    return notes;
  }

  /** The entry's point, or null when it has no location or that location is not on the earth. */
  private coordinates_of(entry: Odate) {
    const place = entry.location;
    if (place === null) return null;
    if (place.latitude === null || place.latitude === undefined) return null;
    if (place.longitude === null || place.longitude === undefined) return null;
    return {latitude: place.latitude, longitude: place.longitude};
  }

  /**
   * How soon the entry is, which is what the line beside it is coloured by. One answer, never two.
   *
   * The first is the server's own `ongoing` flag and the rest are worked out from this browser's
   * clock. That split is deliberate: which entries are in the list at all is the server's decision —
   * a clock that was wrong there would hide an entry — while the date printed beside each entry goes
   * through this browser's clock, so the day it falls on has to be read the same way. A server in
   * another timezone would otherwise colour a line orange beside a date reading tomorrow, for the
   * hours around midnight.
   */
  private how_soon(entry: Odate): "happening" | "today" | "week" | null {
    if (entry.ongoing) return "happening";

    const days = whole_days_between(start_of_day(new Date()), start_of_day(new Date(entry.start_time)));
    // Behind us and not running: it is over, and it is nothing of today's or this week's business.
    if (days < 0) return null;
    if (days === 0) return "today";
    if (days <= 7) return "week";
    return null;
  }
}

konsole.log("Registering calendar-list web component");
customElements.define("calendar-list", CalendarList);
