/**
 * @prettier
 *
 * The calendar: the reader's entries, and the two lists of names an entry is filed under.
 *
 * This is where the state lives and where the reloads are decided, because which read has to follow
 * which write is the one thing that cannot be seen from any single component: renaming a location
 * changes every entry on the screen, since each of them carries a copy of the name, while deleting
 * one changes only the list it was in.
 */
import konsole from "./console_log.js";
import {UnauthenticatedError, go_to_login} from "./http.js";
import * as api from "./odate_api.js";
import type {NewOdate, Odate, OdateLocation, OdateType} from "./odate_api.js";
import {ServerRefusal} from "./odate_api.js";
import {day_end, day_start} from "./day_range.js";
import type {DayRange} from "./day_range.js";
import {log_out, set_app_entries} from "./app-menu.js";
import {format_when} from "./calendar-list.js";
import "./odate-form.js";
import "./place-list.js";
// The theme control, the same element the editor carries: one choice, remembered under the one key,
// so the theme a reader picks on this page is the one they get on the memo page too.
import "./theme-list.js";
import type {CalendarList} from "./calendar-list.js";
import type {DuplicateRequest, OdateForm} from "./odate-form.js";
import type {PlaceListPanel} from "./place-list.js";
import {repeated_times} from "./recurrence.js";
import {parse_shared_event, read_shared_inbox} from "./shared_event.js";

const template = `
  <style>
    :host {
      display: block;
      padding: 0.75rem;
      max-width: 60rem;
      margin: 0 auto;
      box-sizing: border-box;
      font-family: var(--memo-font, sans-serif);
    }
    header {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 0.75rem;
      /* The menu button is fixed over the top-right corner of the window. On a phone this column
         runs to that corner, so the theme control would be underneath it — a tap meant for the
         theme would open the menu, which is how it was. Room is kept for the button instead. */
      padding-right: 3.5rem;
    }
    h1 {
      font-size: 1.3rem;
      margin: 0;
    }
    .panel {
      border: 1px solid var(--memo-border, grey);
      border-radius: 4px;
      padding: 0.6rem;
      margin-bottom: 1rem;
    }
    .search-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: baseline;
    }
    /* One unit per label-and-field, and no breaking inside one: the row is what wraps. */
    .pair {
      display: flex;
      flex-wrap: nowrap;
      gap: 0.4rem;
      align-items: baseline;
    }
    label {
      font-size: 0.9rem;
      opacity: 0.85;
    }
    /* Wide enough that a two-word search stays visible while it is typed, and narrow enough
       that the row's buttons stay on the same line at a laptop width. */
    #search_text {
      width: 10rem;
      box-sizing: border-box;
    }
    /* The same field fill as the form and the panels use, so that every box you can type into on
       this page looks like one. A button is not a field and keeps the page behind it. */
    input,
    button {
      font: inherit;
      padding: 0.2rem 0.4rem;
      border: 1px solid var(--memo-border, grey);
      border-radius: 4px;
      background: none;
      color: var(--memo-fg, white);
    }
    input {
      background-color: var(--memo-field-bg, #2b2b2b);
    }
    button {
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .primary {
      border-color: var(--memo-link, steelblue);
      color: var(--memo-link, steelblue);
    }
    /* Always in the page, and given a height: a live region that arrives with its text is one
       nothing reads out, and a page that grows a line as a message appears moves what is under the
       reader's finger. */
    .status {
      min-height: 1.25rem;
      margin: 0.2rem 0 0 0;
      font-size: 0.9rem;
    }
    .status.error {
      color: var(--memo-happening, red);
    }
    /* Room between the form and the list under it: they are two different things, and the one below
       starts with a heading that was reading as part of the form. */
    calendar-list {
      display: block;
      margin-top: 1.75rem;
    }
  </style>
  <header>
    <h1>Calendar</h1>
    <theme-list></theme-list>
  </header>
  <section class="panel">
    <form id="search_form" class="search-row">
      <!-- A label and the field it belongs to travel together: the row wraps on a phone, and a
           "To" left at the end of one line with its date at the start of the next reads as a label
           for whatever happens to follow it. -->
      <span class="pair">
        <label for="search_text">Text</label>
        <input type="search" id="search_text" placeholder="words in the entry">
      </span>
      <span class="pair">
        <label for="search_from">From</label>
        <input type="date" id="search_from">
      </span>
      <span class="pair">
        <label for="search_until">To</label>
        <input type="date" id="search_until">
      </span>
      <button type="submit" id="search_button" class="primary">Search</button>
      <button type="button" id="clear_button" disabled>Clear</button>
    </form>
  </section>
  <p class="status" id="status" role="status" aria-live="polite"></p>
  <odate-form id="form"></odate-form>
  <calendar-list id="list"></calendar-list>
  <place-list-panel
    id="locations"
    heading="Locations"
    new-label="New location"
    placeholder="Office"
    empty-text="You have no locations yet. Add one above, then choose it on an entry."
    with-coordinates
  ></place-list-panel>
  <place-list-panel
    id="types"
    heading="Date types"
    new-label="New date type"
    placeholder="Meeting"
    empty-text="You have no date types yet. Add one above, then choose it on an entry."
  ></place-list-panel>
`;

export class CalendarPage extends HTMLElement {
  private $: {[key: string]: HTMLElement} = {};

  private odates: Odate[] = [];
  private locations: OdateLocation[] = [];
  private types: OdateType[] = [];
  private editing: Odate | null = null;
  private searched: DayRange | null = null;
  /// What the text box is looking for, kept with the range so that a reload after a write looks
  /// at the same thing the reader was looking at.
  private search_text = "";
  private saving = false;
  private loading_odates = false;
  private loading_locations = false;
  private loading_types = false;
  private list_failed = false;
  private locations_failed = false;
  private types_failed = false;
  private status_text = "";
  private status_is_error = false;

  constructor() {
    super();
    this.initialize().catch(err => konsole.error("Failed to initialize the calendar", err));
  }

  private async initialize(): Promise<void> {
    const shadow = this.attachShadow({mode: "open"});
    shadow.innerHTML = template;
    shadow.querySelectorAll<HTMLElement>("[id]").forEach(element => {
      this.$[element.id] = element;
    });

    (this.$["search_form"] as HTMLFormElement).addEventListener("submit", event => {
      event.preventDefault(); // a submit event does not stop the native GET by itself
      this.search();
    });
    this.$["clear_button"].addEventListener("click", () => this.clear_search());

    // A form that is done with — cancelled, or closed — is nothing being changed any more, so the
    // row it was standing in goes back to being the entry.
    this.addEventListener("form-closed", () => {
      if (this.editing === null) return;
      this.editing = null;
      this.draw();
    });

    this.list.addEventListener("edit-entry", event => {
      // The form opens where the entry is, not at the top: the top is the way to add one, and an
      // entry being changed is one the reader is looking at.
      this.editing = (event as CustomEvent<Odate>).detail;
      this.draw();
      this.list.focus_editing_form();
    });
    // Sent only after the row has asked a second time: the list owns the question and the page
    // owns the request.
    this.list.addEventListener("delete-entry", event => {
      void this.delete_entry((event as CustomEvent<Odate>).detail);
    });
    // On the page rather than on either form: there are two of them now — the one at the top and
    // the one that takes a row's place while it is being changed, which is inside the list's own
    // shadow root — and both dispatch this.
    this.addEventListener("entry-submit", event => {
      const detail = (event as CustomEvent<{id: number | null; entry: NewOdate}>).detail;
      if (detail.id === null) void this.create_entry(detail.entry);
      else void this.update_entry(detail.id, detail.entry);
    });
    this.addEventListener("entry-duplicate", event => {
      void this.duplicate_entry((event as CustomEvent<DuplicateRequest>).detail);
    });

    this.wire_panel("locations", "location");
    this.wire_panel("types", "type");

    // The menu is about the app, not about memos: on this page it offers the way back to them.
    set_app_entries(() => [
      // The way back to the memos, wearing the note the app draws memos with — the counterpart of
      // the calendar entry in the memo app's own menu.
      {
        label: "Memos",
        icon: "/images/ic_insert_comment_48px.svg",
        run: (_progress, close) => (close(), window.location.assign("/memo/")),
      },
      // The other entry with a picture, so the two destinations outside this app sit together.
      {
        label: "User administration",
        icon: "/images/ic_people_48px.svg",
        run: (_progress, close) => (close(), window.location.assign("/user-admin/")),
      },
      {label: "Memo Maintenance", run: (_progress, close) => (close(), window.location.assign("/memo/$$$admin"))},
      {label: "Journal", run: (_progress, close) => (close(), window.location.assign("/journal"))},
      {label: "Log out", run: (_progress, close) => (close(), void log_out())},
    ]);

    await Promise.all([this.load_odates(), this.load_locations(), this.load_odate_types()]);
    // After the lists: a shared event may name a place, and matching it is what chooses one.
    await this.take_share();
  }

  /**
   * An event shared into the app, from the Android share sheet — the one door a web app has into
   * another app's "add to calendar". The share's own words open the add form, the way a native
   * calendar opens its insert screen; the reader checks and saves, and nothing is made up when
   * the share did not say when the event is.
   */
  private async take_share(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    // A POST share — the only kind that can carry an .ics file — is handed over through the
    // worker's cache. The query parameters are the same fields for a GET share or a direct link.
    const inbox = await read_shared_inbox();
    const shared = parse_shared_event(
      inbox ?? {
        title: params.get("title"),
        text: params.get("text"),
        url: params.get("url"),
      }
    );
    if (
      shared.description === undefined &&
      shared.memo_text === undefined &&
      shared.start_time === undefined &&
      shared.end_time === undefined
    ) {
      return;
    }

    const wanted = shared.location?.trim().toLowerCase();
    const place =
      wanted === undefined
        ? undefined
        : this.locations.find(known => known.name.trim().toLowerCase() === wanted);

    let notes = shared.memo_text;
    if (shared.location !== undefined && place === undefined) {
      // A place that is not one of the reader's own becomes a line of the note rather than a new
      // location: the share is not a reason to add rows to the lists on this page.
      notes = `Location: ${shared.location}` + (notes === undefined ? "" : `\n\n${notes}`);
    }

    this.form.fill_for_new({
      start_time: shared.start_time,
      end_time: shared.end_time,
      description: shared.description,
      memo_text: notes,
      location_id: place?.id,
    });
    this.set_status("From the shared event. Check the details and press Add entry.");
  }

  private get list(): CalendarList {
    return this.$["list"] as CalendarList;
  }

  private get form(): OdateForm {
    return this.$["form"] as OdateForm;
  }

  private panel(id: string): PlaceListPanel {
    return this.$[id] as PlaceListPanel;
  }

  // ---- the reads ---------------------------------------------------------------------------

  /**
   * The entries, over the range being looked at — or over what is coming, when there is none.
   *
   * A reload after a save replays *that* range rather than quietly widening back to the plain list:
   * somebody who searched a stretch of last March and then corrected an entry in it is looking at
   * March.
   */
  private async load_odates(announce?: string): Promise<void> {
    this.loading_odates = true;
    if (announce === undefined) this.set_status("");
    this.draw();

    try {
      this.odates = await api.read_odates({
        ...(this.searched ?? {}),
        ...(this.search_text === "" ? {} : {q: this.search_text}),
      });
      this.list_failed = false;
      // Said once the list is back, not before: the reload clears the status on its way out, and a
      // message set first would be wiped by the reload it caused.
      if (announce !== undefined) this.set_status(announce);
    } catch (e) {
      if (e instanceof UnauthenticatedError) return go_to_login();
      this.list_failed = true;
      this.clear_entries();
      this.set_status("Could not read your calendar.", true);
      konsole.error("Failed to load the calendar", e);
    } finally {
      this.loading_odates = false;
      this.draw();
    }
  }

  private async load_locations(announce?: string): Promise<void> {
    this.loading_locations = true;
    this.draw();
    try {
      this.locations = await api.read_locations();
      this.locations_failed = false;
      if (announce !== undefined) this.panel("locations").show_status(null, announce);
    } catch (e) {
      if (e instanceof UnauthenticatedError) return go_to_login();
      this.locations_failed = true;
      this.locations = [];
      this.panel("locations").show_status(null, "Could not read your locations.", true);
      konsole.error("Failed to load the locations", e);
    } finally {
      this.loading_locations = false;
      this.draw();
    }
  }

  private async load_odate_types(announce?: string): Promise<void> {
    this.loading_types = true;
    this.draw();
    try {
      this.types = await api.read_odate_types();
      this.types_failed = false;
      if (announce !== undefined) this.panel("types").show_status(null, announce);
    } catch (e) {
      if (e instanceof UnauthenticatedError) return go_to_login();
      this.types_failed = true;
      this.types = [];
      this.panel("types").show_status(null, "Could not read your date types.", true);
      konsole.error("Failed to load the date types", e);
    } finally {
      this.loading_types = false;
      this.draw();
    }
  }

  // ---- searching ---------------------------------------------------------------------------

  /**
   * Looks at a stretch of time instead of at what is coming.
   *
   * Either field may be left empty, and that is a question rather than a mistake: "everything since
   * March" and "everything up to June" are both worth asking. Both empty is the plain list again, so
   * pressing Search on two empty fields reads as clearing rather than as a search for nothing.
   */
  private search(): void {
    const text = (this.$["search_text"] as HTMLInputElement).value.trim();
    const start = day_start((this.$["search_from"] as HTMLInputElement).value);
    const end = day_end((this.$["search_until"] as HTMLInputElement).value);

    if (start === null && end === null && text === "") {
      this.clear_search();
      return;
    }

    const range: DayRange = {};
    if (start !== null) range.from = start;
    if (end !== null) range.until = end;

    // No dates is no range, not an empty one: a text search on its own must not read as
    // "between those dates", and the server takes it over the whole calendar.
    this.searched = start === null && end === null ? null : range;
    this.search_text = text;
    void this.load_odates();
  }

  /** Back to the list the screen opens with, and the fields emptied with it. */
  private clear_search(): void {
    (this.$["search_text"] as HTMLInputElement).value = "";
    (this.$["search_from"] as HTMLInputElement).value = "";
    (this.$["search_until"] as HTMLInputElement).value = "";
    this.searched = null;
    this.search_text = "";
    void this.load_odates();
  }

  // ---- writing an entry --------------------------------------------------------------------

  private async create_entry(entry: NewOdate): Promise<void> {
    await this.write_entry(() => api.create_odate(entry), created => {
      this.form.clear_after_create();
      // The form stays open after a new entry, so another can follow straight away.
      void this.load_odates(`Added “${created.description ?? "entry"}”.`);
    }, "add");
  }

  private async update_entry(id: number, entry: NewOdate): Promise<void> {
    await this.write_entry(() => api.update_odate(id, entry), updated => {
      // ...and the row it was goes back to being the entry, with the change in it.
      this.editing = null;
      void this.load_odates(`Saved “${updated.description ?? "entry"}”.`);
    }, "save");
  }

  /**
   * Copy an entry at a regular interval, adding only the copies that are not there yet.
   *
   * A copy already there is one starting at the same instant and carrying the same description.
   * That is what makes a second run over a longer stretch safe — the copies the first run made
   * hold both — while an entry somebody else put at that time, which is about something else, is
   * not mistaken for one of these copies. The check is a read of the whole stretch being filled
   * rather than of the list on screen, which may be narrowed by a search or a date range.
   */
  private async duplicate_entry(request: DuplicateRequest): Promise<void> {
    this.saving = true;
    this.set_status("");
    this.draw();

    const {entry, count, unit} = request;
    const times = repeated_times(entry.start_time, entry.end_time, count, unit);
    const what = entry.description ?? "entry";
    let created = 0;

    try {
      // Nothing to ask for, and no stretch to read.
      if (times.length === 0) return;

      const from = Math.min(...times.map(at => at.start_time));
      const until = Math.max(...times.map(at => at.end_time));
      const existing = await api.read_odates({from, until});
      // The server answers with null for an entry that has no description, while the form leaves
      // it out — the two are the same answer, so both are written the same way in the key.
      const copy_key = (start: number, description: string | null | undefined) =>
        `${start}\u0000${description ?? ""}`;
      const occupied = new Set(existing.map(known => copy_key(known.start_time, known.description)));
      const skipped_at: number[] = [];

      for (const at of times) {
        if (occupied.has(copy_key(at.start_time, entry.description))) {
          skipped_at.push(at.start_time);
          continue;
        }
        await api.create_odate({...entry, start_time: at.start_time, end_time: at.end_time});
        created++;
      }

      // The dates that were passed over, in the list's own words: a count says something was
      // skipped, the dates say which.
      const dates = skipped_at.map(format_when);
      const when = dates.length <= 1
        ? dates[0] ?? ""
        : `${dates.slice(0, -1).join(", ")} and ${dates[dates.length - 1]}`;

      const message = created === 0
        ? `Nothing was added. The event already existed on ${when}.`
        : skipped_at.length === 0
          ? `Added ${created} ${created === 1 ? "copy" : "copies"} of “${what}”.`
          : `Added ${created} ${created === 1 ? "copy" : "copies"} of “${what}”; ${skipped_at.length} already existed. The event already existed on ${when}.`;

      await this.load_odates();
      // Under the buttons of the form that asked for it, where the reader is looking; the page's
      // own line is the fallback for a form that was closed while the request was in flight.
      if (!this.list.show_editing_status(message)) this.set_status(message);
    } catch (e) {
      if (e instanceof UnauthenticatedError) return go_to_login();
      konsole.error("Failed to duplicate the entry", e);
      const reason = e instanceof ServerRefusal
        ? api.entry_change_failed(e, "duplicate")
        : "Could not duplicate the entry.";
      // Some copies may already have been made. They are not lost: the next run skips them.
      const so_far = created === 0
        ? ""
        : ` ${created} ${created === 1 ? "copy was" : "copies were"} added before the failure.`;
      const message = `${reason}${so_far}`;
      if (!this.list.show_editing_status(message, true)) this.set_status(message, true);
    } finally {
      this.saving = false;
      this.draw();
    }
  }

  /**
   * Remove an entry, once its row has asked a second time.
   *
   * The reload is the range being looked at, like every other change: an entry removed from a
   * search result must not widen the screen back to the plain list.
   */
  private async delete_entry(entry: Odate): Promise<void> {
    this.saving = true;
    this.set_status("");
    this.draw();

    try {
      await api.delete_odate(entry.id);
      // A form open on the entry that has just gone has nothing left to save.
      if (this.editing?.id === entry.id) this.editing = null;
      await this.load_odates(`Deleted “${entry.description ?? "entry"}”.`);
    } catch (e) {
      if (e instanceof UnauthenticatedError) return go_to_login();
      konsole.error("Failed to delete the entry", e);
      this.set_status(
        e instanceof ServerRefusal ? api.entry_change_failed(e, "delete") : "Could not delete the entry.",
        true
      );
    } finally {
      this.saving = false;
      this.draw();
    }
  }

  /** One write, and what follows it. Only the "what follows" differs between the two. */
  private async write_entry(
    send: () => Promise<Odate>,
    done: (entry: Odate) => void,
    doing: string
  ): Promise<void> {
    this.saving = true;
    this.set_status("");
    this.draw();

    try {
      const entry = await send();
      done(entry);
    } catch (e) {
      if (e instanceof UnauthenticatedError) return go_to_login();
      konsole.error(`Failed to ${doing} the entry`, e);
      this.set_status(
        e instanceof ServerRefusal ? api.entry_change_failed(e, doing) : `Could not ${doing} the entry.`,
        true
      );
    } finally {
      this.saving = false;
      this.draw();
    }
  }

  // ---- the two name lists ------------------------------------------------------------------

  private wire_panel(id: string, kind: "location" | "type"): void {
    const panel = this.panel(id);
    const what = kind === "location" ? "the location" : "the date type";
    const reload = (announce?: string) =>
      kind === "location" ? this.load_locations(announce) : this.load_odate_types(announce);

    panel.addEventListener("place-create", event => {
      const detail = (event as CustomEvent<{name: string; coordinates: {latitude: number; longitude: number} | null}>)
        .detail;
      void this.change_place(
        panel,
        0,
        what,
        () => this.send_create(kind, detail.name, detail.coordinates),
        () => reload(`Added “${detail.name}”.`),
        `“${detail.name}”`
      );
    });

    panel.addEventListener("place-save", event => {
      const detail = (event as CustomEvent<{id: number; name: string; coordinates: {latitude: number; longitude: number} | null}>)
        .detail;
      void this.change_place(
        panel,
        detail.id,
        `${what} “${detail.name}”`,
        () => this.send_save(kind, detail.id, detail.name, detail.coordinates),
        // A rename reaches further than the panel: every entry on the screen carries the name.
        async name => {
          await reload(`Saved “${name}”.`);
          await this.load_odates();
        },
        detail.name
      );
    });

    panel.addEventListener("place-remove", event => {
      const detail = (event as CustomEvent<{id: number}>).detail;
      const gone = this.places_of(kind).find(place => place.id === detail.id);
      const name = gone?.name ?? "it";
      void this.change_place(
        panel,
        null,
        `${what} “${name}”`,
        () => this.send_delete(kind, detail.id),
        () => reload(`Deleted “${name}”.`),
        name
      );
    });
  }

  private places_of(kind: "location" | "type"): {id: number; name: string}[] {
    return kind === "location" ? this.locations : this.types;
  }

  private send_create(
    kind: "location" | "type",
    name: string,
    coordinates: {latitude: number; longitude: number} | null
  ): Promise<unknown> {
    if (kind === "type") return api.create_odate_type(name);
    return api.create_location({name, ...(coordinates ?? {})});
  }

  private send_save(
    kind: "location" | "type",
    id: number,
    name: string,
    coordinates: {latitude: number; longitude: number} | null
  ): Promise<unknown> {
    if (kind === "type") return api.rename_odate_type(id, name);
    const known = this.locations.find(place => place.id === id);
    // A write replaces the row whole, so the timezone comes back with it rather than being dropped
    // by an app that has no field for it.
    const timezone = known?.timezone ?? undefined;
    if (coordinates === null) return api.update_location(id, {name, ...(timezone ? {timezone} : {})});
    return api.update_location(id, {name, latitude: coordinates.latitude, longitude: coordinates.longitude, ...(timezone ? {timezone} : {})});
  }

  private send_delete(kind: "location" | "type", id: number): Promise<unknown> {
    return kind === "location" ? api.delete_location(id) : api.delete_odate_type(id);
  }

  /**
   * One change to one row of a panel.
   *
   * `row` is the row whose status line carries the answer, or null when the row is about to stop
   * existing — a deleted name has nowhere left to say "Deleted". What follows a successful change is
   * the caller's, because it differs: a rename has to redraw the entries, and a deletion has not.
   */
  private async change_place(
    panel: PlaceListPanel,
    row: number | null,
    what: string,
    send: () => Promise<unknown>,
    after: (name: string) => Promise<void> | void,
    name: string
  ): Promise<void> {
    panel.show_status(row, "");
    try {
      await send();
      panel.change_done();
      await after(name);
      // A deleted row has nowhere left to say "Deleted", so the words land on the panel and the
      // focus goes to its heading — the reader's place in the panel is what a removal takes away.
      if (row === null) panel.focus_heading();
    } catch (e) {
      if (e instanceof UnauthenticatedError) return go_to_login();
      konsole.error(`Failed to change ${what}`, e);
      panel.show_status(row, e instanceof ServerRefusal ? api.place_change_failed(e, what) : `Failed to change ${what}.`, true);
    }
  }

  // ---- drawing -----------------------------------------------------------------------------

  private clear_entries(): void {
    this.odates = [];
  }

  private set_status(text: string, error: boolean = false): void {
    this.status_text = text;
    this.status_is_error = error;
    this.draw();
  }

  private draw(): void {
    const shadow = this.shadowRoot;
    if (!shadow) return;

    const status = this.$["status"];
    status.textContent = this.status_text;
    status.classList.toggle("error", this.status_is_error);

    const searching = this.searched !== null || this.search_text !== "";
    const dates = this.searched !== null;
    (this.$["clear_button"] as HTMLButtonElement).disabled = !searching || this.loading_odates;
    (this.$["search_text"] as HTMLInputElement).disabled = this.loading_odates;
    (this.$["search_from"] as HTMLInputElement).disabled = this.loading_odates;
    (this.$["search_until"] as HTMLInputElement).disabled = this.loading_odates;

    this.list.entries_to_show = this.odates;
    this.list.title = this.search_text !== ""
      ? dates
        ? `Matching “${this.search_text}” between those dates`
        : `Matching “${this.search_text}”`
      : dates
        ? "Between those dates"
        : "Coming up";
    this.list.empty_message = this.search_text !== ""
      ? dates
        ? `Nothing matches “${this.search_text}” between those dates.`
        : `Nothing matches “${this.search_text}”.`
      : dates
        ? "Nothing between those dates."
        : "Nothing coming up. Add an entry above.";
    this.list.show_loading = this.loading_odates;
    this.list.show_failed = this.list_failed;

    this.form.known_places = this.locations;
    this.form.known_types = this.types;
    this.form.is_saving = this.saving;

    // The list holds the list of entries and the row that is being changed; the form in that row is
    // built from the same three answers as the one at the top.
    this.list.known_places = this.locations;
    this.list.known_types = this.types;
    this.list.is_saving = this.saving;
    this.list.editing_entry = this.editing;

    const locations = this.panel("locations");
    locations.places_to_show = this.locations;
    locations.show_loading = this.loading_locations;
    locations.show_failed = this.locations_failed;

    const types = this.panel("types");
    types.places_to_show = this.types;
    types.show_loading = this.loading_types;
    types.show_failed = this.types_failed;
  }
}

konsole.log("Registering calendar-page web component");
customElements.define("calendar-page", CalendarPage);
