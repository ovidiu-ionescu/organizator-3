import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { CalendarPage } from './calendar-page';
import { Markdown } from '../markdown';
import { Odate } from '../odate-api';

const DENTIST: Odate = {
  id: 1,
  start_time: 1751000000000,
  end_time: 1751003600000,
  ongoing: false,
  description: 'Dentist',
  memo_text: null,
  // The office has been put on the earth, so an entry at it can be shown on a map.
  location: { id: 1, name: 'Office', latitude: 44.4268, longitude: 26.1025 },
  type: null,
};

/** The precision a datetime-local field carries: nothing below the minute survives it. */
function atTheMinute(ms: number): number {
  return ms - (ms % 60000);
}

/** The same conversion the form does, so the test asserts against the value, not a literal. */
function toLocalInput(ms: number): string {
  const at = new Date(ms);
  const pad = (part: number) => String(part).padStart(2, '0');
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

const NOW: Odate = {
  id: 2,
  start_time: 1749990000000,
  end_time: 1751000000000,
  ongoing: true,
  description: 'Long meeting',
  memo_text: null,
  location: null,
  type: { id: 2, name: 'Meeting' },
};

describe('CalendarPage', () => {
  let fixture: ComponentFixture<CalendarPage>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarPage],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CalendarPage);
    httpMock = TestBed.inject(HttpTestingController);

    // The real renderer is a wasm file this environment cannot fetch, so it is stubbed with
    // something recognisable — what is under test is that its output reaches the page, not the
    // markdown itself.
    vi.spyOn(TestBed.inject(Markdown), 'render').mockImplementation(
      (note: string) => `<p class="stub">${note}</p>`
    );
  });

  afterEach(() => {
    httpMock.verify();
    vi.restoreAllMocks(); // the renderer is stubbed per test; one test's stub is not the next's
  });

  /** The three reads the screen makes on arrival. */
  function load(
    options: {
      odates?: Odate[] | null;
      locations?: {
        id: number;
        name: string;
        latitude?: number | null;
        longitude?: number | null;
      }[];
      types?: { id: number; name: string }[];
    } = {}
  ) {
    fixture.detectChanges();

    httpMock
      .expectOne({ url: '/organizator/odates', method: 'GET' })
      .flush({ odates: options.odates ?? [], requester: { id: 7, name: 'u7' } });
    httpMock.expectOne({ url: '/organizator/locations', method: 'GET' }).flush({
      // Whatever the case says wins; a location it gave no coordinates for has none.
      locations: (options.locations ?? []).map(place => ({
        latitude: null,
        longitude: null,
        timezone: null,
        last_used: null,
        ...place,
      })),
      requester: { id: 7, name: 'u7' },
    });
    httpMock
      .expectOne({ url: '/organizator/odate_types', method: 'GET' })
      .flush({ odate_types: options.types ?? [], requester: { id: 7, name: 'u7' } });

    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function query<T extends Element>(selector: string): T {
    const element = fixture.nativeElement.querySelector(selector) as T | null;
    if (element === null) throw new Error(`Nothing matches ${selector}`);
    return element;
  }

  /** Opens the form, which starts folded away behind its button. */
  function openForm() {
    if (fixture.nativeElement.querySelector('#new-start')) return; // already open
    // Named by what it controls: once the form is open it holds other buttons, so "the button"
    // is not a way to find it.
    query<HTMLButtonElement>('app-odate-form [aria-controls="new-entry-form"]').click();
    fixture.detectChanges();
  }

  /** Fills the form and submits it the way the browser would. */
  function submitEntry(fields: { start?: string; end?: string; description?: string } = {}) {
    openForm();
    if (fields.start !== undefined) query<HTMLInputElement>('#new-start').value = fields.start;
    if (fields.end !== undefined) query<HTMLInputElement>('#new-end').value = fields.end;
    if (fields.description !== undefined) {
      query<HTMLInputElement>('#new-description').value = fields.description;
    }
    query<HTMLFormElement>('.entry-form').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('lists what is coming up', () => {
    load({ odates: [NOW, DENTIST] });

    expect(fixture.nativeElement.querySelectorAll('app-odate-list .entry')).toHaveLength(2);
    expect(text()).toContain('Dentist');
    expect(text()).toContain('Office');
  });

  it('marks the entry that is happening now, and only that one', () => {
    load({ odates: [NOW, DENTIST] });

    const happening = fixture.nativeElement.querySelectorAll('.entry.happening');
    expect(happening).toHaveLength(1);
    expect((happening[0] as HTMLElement).textContent).toContain('Long meeting');
    // Said in words as well as by the border, so it does not rest on colour alone.
    expect((happening[0] as HTMLElement).textContent).toContain('Happening now');
  });

  it('says so when nothing is coming up, rather than showing an empty list', () => {
    load({ odates: [] });

    expect(text()).toContain('Nothing coming up');
  });

  it('does not claim the calendar is empty when the read failed', () => {
    fixture.detectChanges();
    httpMock
      .expectOne({ url: '/organizator/odates', method: 'GET' })
      .flush(null, { status: 500, statusText: 'Server Error' });
    httpMock
      .expectOne({ url: '/organizator/locations', method: 'GET' })
      .flush({ locations: [], requester: { id: 7, name: 'u7' } });
    httpMock
      .expectOne({ url: '/organizator/odate_types', method: 'GET' })
      .flush({ odate_types: [], requester: { id: 7, name: 'u7' } });
    fixture.detectChanges();

    expect(text()).toContain('Could not read your calendar');
    expect(text()).not.toContain('Nothing coming up');
  });

  it('offers the locations and types it loaded', () => {
    load({
      locations: [{ id: 1, name: 'Office' }],
      types: [{ id: 2, name: 'Meeting' }],
    });
    openForm();

    expect(query<HTMLSelectElement>('#new-location').options).toHaveLength(2); // blank + Office
    expect(query<HTMLSelectElement>('#new-type').options).toHaveLength(2);
    expect(text()).toContain('Office');
  });

  it('sends the two times as epoch milliseconds', () => {
    load();

    submitEntry({ start: '2026-10-05T14:30', end: '2026-10-05T15:30', description: 'Dentist' });

    const request = httpMock.expectOne({ url: '/organizator/odates', method: 'POST' });
    // Built from the same wall-clock string the browser produced, so the two agree whatever
    // zone the machine is in.
    expect(request.request.body.start_time).toBe(new Date('2026-10-05T14:30').getTime());
    expect(request.request.body.end_time).toBe(new Date('2026-10-05T15:30').getTime());
    expect(request.request.body.description).toBe('Dentist');
    // Left out rather than sent empty: no location and no type were chosen.
    expect('location_id' in request.request.body).toBe(false);
    expect('type' in request.request.body).toBe(false);

    request.flush(DENTIST);
    fixture.detectChanges();

    // Reloads rather than appending, so the list is the server's answer.
    httpMock
      .expectOne({ url: '/organizator/odates', method: 'GET' })
      .flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
    fixture.detectChanges();

    expect(text()).toContain('Added');
    expect(fixture.nativeElement.querySelectorAll('.entry')).toHaveLength(1);
  });

  it('clears the fields once the entry has been taken', () => {
    load();

    submitEntry({ start: '2026-10-05T14:30', end: '2026-10-05T15:30', description: 'Dentist' });
    httpMock.expectOne({ url: '/organizator/odates', method: 'POST' }).flush(DENTIST);
    fixture.detectChanges();
    httpMock
      .expectOne({ url: '/organizator/odates', method: 'GET' })
      .flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
    fixture.detectChanges();

    expect(query<HTMLInputElement>('#new-description').value).toBe('');
    expect(query<HTMLInputElement>('#new-start').value).toBe('');
  });

  it('reports what the server said when it refuses an entry', () => {
    load();

    submitEntry({ start: '2026-10-05T15:30', end: '2026-10-05T14:30' });

    // The end-before-start rule is the server's, and it says so in its own words.
    httpMock
      .expectOne({ url: '/organizator/odates', method: 'POST' })
      .flush({ error: 'An entry has to end after it starts' }, { status: 422, statusText: 'Unprocessable' });
    fixture.detectChanges();

    expect(text()).toContain('An entry has to end after it starts');
    // and nothing was reloaded, because nothing was created
    httpMock.expectNone({ url: '/organizator/odates', method: 'GET' });
  });

  describe('notes as markdown', () => {
    it('shows the rendered note in the list', () => {
      load({ odates: [{ ...DENTIST, memo_text: 'Bring the **card**' }] });

      const rendered = fixture.nativeElement.querySelector('app-odate-list .markdown');
      expect(rendered).toBeTruthy();
      expect(rendered.innerHTML).toContain('Bring the **card**'); // what the stub was handed
    });

    it('shows the note as it was written until the renderer is ready', () => {
      // render() answers null until the package has loaded; the note must not simply vanish.
      vi.spyOn(TestBed.inject(Markdown), 'render').mockReturnValue(null);

      load({ odates: [{ ...DENTIST, memo_text: 'Bring the **card**' }] });

      expect(fixture.nativeElement.querySelector('app-odate-list .markdown')).toBeNull();
      expect(text()).toContain('Bring the **card**');
    });

    it('is not asked to render an entry with no note', () => {
      const render = vi.spyOn(TestBed.inject(Markdown), 'render');

      load({ odates: [DENTIST] }); // DENTIST has no memo_text

      expect(render).not.toHaveBeenCalled();
    });

    it('previews the notes on the Preview button, and puts them back on Write', () => {
      load();
      openForm();

      query<HTMLTextAreaElement>('#new-notes').value = 'Bring the **card**';

      const toggle = query<HTMLButtonElement>('.preview-toggle');
      expect(toggle.textContent?.trim()).toBe('Preview');

      toggle.click();
      fixture.detectChanges();

      expect(toggle.textContent?.trim()).toBe('Write');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(fixture.nativeElement.querySelector('app-odate-form .markdown').innerHTML).toContain(
        'Bring the **card**'
      );

      // The textarea is hidden rather than removed, which is what keeps what was typed.
      const area = query<HTMLTextAreaElement>('#new-notes');
      expect(area.classList).toContain('hidden');
      expect(area.value).toBe('Bring the **card**');

      toggle.click();
      fixture.detectChanges();

      expect(query<HTMLButtonElement>('.preview-toggle').textContent?.trim()).toBe('Preview');
      expect(query<HTMLTextAreaElement>('#new-notes').classList).not.toContain('hidden');
      expect(query<HTMLTextAreaElement>('#new-notes').value).toBe('Bring the **card**');
    });

    it('previews what was typed, not what was there before', () => {
      load();
      openForm();
      query<HTMLTextAreaElement>('#new-notes').value = 'first';

      query<HTMLButtonElement>('.preview-toggle').click();
      fixture.detectChanges();
      query<HTMLButtonElement>('.preview-toggle').click(); // back to writing
      fixture.detectChanges();

      query<HTMLTextAreaElement>('#new-notes').value = 'second';
      query<HTMLButtonElement>('.preview-toggle').click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('app-odate-form .markdown').innerHTML).toContain(
        'second'
      );
    });

    it('leaves the preview when the form closes', () => {
      load();
      openForm();
      query<HTMLButtonElement>('.preview-toggle').click();
      fixture.detectChanges();

      query<HTMLButtonElement>('app-odate-form .actions .btn:not(.btn-primary)').click();
      fixture.detectChanges();
      openForm();

      expect(query<HTMLButtonElement>('.preview-toggle').textContent?.trim()).toBe('Preview');
    });
  });

  describe('changing an entry', () => {
    it('opens the form filled in with the entry, and says which one', () => {
      load({ odates: [DENTIST] });

      query<HTMLButtonElement>('app-odate-list .row-action').click();
      fixture.detectChanges();

      expect(text()).toContain('Editing');
      expect(text()).toContain('Dentist');
      // The times come back as the wall-clock strings the fields want, in the browser's own
      // zone — the same value the form parsed on the way in.
      expect(query<HTMLInputElement>('#new-start').value).toBe(
        toLocalInput(DENTIST.start_time)
      );
      expect(query<HTMLInputElement>('#new-end').value).toBe(toLocalInput(DENTIST.end_time));
      expect(query<HTMLInputElement>('#new-description').value).toBe('Dentist');
      expect(query<HTMLSelectElement>('#new-location').value).toBe('1');
      // The submit says what it will do, which is not "add".
      expect(query<HTMLButtonElement>('.actions .btn-primary').textContent?.trim()).toBe('Save');
    });

    it('sends the change to the entry it came from', () => {
      load({ odates: [DENTIST] });
      query<HTMLButtonElement>('app-odate-list .row-action').click();
      fixture.detectChanges();

      query<HTMLInputElement>('#new-description').value = 'Dentist, moved';
      query<HTMLFormElement>('.entry-form').dispatchEvent(new Event('submit'));
      fixture.detectChanges();

      const request = httpMock.expectOne({ url: '/organizator/odates/1', method: 'PUT' });
      expect(request.request.body.description).toBe('Dentist, moved');
      // The untouched fields go too — but at the precision the field offers, which is the
      // minute. The fixture's time has 20 seconds on it, and they do not survive the round trip.
      expect(request.request.body.start_time).toBe(atTheMinute(DENTIST.start_time));
      request.flush({ ...DENTIST, description: 'Dentist, moved' });
      fixture.detectChanges();

      httpMock
        .expectOne({ url: '/organizator/odates', method: 'GET' })
        .flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();

      expect(text()).toContain('Saved');
    });

    it('saves at the minute, which is all a datetime-local field carries', () => {
      // Worth pinning rather than discovering: the picker gives minutes, so a stored time with
      // seconds or milliseconds on it comes back rounded down once it has been through the form.
      // Anything else would need a field the browser does not offer.
      load({ odates: [DENTIST] });
      query<HTMLButtonElement>('app-odate-list .row-action').click();
      fixture.detectChanges();

      query<HTMLFormElement>('.entry-form').dispatchEvent(new Event('submit'));
      fixture.detectChanges();

      const request = httpMock.expectOne({ url: '/organizator/odates/1', method: 'PUT' });
      expect(DENTIST.start_time % 60000).not.toBe(0); // the fixture really does have seconds
      expect(request.request.body.start_time % 60000).toBe(0); // and they are gone

      request.flush(DENTIST);
      fixture.detectChanges();
      httpMock
        .expectOne({ url: '/organizator/odates', method: 'GET' })
        .flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
    });

    it('keeps a location the loaded list does not have, rather than dropping it', () => {
      // The entry names location 1, but no locations were loaded — what a failed read looks
      // like. A select whose value matches no option falls back to "No location", so without
      // the option being added, saving this entry would quietly take its location away.
      load({ odates: [DENTIST] });

      query<HTMLButtonElement>('app-odate-list .row-action').click();
      fixture.detectChanges();

      expect(query<HTMLSelectElement>('#new-location').value).toBe('1');

      query<HTMLFormElement>('.entry-form').dispatchEvent(new Event('submit'));
      fixture.detectChanges();

      const request = httpMock.expectOne({ url: '/organizator/odates/1', method: 'PUT' });
      expect(request.request.body.location_id).toBe(1);

      request.flush(DENTIST);
      fixture.detectChanges();
      httpMock
        .expectOne({ url: '/organizator/odates', method: 'GET' })
        .flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
    });

    it('closes the form after a change, unlike after a new entry', () => {
      load({ odates: [DENTIST] });
      query<HTMLButtonElement>('app-odate-list .row-action').click();
      fixture.detectChanges();

      query<HTMLFormElement>('.entry-form').dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      httpMock.expectOne({ url: '/organizator/odates/1', method: 'PUT' }).flush(DENTIST);
      fixture.detectChanges();
      httpMock
        .expectOne({ url: '/organizator/odates', method: 'GET' })
        .flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('#new-start')).toBeNull();
      expect(
        query<HTMLButtonElement>('app-odate-form [aria-controls="new-entry-form"]').textContent?.trim()
      ).toBe('Add an entry');
    });

    it('reports what the server said when it refuses the change', () => {
      load({ odates: [DENTIST] });
      query<HTMLButtonElement>('app-odate-list .row-action').click();
      fixture.detectChanges();

      query<HTMLInputElement>('#new-end').value = '2020-01-01T00:00';
      query<HTMLFormElement>('.entry-form').dispatchEvent(new Event('submit'));
      fixture.detectChanges();

      httpMock
        .expectOne({ url: '/organizator/odates/1', method: 'PUT' })
        .flush({ error: 'An entry has to end after it starts' }, { status: 422, statusText: 'Unprocessable' });
      fixture.detectChanges();

      expect(text()).toContain('Could not save the entry');
      expect(text()).toContain('An entry has to end after it starts');
      // and the form stays open with the edit in it, so it can be corrected
      expect(query<HTMLInputElement>('#new-description').value).toBe('Dentist');
    });

    it('goes back to a new entry when the change is cancelled', () => {
      load({ odates: [DENTIST] });
      query<HTMLButtonElement>('app-odate-list .row-action').click();
      fixture.detectChanges();

      query<HTMLButtonElement>('app-odate-form .actions .btn:not(.btn-primary)').click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('#new-start')).toBeNull();
      expect(text()).not.toContain('Editing');
    });
  });

  describe('the form folded away', () => {
    it('starts closed, showing only the button', () => {
      load();

      const trigger = query<HTMLButtonElement>('app-odate-form [aria-controls="new-entry-form"]');
      expect(trigger.textContent?.trim()).toBe('Add an entry');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(fixture.nativeElement.querySelector('#new-start')).toBeNull();
    });

    it('opens on the button, and puts focus in the first field', () => {
      load();

      openForm();

      expect(query<HTMLButtonElement>('app-odate-form .actions .btn-primary').textContent?.trim()).toBe(
        'Add entry'
      ); // the submit, which means the form is up
      expect(fixture.nativeElement.querySelector('#new-start')).toBeTruthy();
      expect(document.activeElement?.id).toBe('new-start');
    });

    it('closes on Cancel, and hands focus back to the button', () => {
      load();
      openForm();

      query<HTMLButtonElement>('app-odate-form .actions .btn:not(.btn-primary)').click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('#new-start')).toBeNull();
      const trigger = query<HTMLButtonElement>('app-odate-form [aria-controls="new-entry-form"]');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    });

    it('stays open after an entry is taken, so a second one can follow', () => {
      load();
      submitEntry({ start: '2026-10-05T14:30', end: '2026-10-05T15:30', description: 'Dentist' });

      httpMock.expectOne({ url: '/organizator/odates', method: 'POST' }).flush(DENTIST);
      fixture.detectChanges();
      httpMock
        .expectOne({ url: '/organizator/odates', method: 'GET' })
        .flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('#new-start')).toBeTruthy();
    });
  });

  it('asks the server for nothing when the times are not filled in', () => {
    load();

    submitEntry({ description: 'No times' });

    httpMock.expectNone({ url: '/organizator/odates', method: 'POST' });
  });

  /**
   * An entry says where it is when its location has been put on the earth — the whole point of
   * recording the coordinates, and the reason they travel with the entry rather than being
   * looked up again.
   */
  describe('the map link on an entry', () => {
    function mapLinks(): NodeListOf<HTMLAnchorElement> {
      return (fixture.nativeElement as HTMLElement).querySelectorAll(
        'app-odate-list a[href^="https://www.google.com/maps"]'
      );
    }

    it('opens the entry’s location on a map', () => {
      load({ odates: [DENTIST] });

      expect(mapLinks()).toHaveLength(1);
      expect(mapLinks()[0].getAttribute('href')).toBe(
        'https://www.google.com/maps?q=44.4268,26.1025'
      );
      expect(mapLinks()[0].getAttribute('target')).toBe('_blank');
      expect(mapLinks()[0].getAttribute('rel')).toContain('noopener');
    });

    it('offers nothing to open when the location has no coordinates', () => {
      load({
        odates: [
          { ...DENTIST, location: { id: 1, name: 'Office', latitude: null, longitude: null } },
        ],
      });

      expect(text()).toContain('Office');
      expect(mapLinks()).toHaveLength(0);
    });

    it('offers nothing to open when the entry has no location at all', () => {
      load({ odates: [NOW] });

      expect(mapLinks()).toHaveLength(0);
    });

    it('treats the equator and the prime meridian as places, not as missing values', () => {
      // 0 is a latitude somebody meant; a truth test would throw this entry's map away.
      load({
        odates: [{ ...DENTIST, location: { id: 1, name: 'Null Island', latitude: 0, longitude: 0 } }],
      });

      expect(mapLinks()).toHaveLength(1);
      expect(mapLinks()[0].getAttribute('href')).toBe('https://www.google.com/maps?q=0,0');
    });
  });

  /**
   * The line down the side of an entry says how soon it is. That is worked out from the
   * browser's clock — so the date printed beside the entry and the colour of its line can never
   * disagree — which means these tests have to hold the clock still.
   */
  describe('how soon an entry is', () => {
    const DAY = 86_400_000;

    /** The dentist's entry, moved `days` on from the moment the clock is held at. */
    function entryIn(days: number, now: number): Odate {
      return { ...DENTIST, start_time: now + days * DAY, end_time: now + days * DAY + 3600_000 };
    }

    /** The classes on the one row, with the browser's clock stopped at `now`. */
    function classesWith(now: number, entry: Odate): string {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        load({ odates: [entry] });
        const row = fixture.nativeElement.querySelector('app-odate-list .entry') as HTMLElement;
        return row.className;
      } finally {
        vi.useRealTimers();
      }
    }

    it('marks today', () => {
      const now = DENTIST.start_time;

      const classes = classesWith(now, entryIn(0, now));
      expect(classes).toContain('today');
      // Today is not yet happening: the two are different states and are drawn differently.
      expect(classes).not.toContain('happening');
    });

    it('marks today even when the entry started hours ago and is not running', () => {
      // Late on the entry's own day, in whatever zone this runs in: today is a day, not the
      // next few hours.
      const lateThatDay = new Date(DENTIST.start_time);
      lateThatDay.setHours(23, 0, 0, 0);

      expect(classesWith(lateThatDay.getTime(), DENTIST)).toContain('today');
    });

    // One case to a test: the page reads its three lists once, on arrival, so a second load()
    // in the same test would have nothing to answer.
    it('marks tomorrow', () => {
      const now = DENTIST.start_time;

      expect(classesWith(now, entryIn(1, now))).toContain('this-week');
    });

    it('marks three days off', () => {
      const now = DENTIST.start_time;

      expect(classesWith(now, entryIn(3, now))).toContain('this-week');
    });

    it('still marks the seventh day, which is the last of the coming week', () => {
      const now = DENTIST.start_time;

      expect(classesWith(now, entryIn(7, now))).toContain('this-week');
    });

    it('leaves anything further off with the quiet line', () => {
      const now = DENTIST.start_time;

      const classes = classesWith(now, entryIn(8, now));
      expect(classes).not.toContain('today');
      expect(classes).not.toContain('this-week');
    });

    it('leaves an entry that is over with the quiet line', () => {
      const now = DENTIST.start_time;

      // Only reachable through a search: the plain list stops at now.
      const classes = classesWith(now, entryIn(-30, now));
      expect(classes).not.toContain('today');
      expect(classes).not.toContain('this-week');
      expect(classes).not.toContain('happening');
    });

    it('marks one that began days ago and is still running as happening, not merely as today', () => {
      const now = DENTIST.start_time;

      const running: Odate = { ...entryIn(-3, now), ongoing: true };
      const classes = classesWith(now, running);

      expect(classes).toContain('happening');
      // One answer and not two: an entry is painted in one colour, never the pair.
      expect(classes).not.toContain('today');
    });
  });

  /**
   * The end of an entry begins as the start of it, so the same date is not typed twice. Only
   * when the end is empty: an edit opens with both filled, and a second thought about the start
   * must not move the end.
   */
  describe('filling in the end from the start', () => {
    /** What the browser does when the visitor tabs into a field. */
    function focusInto(selector: string) {
      query<HTMLInputElement>(selector).dispatchEvent(new Event('focus'));
      fixture.detectChanges();
    }

    it('copies the start into an end that has not been given one, an hour later', () => {
      load();
      openForm();
      query<HTMLInputElement>('#new-start').value = '2026-06-27T09:00';

      focusInto('#new-end');

      // An hour, not the same instant: an entry of no length is one the server turns down, so
      // filling the field in that way would only be handing over something to correct.
      expect(query<HTMLInputElement>('#new-end').value).toBe('2026-06-27T10:00');
    });

    it('takes the hour across midnight onto the next day', () => {
      load();
      openForm();
      query<HTMLInputElement>('#new-start').value = '2026-06-27T23:30';

      focusInto('#new-end');

      expect(query<HTMLInputElement>('#new-end').value).toBe('2026-06-28T00:30');
    });

    it('takes the hour across the end of a month', () => {
      load();
      openForm();
      query<HTMLInputElement>('#new-start').value = '2026-06-30T23:30';

      focusInto('#new-end');

      expect(query<HTMLInputElement>('#new-end').value).toBe('2026-07-01T00:30');
    });

    it('leaves an end that has already been given alone', () => {
      load();
      openForm();
      query<HTMLInputElement>('#new-start').value = '2026-06-27T09:00';
      query<HTMLInputElement>('#new-end').value = '2026-06-27T10:00';

      focusInto('#new-end');

      expect(query<HTMLInputElement>('#new-end').value).toBe('2026-06-27T10:00');
    });

    it('does nothing when no start has been given either', () => {
      load();
      openForm();

      focusInto('#new-end');

      expect(query<HTMLInputElement>('#new-end').value).toBe('');
    });

    it('does not move an end that was filled in, when the start changes afterwards', () => {
      load();
      openForm();
      query<HTMLInputElement>('#new-start').value = '2026-06-27T09:00';
      focusInto('#new-end');

      // A second thought about when it starts is not a second thought about when it ends.
      query<HTMLInputElement>('#new-start').value = '2026-06-28T09:00';
      focusInto('#new-end');

      expect(query<HTMLInputElement>('#new-end').value).toBe('2026-06-27T10:00');
    });

    it('goes back to copying once the fields are cleared for the next entry', () => {
      load();
      submitEntry({ start: '2026-06-27T09:00', end: '2026-06-27T10:00', description: 'First' });

      httpMock.expectOne({ url: '/organizator/odates', method: 'POST' }).flush(DENTIST);
      fixture.detectChanges();
      httpMock
        .expectOne({ url: '/organizator/odates', method: 'GET' })
        .flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();

      // The form stays open with its fields emptied, so the next entry gets the same help.
      query<HTMLInputElement>('#new-start').value = '2026-06-28T09:00';
      focusInto('#new-end');

      expect(query<HTMLInputElement>('#new-end').value).toBe('2026-06-28T10:00');
    });
  });

  /**
   * The search at the top asks for a stretch of time rather than for what is coming — the only
   * way to see an entry that has already happened, since the plain list stops at now.
   */
  describe('the range search', () => {
    /** Fills the two fields and submits, the way the browser would. */
    function search(from: string, until: string) {
      query<HTMLInputElement>('#search-from').value = from;
      query<HTMLInputElement>('#search-until').value = until;
      query<HTMLFormElement>('.search-row').dispatchEvent(new Event('submit'));
      fixture.detectChanges();
    }

    /**
     * The read of the entries. It is matched on a predicate rather than on `{url, method}`,
     * because that form compares the URL exactly and this one carries the range in its query
     * string.
     */
    function odatesRead(): TestRequest {
      return httpMock.expectOne(
        request => request.method === 'GET' && request.url === '/organizator/odates'
      );
    }

    /** What a request asked for, as the two parameters the server takes. */
    function rangeOf(request: TestRequest): { from: string | null; until: string | null } {
      return {
        from: request.request.params.get('from'),
        until: request.request.params.get('until'),
      };
    }

    function answerEmpty() {
      odatesRead().flush({ odates: [], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();
    }

    it('asks for whole days, from the first to the end of the last', () => {
      load();
      search('2026-06-27', '2026-06-30');

      const request = odatesRead();
      // Local midnight, and the midnight *after* the day named — the range is half-open, so a
      // search that ends on the 30th has to include the 30th.
      expect(rangeOf(request)).toEqual({
        from: `${new Date(2026, 5, 27).getTime()}`,
        until: `${new Date(2026, 6, 1).getTime()}`,
      });
      request.flush({ odates: [], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();
    });

    it('says what the list is, rather than claiming nothing is coming up', () => {
      load();
      search('2026-06-27', '2026-06-30');
      answerEmpty();

      expect(text()).toContain('Between those dates');
      expect(text()).toContain('Nothing between those dates');
      expect(text()).not.toContain('Nothing coming up');
    });

    it('takes one end on its own, which is a question rather than a mistake', () => {
      load();
      search('2026-06-27', '');

      const request = odatesRead();
      expect(rangeOf(request).from).toBe(`${new Date(2026, 5, 27).getTime()}`);
      expect(rangeOf(request).until).toBeNull();
      request.flush({ odates: [], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();
    });

    it('reads two empty fields as clearing rather than as a search for nothing', () => {
      load();
      search('', '');

      const request = odatesRead();
      expect(rangeOf(request)).toEqual({ from: null, until: null });
      request.flush({ odates: [], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();

      expect(text()).toContain('Coming up');
    });

    it('goes back to what is coming up when the search is cleared', () => {
      load();
      search('2026-06-27', '2026-06-30');
      answerEmpty();

      query<HTMLButtonElement>('.search-row button[type="button"]').click();
      fixture.detectChanges();

      const request = odatesRead();
      expect(rangeOf(request)).toEqual({ from: null, until: null });
      request.flush({ odates: [], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();

      expect(text()).toContain('Coming up');
      // The fields were emptied with it, so what is on screen matches what is listed.
      expect(query<HTMLInputElement>('#search-from').value).toBe('');
      expect(query<HTMLInputElement>('#search-until').value).toBe('');
    });

    it('asks the same question again after a save, rather than widening the search', () => {
      load();
      search('2026-06-27', '2026-06-30');

      const first = odatesRead();
      const asked = rangeOf(first);
      first.flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();

      query<HTMLButtonElement>('app-odate-list .row-action').click();
      fixture.detectChanges();
      query<HTMLInputElement>('#new-description').value = 'Dentist, moved';
      query<HTMLFormElement>('.entry-form').dispatchEvent(new Event('submit'));
      fixture.detectChanges();

      httpMock.expectOne({ url: '/organizator/odates/1', method: 'PUT' }).flush(DENTIST);
      fixture.detectChanges();

      const reload = odatesRead();
      expect(rangeOf(reload)).toEqual(asked);
      reload.flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();
    });
  });

  /**
   * The two name lists at the bottom of the page. They are one component rendered twice, so each
   * test says which one it means by the prefix on the ids — 'loc' or 'ot' — rather than by order.
   */
  describe('the location and date-type panels', () => {
    function panel(prefix: 'loc' | 'ot'): HTMLElement {
      const field = query<HTMLInputElement>(`#${prefix}-new-name`);
      const found = field.closest('app-place-list-panel') as HTMLElement | null;
      if (found === null) throw new Error(`#${prefix}-new-name is not inside a panel`);
      return found;
    }

    /** Fills a panel's create field and submits it the way the browser would. */
    function submitPlace(prefix: 'loc' | 'ot', name: string) {
      const field = query<HTMLInputElement>(`#${prefix}-new-name`);
      field.value = name;
      field.closest('form')?.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
    }

    /**
     * Opens a row's field and submits it. The field and the button that opened it carry the same
     * id — they are never on the page at once — so the button is clicked first and the field is
     * read after. `coordinates` is left alone when it is not given, which is what the box already
     * holds for a row that has some.
     */
    function renamePlace(
      prefix: 'loc' | 'ot',
      id: number,
      name: string,
      coordinates?: string
    ) {
      query<HTMLButtonElement>(`#${prefix}-edit-${id}`).click();
      fixture.detectChanges();

      const field = query<HTMLInputElement>(`#${prefix}-edit-${id}`);
      field.value = name;
      if (coordinates !== undefined) {
        query<HTMLInputElement>(`#${prefix}-edit-coordinates-${id}`).value = coordinates;
      }
      field.closest('form')?.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
    }

    /** Confirms a row's deletion, which takes two presses by design. */
    function confirmDelete(prefix: 'loc' | 'ot', id: number) {
      query<HTMLButtonElement>(`#${prefix}-delete-${id}`).click();
      fixture.detectChanges();
      query<HTMLButtonElement>(`#${prefix}-confirm-delete-${id}`).click();
      fixture.detectChanges();
    }

    function reloadLocations(
      places: { id: number; name: string; latitude?: number | null; longitude?: number | null }[]
    ) {
      httpMock.expectOne({ url: '/organizator/locations', method: 'GET' }).flush({
        locations: places.map(place => ({
          latitude: null,
          longitude: null,
          timezone: null,
          last_used: null,
          ...place,
        })),
        requester: { id: 7, name: 'u7' },
      });
      fixture.detectChanges();
    }

    function reloadTypes(types: { id: number; name: string }[]) {
      httpMock
        .expectOne({ url: '/organizator/odate_types', method: 'GET' })
        .flush({ odate_types: types, requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();
    }

    it('shows each list in its own panel', () => {
      load({ locations: [{ id: 1, name: 'Office' }], types: [{ id: 2, name: 'Meeting' }] });

      expect(panel('loc').textContent).toContain('Office');
      expect(panel('ot').textContent).toContain('Meeting');
    });

    it('keeps the create field open on an empty list, and says why it is empty', () => {
      load();

      expect(panel('loc').textContent).toContain('You have no locations yet');
      expect(query<HTMLInputElement>('#loc-new-name')).toBeTruthy();
    });

    it('adds a location and shows it', () => {
      load();

      submitPlace('loc', 'Office');

      const request = httpMock.expectOne({ url: '/organizator/locations', method: 'POST' });
      expect(request.request.body).toEqual({ name: 'Office' });
      request.flush({ id: 4, name: 'Office' });
      fixture.detectChanges();

      reloadLocations([{ id: 4, name: 'Office' }]);

      expect(panel('loc').textContent).toContain('Office');
      expect(text()).toContain('Added “Office”');
    });

    it('asks the server for nothing when the new name is blank', () => {
      load();

      submitPlace('loc', '   ');

      httpMock.expectNone({ url: '/organizator/locations', method: 'POST' });
    });

    it('renames a location, and reads the entries again because they carry a copy of the name', () => {
      load({ odates: [DENTIST], locations: [{ id: 1, name: 'Office' }] });

      renamePlace('loc', 1, 'HQ');

      const request = httpMock.expectOne({ url: '/organizator/locations/1', method: 'PUT' });
      expect(request.request.body).toEqual({ name: 'HQ' });
      request.flush({ id: 1, name: 'HQ' });
      fixture.detectChanges();

      reloadLocations([{ id: 1, name: 'HQ' }]);
      // The list above is drawn from the server's copy of the name, so it is stale until reread.
      httpMock
        .expectOne({ url: '/organizator/odates', method: 'GET' })
        .flush({ odates: [DENTIST], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();

      expect(panel('loc').textContent).toContain('HQ');
      // "Saved", not "Renamed": the same form now carries the coordinates too.
      expect(text()).toContain('Saved “HQ”');
    });

    it('deletes a location only after the confirmation, then says so', () => {
      load({ locations: [{ id: 1, name: 'Office' }] });

      query<HTMLButtonElement>('#loc-delete-1').click();
      fixture.detectChanges();

      // The first press only asks: nothing has gone to the server yet.
      httpMock.expectNone({ url: '/organizator/locations/1', method: 'DELETE' });
      expect(panel('loc').textContent).toContain('Delete Office?');

      query<HTMLButtonElement>('#loc-confirm-delete-1').click();
      fixture.detectChanges();

      httpMock
        .expectOne({ url: '/organizator/locations/1', method: 'DELETE' })
        .flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();

      reloadLocations([]);

      expect(panel('loc').textContent).toContain('Deleted “Office”');
      // The row is gone, not merely relabelled — the message naming it is meant to stay.
      expect(panel('loc').querySelectorAll('.place')).toHaveLength(0);
      // The row went with it, so focus lands on the panel heading rather than nowhere.
      expect((document.activeElement as HTMLElement).tagName).toBe('H2');
      // Nothing read the entries again: a row an entry still holds cannot be deleted at all.
      httpMock.expectNone({ url: '/organizator/odates', method: 'GET' });
    });

    it('shows what the server said when a rename is refused, and reloads nothing', () => {
      load({ locations: [{ id: 1, name: 'Office' }] });

      renamePlace('loc', 1, 'Home');

      httpMock
        .expectOne({ url: '/organizator/locations/1', method: 'PUT' })
        .flush(
          { error: 'You already have a location called 「Home」' },
          { status: 409, statusText: 'Conflict' }
        );
      fixture.detectChanges();

      expect(text()).toContain('You already have a location called 「Home」');
      expect(panel('loc').textContent).toContain('Office');
      httpMock.expectNone({ url: '/organizator/locations', method: 'GET' });
    });

    it('keeps the row and says how many entries hold it when a delete is refused', () => {
      load({ locations: [{ id: 1, name: 'Office' }] });

      confirmDelete('loc', 1);

      httpMock
        .expectOne({ url: '/organizator/locations/1', method: 'DELETE' })
        .flush(
          { error: '3 entries still use this location' },
          { status: 409, statusText: 'Conflict' }
        );
      fixture.detectChanges();

      expect(text()).toContain('3 entries still use this location');
      expect(panel('loc').textContent).toContain('Office');
      httpMock.expectNone({ url: '/organizator/locations', method: 'GET' });
    });

    it('adds, renames and deletes a date type', () => {
      load({ types: [{ id: 2, name: 'Meeting' }] });

      submitPlace('ot', 'Standup');
      const post = httpMock.expectOne({ url: '/organizator/odate_types', method: 'POST' });
      expect(post.request.body).toEqual({ name: 'Standup' });
      post.flush({ id: 3, name: 'Standup' });
      fixture.detectChanges();
      reloadTypes([{ id: 2, name: 'Meeting' }, { id: 3, name: 'Standup' }]);

      renamePlace('ot', 3, 'Daily');
      const put = httpMock.expectOne({ url: '/organizator/odate_types/3', method: 'PUT' });
      expect(put.request.body).toEqual({ name: 'Daily' });
      put.flush({ id: 3, name: 'Daily' });
      fixture.detectChanges();
      reloadTypes([{ id: 2, name: 'Meeting' }, { id: 3, name: 'Daily' }]);
      httpMock
        .expectOne({ url: '/organizator/odates', method: 'GET' })
        .flush({ odates: [], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();

      confirmDelete('ot', 3);
      httpMock
        .expectOne({ url: '/organizator/odate_types/3', method: 'DELETE' })
        .flush(null, { status: 204, statusText: 'No Content' });
      fixture.detectChanges();
      reloadTypes([{ id: 2, name: 'Meeting' }]);

      expect(panel('ot').textContent).toContain('Meeting');
      expect(panel('ot').textContent).toContain('Deleted “Daily”');
      // Only Meeting's row is left; Daily's is gone and only the message naming it remains.
      expect(panel('ot').querySelectorAll('.place')).toHaveLength(1);
    });

    it('keeps a refusal on the panel it belongs to', () => {
      load({ types: [{ id: 2, name: 'Meeting' }] });

      submitPlace('ot', 'Meeting');

      httpMock
        .expectOne({ url: '/organizator/odate_types', method: 'POST' })
        .flush(
          { error: 'You already have a date type called 「Meeting」' },
          { status: 409, statusText: 'Conflict' }
        );
      fixture.detectChanges();

      expect(panel('ot').textContent).toContain('You already have a date type called 「Meeting」');
      expect(panel('loc').textContent).not.toContain('date type called');
    });

    it('puts focus in the field, and back on its trigger when it is cancelled', () => {
      load({ locations: [{ id: 1, name: 'Office' }] });

      query<HTMLButtonElement>('#loc-edit-1').click();
      fixture.detectChanges();
      expect((document.activeElement as HTMLElement).tagName).toBe('INPUT');

      // Cancel is the only button in the row that does not submit it.
      query<HTMLButtonElement>('.edit-row button[type="button"]').click();
      fixture.detectChanges();
      expect((document.activeElement as HTMLElement).tagName).toBe('BUTTON');
      expect((document.activeElement as HTMLElement).id).toBe('loc-edit-1');
    });

    /**
     * A location may carry a place on the earth. It is entered as the pair a map hands you and
     * shown with a link out to it — no API key, and no third-party script in the page.
     */
    describe('the map link', () => {
      const OFFICE = { id: 4, name: 'Office', latitude: 44.4268, longitude: 26.1025 };

      it('shows the coordinates and a link for a location that has them', () => {
        load({ locations: [OFFICE] });

        expect(panel('loc').textContent).toContain('44.42680, 26.10250');

        const link = panel('loc').querySelector(
          'a[href^="https://www.google.com/maps"]'
        ) as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe('https://www.google.com/maps?q=44.4268,26.1025');
        // Out of the page, and a window handle is not handed over.
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toContain('noopener');
      });

      it('offers no map for a location that has no coordinates', () => {
        load({ locations: [{ id: 5, name: 'Home' }] });

        expect(panel('loc').textContent).toContain('Home');
        expect(panel('loc').querySelector('a[href^="https://www.google.com/maps"]')).toBeNull();
      });

      it('has no coordinate field on a date type, which is only a name', () => {
        load({ types: [{ id: 2, name: 'Meeting' }] });

        expect(panel('ot').querySelector('#ot-new-coordinates')).toBeNull();
        // And its row action is still a rename, there being nothing else to change.
        expect(panel('ot').textContent).toContain('Rename Meeting');
      });

      it('creates a location from a pasted pair', () => {
        load();

        const name = query<HTMLInputElement>('#loc-new-name');
        name.value = 'Office';
        query<HTMLInputElement>('#loc-new-coordinates').value = '44.4268, 26.1025';
        name.closest('form')?.dispatchEvent(new Event('submit'));
        fixture.detectChanges();

        const request = httpMock.expectOne({ url: '/organizator/locations', method: 'POST' });
        expect(request.request.body).toEqual({
          name: 'Office',
          latitude: 44.4268,
          longitude: 26.1025,
        });
        request.flush({ ...OFFICE, timezone: null, last_used: null });
        fixture.detectChanges();

        reloadLocations([OFFICE]);

        expect(panel('loc').textContent).toContain('44.42680, 26.10250');
      });

      it('refuses a paste it cannot read, and asks the server for nothing', () => {
        load();

        const name = query<HTMLInputElement>('#loc-new-name');
        name.value = 'Office';
        query<HTMLInputElement>('#loc-new-coordinates').value = `44°25'36.5"N`;
        name.closest('form')?.dispatchEvent(new Event('submit'));
        fixture.detectChanges();

        httpMock.expectNone({ url: '/organizator/locations', method: 'POST' });
        expect(panel('loc').textContent).toContain('is not a latitude and longitude');
        // What was typed stays where it was, so it can be corrected rather than typed again.
        expect(query<HTMLInputElement>('#loc-new-name').value).toBe('Office');
        expect(query<HTMLInputElement>('#loc-new-coordinates').value).toBe(`44°25'36.5"N`);
      });

      it('sends the coordinates back on a save, so renaming does not lose them', () => {
        load({ locations: [OFFICE] });

        renamePlace('loc', 4, 'HQ');

        const request = httpMock.expectOne({ url: '/organizator/locations/4', method: 'PUT' });
        // The pair travelled with the name: the server replaces the whole location, so a body
        // carrying only the name would have taken the coordinates away.
        expect(request.request.body).toEqual({
          name: 'HQ',
          latitude: 44.4268,
          longitude: 26.1025,
        });
        request.flush({ ...OFFICE, name: 'HQ', timezone: null, last_used: null });
        fixture.detectChanges();

        reloadLocations([{ ...OFFICE, name: 'HQ' }]);
        httpMock
          .expectOne({ url: '/organizator/odates', method: 'GET' })
          .flush({ odates: [], requester: { id: 7, name: 'u7' } });
        fixture.detectChanges();

        expect(panel('loc').textContent).toContain('HQ');
        expect(panel('loc').textContent).toContain('44.42680, 26.10250');
      });

      it('lets a location change place without changing its name', () => {
        load({ locations: [OFFICE] });

        renamePlace('loc', 4, 'Office', '48.8584, 2.2945');

        const request = httpMock.expectOne({ url: '/organizator/locations/4', method: 'PUT' });
        expect(request.request.body).toEqual({
          name: 'Office',
          latitude: 48.8584,
          longitude: 2.2945,
        });
        request.flush({
          id: 4,
          name: 'Office',
          latitude: 48.8584,
          longitude: 2.2945,
          timezone: null,
          last_used: null,
        });
        fixture.detectChanges();

        reloadLocations([{ id: 4, name: 'Office', latitude: 48.8584, longitude: 2.2945 }]);
        httpMock
          .expectOne({ url: '/organizator/odates', method: 'GET' })
          .flush({ odates: [], requester: { id: 7, name: 'u7' } });
        fixture.detectChanges();

        expect(panel('loc').textContent).toContain('48.85840, 2.29450');
      });
    });

    it('does not claim the locations are gone when the read failed', () => {
      fixture.detectChanges();
      httpMock
        .expectOne({ url: '/organizator/odates', method: 'GET' })
        .flush({ odates: [], requester: { id: 7, name: 'u7' } });
      httpMock
        .expectOne({ url: '/organizator/locations', method: 'GET' })
        .flush(null, { status: 500, statusText: 'Server Error' });
      httpMock
        .expectOne({ url: '/organizator/odate_types', method: 'GET' })
        .flush({ odate_types: [], requester: { id: 7, name: 'u7' } });
      fixture.detectChanges();

      expect(panel('loc').textContent).toContain('Could not read your locations');
      expect(panel('loc').textContent).not.toContain('You have no locations yet');
    });
  });
});
