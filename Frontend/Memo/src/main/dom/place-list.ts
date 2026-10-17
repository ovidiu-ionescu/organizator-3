/**
 * @prettier
 *
 * One panel of named things: the reader's locations, or their date types. The same component twice,
 * with different words — the two differ only in that a location may be put on the earth.
 *
 * The panel owns the small states of its own rows — which one is being renamed, which one is being
 * deleted and is asking a second time — and hands every change to the page, which is what talks to
 * the server and knows what else on the screen has to be redrawn.
 */
import konsole from "./console_log.js";
import type {Named} from "./odate_api.js";
import {format_coordinates, parse_coordinates} from "./coordinates.js";
import type {Coordinates} from "./coordinates.js";

/// Why a name cannot be written, in the reader's words. Beyond the parse itself, the reason is the
/// server's and the page passes it in.
const template = `
  <style>
    :host {
      display: block;
    }
    h2 {
      margin: 0 0 0.4rem 0;
      font-size: 1.1rem;
    }
    .create {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: baseline;
      margin-bottom: 0.4rem;
    }
    /* A row is what it is called with its two actions on that line, and anything else it has to
       say — where it is, and a way to look at it — underneath. */
    .row {
      border-left: 3px solid var(--memo-border, grey);
      padding-left: 0.6rem;
      margin-bottom: 0.6rem;
    }
    /* The two words ride just after the name rather than out at the far edge of the panel: they are
       about this row, and a line with a name at one end and its actions at the other reads as two
       things rather than one. */
    .row-head {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: baseline;
    }
    .actions,
    .aside {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: baseline;
    }
    .aside {
      font-size: 0.9rem;
      opacity: 0.9;
    }
    .edit-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: baseline;
    }
    input {
      font: inherit;
      padding: 0.2rem 0.4rem;
      border: 1px solid var(--memo-border, grey);
      border-radius: 4px;
      background-color: var(--memo-field-bg, #2b2b2b);
      color: var(--memo-fg, white);
    }
    /* The button the row starts with — Create — is a button. What a row offers on its own line is
       a word: the way this screen has always read, and the reason Delete can be red without two
       red boxes shouting on every row. */
    button {
      font: inherit;
      padding: 0.2rem 0.4rem;
      border: 1px solid var(--memo-border, grey);
      border-radius: 4px;
      background: none;
      color: var(--memo-fg, white);
      cursor: pointer;
      font-size: 0.9rem;
    }
    .primary {
      border-color: var(--memo-link, steelblue);
      color: var(--memo-link, steelblue);
    }
    .link {
      font: inherit;
      font-size: 0.9rem;
      padding: 0;
      border: none;
      background: none;
      color: var(--memo-link, steelblue);
      text-decoration: none;
      cursor: pointer;
    }
    .link.danger {
      color: var(--memo-danger, red);
    }
    .name {
      font-weight: bold;
    }
    a {
      color: var(--memo-link, steelblue);
      text-decoration: none;
    }
    /* Underlined when the pointer is on it, and not before. */
    @media (hover: hover) {
      a:hover,
      .link:hover {
        text-decoration: underline;
      }
    }
    .status {
      min-height: 1.1rem;
      font-size: 0.9rem;
      margin: 0.1rem 0;
      flex-basis: 100%;
    }
    .status.error { color: var(--memo-happening, red); }
    .muted { opacity: 0.7; }
    .placeholder {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      flex-basis: 100%;
    }
  </style>
  <h2 id="heading" tabindex="-1"></h2>
  <p class="status" id="panel_status" role="status" aria-live="polite"></p>
  <div class="create">
    <label for="new_name" id="new_label"></label>
    <input type="text" id="new_name">
    <label for="new_coords" id="new_coords_label">Coordinates</label>
    <input type="text" id="new_coords" placeholder="44.4268, 26.1025">
    <button type="button" id="create_button" class="primary">Create</button>
    <p class="status" id="create_status" role="status" aria-live="polite"></p>
  </div>
  <p class="muted" id="empty" hidden></p>
  <div id="rows"></div>
`;

export class PlaceListPanel extends HTMLElement {
  private $: {[key: string]: HTMLElement} = {};
  private places: Named[] = [];
  private loading = false;
  private failed = false;
  private editing_id: number | null = null;
  private confirming_id: number | null = null;
  /// Whether a location's coordinates are shown and editable. The panel's whole difference.
  private with_coordinates = false;
  /// What each row's status line is saying, keyed by place — null being the panel's own line.
  private statuses = new Map<number | null, {text: string; error: boolean}>();

  constructor() {
    super();
    this.initialize().catch(err => konsole.error("Failed to initialize the place panel", err));
  }

  private async initialize(): Promise<void> {
    const shadow = this.attachShadow({mode: "open"});
    shadow.innerHTML = template;
    shadow.querySelectorAll<HTMLElement>("[id]").forEach(element => {
      this.$[element.id] = element;
    });

    this.$["create_button"].addEventListener("click", () => this.create());
    this.$["new_name"].addEventListener("keydown", event => {
      if ((event as KeyboardEvent).key === "Enter") this.create();
    });
    this.draw();
  }

  // The words, as attributes, so that the page's markup says which panel this is.
  static get observedAttributes(): string[] {
    return ["heading", "new-label", "placeholder", "empty-text", "with-coordinates"];
  }

  attributeChangedCallback(): void {
    if (this.shadowRoot) this.draw();
  }

  set places_to_show(places: Named[]) {
    this.places = places;
    // A row that is gone cannot still be the one being renamed.
    if (this.editing_id !== null && !places.some(place => place.id === this.editing_id)) {
      this.editing_id = null;
    }
    if (this.confirming_id !== null && !places.some(place => place.id === this.confirming_id)) {
      this.confirming_id = null;
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

  /** What a row — or the panel, when id is null — has to say. An empty text clears it. */
  show_status(id: number | null, text: string, error: boolean = false): void {
    if (text === "") this.statuses.delete(id);
    else this.statuses.set(id, {text, error});
    this.draw();
  }

  private create(): void {
    const name = (this.$["new_name"] as HTMLInputElement).value.trim();
    const coords_text = (this.$["new_coords"] as HTMLInputElement).value;
    if (name === "") return;

    const at = this.read_coordinates(coords_text, 0);
    // undefined is "it is not a pair": the message is already up and nothing is sent. null is
    // "nothing was typed", which is a location without a point.
    if (at === undefined) return;

    // Cleared as it is sent, not once it is accepted: a refusal is shown in the status line, and
    // leaving the text in the field would have the reader send it a second time.
    (this.$["new_name"] as HTMLInputElement).value = "";
    (this.$["new_coords"] as HTMLInputElement).value = "";

    this.dispatchEvent(
      new CustomEvent("place-create", {
        detail: {name, coordinates: at, what: this.what()},
        bubbles: true,
        composed: true,
      })
    );
  }

  /// The point that was typed: null when nothing was, undefined when what was typed is not a pair —
  /// and then the message is up and the caller sends nothing.
  private read_coordinates(text: string, id: number | null): Coordinates | null | undefined {
    if (text.trim() === "") return null;
    const at = parse_coordinates(text);
    if (at === null) {
      // What was typed stays where it is: the reader is one character away from a pair the app can
      // read, and clearing the field would take that away from them.
      this.show_status(
        id,
        `“${text.trim()}” is not a latitude and longitude. Paste them as 44.4268, 26.1025.`,
        true
      );
      return undefined;
    }
    return at;
  }

  private save_row(id: number): void {
    const name = (this.shadowRoot?.querySelector(`#name_${id}`) as HTMLInputElement | null)?.value.trim();
    if (name === undefined || name === "") return;

    const coords_input = this.shadowRoot?.querySelector(`#coords_${id}`) as HTMLInputElement | null;
    const coords_text = coords_input?.value ?? "";
    const at = this.read_coordinates(coords_text, id);
    if (at === undefined) return; // not a pair, and the row already says so

    const place = this.places.find(row => row.id === id);
    // Nothing changed, so there is nothing to ask the server: a rename to the name it already has,
    // or a save on a row nobody touched, closes the row and no more.
    const same_name = place !== undefined && place.name === name;
    const same_point = this.same_point(place, at ?? null);
    if (same_name && same_point) {
      this.editing_id = null;
      this.draw();
      return;
    }

    this.show_status(id, "");
    this.dispatchEvent(
      new CustomEvent("place-save", {
        detail: {id, name, coordinates: at ?? null, what: this.what()},
        bubbles: true,
        composed: true,
      })
    );
  }

  private same_point(place: Named | undefined, at: Coordinates | null): boolean {
    if (place === undefined) return at === null;
    const known = place as {latitude?: number | null; longitude?: number | null};
    if (!this.with_coordinates) return true;
    if (at === null) return known.latitude === null && known.longitude === null;
    return known.latitude === at.latitude && known.longitude === at.longitude;
  }

  private confirm_delete(id: number): void {
    this.confirming_id = null;
    this.editing_id = null;
    this.show_status(id, "");
    this.dispatchEvent(
      new CustomEvent("place-remove", {detail: {id, what: this.what()}, bubbles: true, composed: true})
    );
  }

  /// The words the page passes in, for the messages this panel makes itself. "the location" or "the
  /// date type" — no name, because a create has not got one yet.
  private what(): string {
    return this.hasAttribute("with-coordinates") ? "the location" : "the date type";
  }

  draw(): void {
    const shadow = this.shadowRoot;
    if (!shadow) return;

    const heading = this.getAttribute("heading") ?? "";
    const new_label = this.getAttribute("new-label") ?? "New";
    const placeholder = this.getAttribute("placeholder") ?? "";
    this.with_coordinates = this.hasAttribute("with-coordinates");

    (this.$["heading"] as HTMLElement).textContent = heading;
    (this.$["new_label"] as HTMLElement).textContent = new_label;
    (this.$["new_name"] as HTMLInputElement).placeholder = placeholder;
    (this.$["new_coords"] as HTMLInputElement).hidden = !this.with_coordinates;
    (this.$["new_coords_label"] as HTMLElement).hidden = !this.with_coordinates;

    const panel_status = this.statuses.get(null);
    (this.$["panel_status"] as HTMLElement).textContent = panel_status?.text ?? "";
    (this.$["panel_status"] as HTMLElement).classList.toggle("error", panel_status?.error === true);

    const create_status = this.statuses.get(0);
    (this.$["create_status"] as HTMLElement).textContent = create_status?.text ?? "";
    (this.$["create_status"] as HTMLElement).classList.toggle("error", create_status?.error === true);

    const empty = this.$["empty"] as HTMLElement;
    empty.hidden = !(this.places.length === 0 && !this.loading && !this.failed);
    empty.textContent = this.getAttribute("empty-text") ?? "";
    if (this.loading && this.places.length === 0) {
      empty.hidden = false;
      empty.textContent = "Loading…";
    }

    (this.$["rows"] as HTMLElement).replaceChildren(
      ...this.places.map(place => this.draw_row(place))
    );
  }

  private draw_row(place: Named): HTMLElement {
    const row = document.createElement("div");
    row.className = "row";

    if (this.editing_id === place.id) {
      row.classList.add("edit-row");
      const name = document.createElement("input");
      name.type = "text";
      name.id = `name_${place.id}`;
      name.value = place.name;
      row.append(name);

      if (this.with_coordinates) {
        const coords = document.createElement("input");
        coords.type = "text";
        coords.id = `coords_${place.id}`;
        coords.placeholder = "44.4268, 26.1025";
        const known = place as {latitude?: number | null; longitude?: number | null};
        coords.value =
          known.latitude === null || known.latitude === undefined || known.longitude === null || known.longitude === undefined
            ? ""
            : format_coordinates({latitude: known.latitude, longitude: known.longitude});
        row.append(coords);
      }

      const buttons = document.createElement("span");
      buttons.className = "actions";
      buttons.append(
        this.button("Save", "primary", () => this.save_row(place.id)),
        this.button("Cancel", "", () => {
          this.editing_id = null;
          this.draw();
        })
      );
      row.append(buttons);
      this.append_status(row, place.id);
      return row;
    }

    if (this.confirming_id === place.id) {
      const question = document.createElement("span");
      question.textContent = `Delete ${place.name}?`;
      const answer = document.createElement("span");
      answer.className = "actions";
      answer.append(
        this.button("Yes, delete", "link danger", () => this.confirm_delete(place.id)),
        this.button("Cancel", "link", () => {
          this.confirming_id = null;
          this.draw();
        })
      );
      row.append(question, answer);
      this.append_status(row, place.id);
      return row;
    }

    const head = document.createElement("div");
    head.className = "row-head";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = place.name;
    head.append(name);

    const action = this.with_coordinates ? "Edit" : "Rename";
    const action_button = this.button(action, "link", () => {
      this.editing_id = place.id;
      this.confirming_id = null;
      this.draw();
    });
    action_button.append(this.visually_hidden(` ${place.name}`));
    const delete_button = this.button("Delete", "link danger", () => {
      this.confirming_id = place.id;
      this.editing_id = null;
      this.draw();
    });
    delete_button.append(this.visually_hidden(` ${place.name}`));

    const actions = document.createElement("span");
    actions.className = "actions";
    actions.append(action_button, delete_button);
    head.append(actions);
    row.append(head);

    // Where it is, under the name: the coordinates and the way to look at them, on a line of their
    // own rather than crowding the two actions.
    if (this.with_coordinates) {
      const known = place as {latitude?: number | null; longitude?: number | null};
      if (known.latitude !== null && known.latitude !== undefined && known.longitude !== null && known.longitude !== undefined) {
        const at = {latitude: known.latitude, longitude: known.longitude};
        const aside = document.createElement("div");
        aside.className = "aside";

        const coords = document.createElement("span");
        coords.className = "coords";
        coords.textContent = format_coordinates(at);
        aside.append(coords);

        // Just "Map": the name it belongs to is the line above it, so a longer label repeating the
        // name is a label saying what the reader has already read. (The words that used to be here
        // were meant to be for a screen reader only — and were visible, because a class named in
        // one shadow root says nothing in another.)
        const link = document.createElement("a");
        link.href = `https://www.google.com/maps?q=${at.latitude},${at.longitude}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Map";
        aside.append(link);

        row.append(aside);
      }
    }

    this.append_status(row, place.id);
    return row;
  }

  private append_status(row: HTMLElement, id: number): void {
    const status = document.createElement("p");
    status.className = "status";
    // Always in the page, like the panel's own: a live region has to be there before the words
    // arrive, or what it says is never read out.
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const said = this.statuses.get(id);
    status.textContent = said?.text ?? "";
    if (said?.error === true) status.classList.add("error");
    row.append(status);
  }

  private button(label: string, extra: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
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
    span.style.position = "absolute";
    span.style.width = "1px";
    span.style.height = "1px";
    span.style.overflow = "hidden";
    span.style.clipPath = "inset(50%)";
    span.style.whiteSpace = "nowrap";
    return span;
  }

  /// The change went through: the row goes back to being a row rather than a form. Called by the
  /// page, which is the one that knows the server took it — a refused save keeps the fields as the
  /// reader left them, so that they are one correction away from being sent again.
  change_done(): void {
    this.editing_id = null;
    this.confirming_id = null;
    this.draw();
  }

  /// The heading, so that the page can put the focus back after a row has gone.
  focus_heading(): void {
    (this.$["heading"] as HTMLElement | undefined)?.focus();
  }
}

konsole.log("Registering place-list-panel web component");
customElements.define("place-list-panel", PlaceListPanel);
