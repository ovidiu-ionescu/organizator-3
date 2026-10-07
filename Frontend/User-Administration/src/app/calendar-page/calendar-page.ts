import { Component, OnInit, WritableSignal, computed, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Markdown } from '../markdown';
import {
  NewLocation,
  NewOdate,
  Odate,
  OdateApi,
  OdateLocation,
  OdateType,
  placeChangeFailed,
} from '../odate-api';
import { Coordinates } from './coordinates';
import { DayRange, dayEnd, dayStart } from './day-range';
import { PanelStatus } from '../panel-status';
import { OdateForm } from './odate-form/odate-form';
import { OdateList } from './odate-list/odate-list';
import { PlaceListPanel, PlaceOnAList } from './place-list-panel/place-list-panel';

/** What a panel sends when a name is added: the name, and a point if it has one. */
interface NewPlace {
  name: string;
  coordinates: Coordinates | null;
}

/** What a panel sends when a row is changed: which row, and what it should now be. */
interface ChangedPlace extends NewPlace {
  place: PlaceOnAList;
}

/** A message about the screen: a list that would not load, or an entry that would not save. */
interface Status {
  text: string;
  error: boolean;
}

/**
 * The Calendar screen: what is coming up, and the form for adding to it.
 *
 * The list is the server's rather than the screen's — the server decides what "coming up" means
 * and which entries are happening now, so this component never filters or sorts. After an entry
 * is added it asks for the list again rather than appending: an entry whose end has already
 * passed belongs in no list at all, and only the server's own rule knows that.
 */
@Component({
  selector: 'app-calendar-page',
  imports: [OdateForm, OdateList, PlaceListPanel],
  templateUrl: './calendar-page.html',
  styleUrl: './calendar-page.css',
})
export class CalendarPage implements OnInit {
  private api = inject(OdateApi);
  private markdown = inject(Markdown);

  odates = signal<Odate[]>([]);
  /** The two name lists the entry form picks from, and what each panel below is doing. */
  locations = signal<OdateLocation[]>([]);
  types = signal<OdateType[]>([]);
  loadingLocations = signal(false);
  loadingTypes = signal(false);
  savingLocations = signal(false);
  savingTypes = signal(false);
  locationStatus = signal<PanelStatus | null>(null);
  typeStatus = signal<PanelStatus | null>(null);
  loading = signal(false);
  saving = signal(false);
  /** Set when the list itself could not be read, so the list can keep its empty message quiet. */
  listFailed = signal(false);
  status = signal<Status | null>(null);
  /** The entry the form is changing, or null when it is making a new one. */
  editing = signal<Odate | null>(null);
  /**
   * The stretch the list was last asked for, or null when it is the plain reading. Kept rather
   * than read back off the fields so that a reload — after a save, say — asks the same question
   * the visitor did.
   */
  private searched = signal<DayRange | null>(null);

  /** Whether the list is the answer to a question rather than the default one. */
  searching = computed(() => this.searched() !== null);

  /**
   * What the list is. It stops being "coming up" the moment a range is asked for, because it
   * then holds entries that have already happened — "nothing coming up" underneath a search of
   * last March would be plainly untrue.
   */
  listHeading = computed(() => (this.searching() ? 'Between those dates' : 'Coming up'));
  listEmptyText = computed(() =>
    this.searching()
      ? 'Nothing between those dates.'
      : 'Nothing coming up. Add an entry above.'
  );

  private form = viewChild(OdateForm);

  ngOnInit() {
    this.loadOdates();
    // Fetched while the list is on its way rather than when a note needs it, so notes are
    // rendered by the time there is anything to read. A failure is not worth reporting: the
    // notes are then shown as they were written.
    void this.markdown.load();

    this.loadLocations();
    this.loadOdateTypes();
  }

  /**
   * Reads one of the two name lists. These also fill the entry form's dropdowns, and an entry can
   * be created without either — but the panel below shows the list, so a failure has to be said
   * rather than only logged: the panel would otherwise answer "you have no locations yet" to a
   * request that never arrived.
   */
  private loadLocations(announce?: { id: number | null; text: string }) {
    this.loadingLocations.set(true);
    if (announce === undefined) this.locationStatus.set(null);

    this.api.locations().subscribe({
      next: places => {
        this.locations.set(places);
        this.loadingLocations.set(false);
        // Shown once the list has arrived rather than when it was asked for: this read clears the
        // panel's status on its way out, so a message set before it would be wiped by the very
        // reload it caused. Same reason loadOdates takes one.
        if (announce !== undefined) this.locationStatus.set({ ...announce, error: false });
      },
      error: (err: HttpErrorResponse) => {
        this.loadingLocations.set(false);
        console.error('Failed to load locations:', err.status);
        this.locationStatus.set({ id: null, text: 'Could not read your locations.', error: true });
      },
    });
  }

  private loadOdateTypes(announce?: { id: number | null; text: string }) {
    this.loadingTypes.set(true);
    if (announce === undefined) this.typeStatus.set(null);

    this.api.odateTypes().subscribe({
      next: types => {
        this.types.set(types);
        this.loadingTypes.set(false);
        if (announce !== undefined) this.typeStatus.set({ ...announce, error: false });
      },
      error: (err: HttpErrorResponse) => {
        this.loadingTypes.set(false);
        console.error('Failed to load date types:', err.status);
        this.typeStatus.set({ id: null, text: 'Could not read your date types.', error: true });
      },
    });
  }

  createLocation(created: NewPlace) {
    this.changePlace(
      this.api.createLocation(this.newLocation(created)),
      this.savingLocations,
      this.locationStatus,
      announce => this.loadLocations(announce),
      // No row to hang a failure on yet, so that one speaks for the panel.
      { id: null, what: 'the location' },
      place => ({ id: place.id, text: `Added “${created.name}”.` })
    );
  }

  updateLocation(changed: ChangedPlace) {
    this.changePlace(
      this.api.updateLocation(changed.place.id, this.newLocation(changed, changed.place)),
      this.savingLocations,
      this.locationStatus,
      // The entries on the list above carry a copy of the name and the form's dropdowns hold it
      // too, so both are stale until they are read again.
      announce => {
        this.loadLocations(announce);
        this.loadOdates();
      },
      { id: changed.place.id, what: `the location “${changed.place.name}”` },
      () => ({ id: changed.place.id, text: `Saved “${changed.name}”.` })
    );
  }

  /**
   * A location in the shape the API wants.
   *
   * `timezone` is carried back from the row being replaced although no screen shows it: a `PUT`
   * replaces the whole location, so leaving it out would take away a value set through the API.
   */
  private newLocation(place: NewPlace, replaced?: PlaceOnAList): NewLocation {
    return {
      name: place.name,
      latitude: place.coordinates?.latitude,
      longitude: place.coordinates?.longitude,
      timezone: replaced?.timezone ?? undefined,
    };
  }

  deleteLocation(place: PlaceOnAList) {
    this.changePlace(
      this.api.deleteLocation(place.id),
      this.savingLocations,
      this.locationStatus,
      announce => this.loadLocations(announce),
      // The row is on its way out, so both messages speak for the panel.
      { id: null, what: `the location “${place.name}”` },
      () => ({ id: null, text: `Deleted “${place.name}”.` })
    );
  }

  createOdateType(created: NewPlace) {
    this.changePlace(
      this.api.createOdateType(created.name),
      this.savingTypes,
      this.typeStatus,
      announce => this.loadOdateTypes(announce),
      { id: null, what: 'the date type' },
      place => ({ id: place.id, text: `Added “${created.name}”.` })
    );
  }

  renameOdateType(changed: ChangedPlace) {
    this.changePlace(
      this.api.renameOdateType(changed.place.id, changed.name),
      this.savingTypes,
      this.typeStatus,
      announce => {
        this.loadOdateTypes(announce);
        this.loadOdates();
      },
      { id: changed.place.id, what: `the date type “${changed.place.name}”` },
      () => ({ id: changed.place.id, text: `Saved “${changed.name}”.` })
    );
  }

  deleteOdateType(place: PlaceOnAList) {
    this.changePlace(
      this.api.deleteOdateType(place.id),
      this.savingTypes,
      this.typeStatus,
      announce => this.loadOdateTypes(announce),
      { id: null, what: `the date type “${place.name}”` },
      () => ({ id: null, text: `Deleted “${place.name}”.` })
    );
  }

  /**
   * Runs one write against a name list and reports how it went.
   *
   * The two lists differ only in which signals they use and in the words, so both are handed in;
   * what is the same either way is the status cleared before the call, the reload after it, and
   * the wording of a refusal. `done` is given the row the server answered with — null for a
   * delete, which answers with nothing — so it can name the row its message belongs to.
   */
  private changePlace<T>(
    request: Observable<T>,
    saving: WritableSignal<boolean>,
    status: WritableSignal<PanelStatus | null>,
    reload: (announce: { id: number | null; text: string }) => void,
    about: { id: number | null; what: string },
    done: (row: T) => { id: number | null; text: string }
  ) {
    status.set(null);
    saving.set(true);

    request.subscribe({
      next: row => {
        saving.set(false);
        // Handed to the reload rather than set here: the reload clears this panel's status, so a
        // message set now would be wiped by the read it just caused.
        reload(done(row));
      },
      error: (err: HttpErrorResponse) => {
        saving.set(false);
        console.error(`Failed to change ${about.what}:`, err.status);
        status.set({ id: about.id, text: placeChangeFailed(err, about.what), error: true });
      },
    });
  }

  /**
   * Reads the list. `announce` is shown once the list has arrived rather than now: an added
   * entry reloads this very list, and setting the message first would have it wiped by the
   * reload it causes. The confirmation also belongs beside the list it is about.
   */
  private loadOdates(announce?: string) {
    this.loading.set(true);
    if (announce === undefined) this.status.set(null);

    // The same range as last time, so a reload after a save does not quietly widen the search.
    this.api.odates(this.searched() ?? undefined).subscribe({
      next: entries => {
        this.odates.set(entries);
        this.loading.set(false);
        this.listFailed.set(false);
        if (announce !== undefined) this.status.set({ text: announce, error: false });
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.listFailed.set(true);
        console.error('Failed to load the calendar:', err.status);
        this.status.set({ text: 'Could not read your calendar.', error: true });
      },
    });
  }

  /**
   * Looks at a stretch of time instead of at what is coming.
   *
   * Either field may be left empty, and that is a question rather than a mistake: "everything
   * since March" and "everything up to June" are both worth asking. Both empty is the plain
   * list again, so pressing Search on two empty fields reads as clearing rather than as a
   * search for nothing.
   */
  search(from: HTMLInputElement, until: HTMLInputElement, event: Event) {
    event.preventDefault(); // a (submit) binding does not stop the native GET

    const start = dayStart(from.value);
    const end = dayEnd(until.value);

    if (start === null && end === null) {
      this.clearSearch(from, until);
      return;
    }

    const range: DayRange = {};
    if (start !== null) range.from = start;
    if (end !== null) range.until = end;

    this.searched.set(range);
    this.loadOdates();
  }

  /** Back to the list the screen opens with, and the fields emptied with it. */
  clearSearch(from?: HTMLInputElement, until?: HTMLInputElement) {
    if (from) from.value = '';
    if (until) until.value = '';
    this.searched.set(null);
    this.loadOdates();
  }

  createOdate(entry: NewOdate) {
    this.save(this.api.createOdate(entry), created => {
      this.form()?.clear();
      // The form stays open after a new entry, so another can follow straight away.
      this.loadOdates(`Added “${created.description ?? 'entry'}”.`);
    }, 'add');
  }

  updateOdate(change: { id: number; entry: NewOdate }) {
    this.save(this.api.updateOdate(change.id, change.entry), updated => {
      // ...but it closes after a change: there is nothing more to do to that one entry.
      this.form()?.close();
      this.loadOdates(`Saved “${updated.description ?? 'entry'}”.`);
    }, 'save');
  }

  /**
   * Runs one write and reports how it went. The two differ only in what happens once the server
   * has taken it, so that is the callback; the saving flag, the reload and the refusal are the
   * same either way.
   */
  private save(
    request: ReturnType<OdateApi['createOdate']> | ReturnType<OdateApi['updateOdate']>,
    done: (entry: Odate) => void,
    doing: string
  ) {
    this.saving.set(true);
    this.status.set(null);

    request.subscribe({
      next: entry => {
        this.saving.set(false);
        done(entry);
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        console.error(`Failed to ${doing} the entry:`, err.status);
        this.status.set({ text: this.refusal(err, doing), error: true });
      },
    });
  }

  /** The server's own words when it gave any, which beats the app guessing at the reason. */
  private refusal(err: HttpErrorResponse, doing: string): string {
    const body: unknown = err.error;

    const reason =
      typeof body === 'string'
        ? body
        : body !== null && typeof body === 'object' && 'error' in body
          ? (body as { error: unknown }).error
          : null;

    const text = typeof reason === 'string' ? reason.trim() : '';
    // The angle bracket rules out an HTML error page from a proxy, which is not a reason.
    if (text !== '' && !text.includes('<')) return `Could not ${doing} the entry: ${text}`;

    return `Could not ${doing} the entry.`;
  }
}
