import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { Odate, OdateApi, OdateLocation, placeChangeFailed } from './odate-api';

const LOCATION: OdateLocation = {
  id: 4,
  name: 'Office',
  latitude: 44.4268,
  longitude: 26.1025,
  timezone: 'Europe/Bucharest',
  last_used: null,
};

const ENTRY: Odate = {
  id: 1,
  start_time: 1751000000000,
  end_time: 1751003600000,
  ongoing: false,
  description: 'Dentist',
  memo_text: null,
  location: { id: 1, name: 'Office', latitude: 44.4268, longitude: 26.1025 },
  type: null,
};

describe('OdateApi', () => {
  let api: OdateApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    api = TestBed.inject(OdateApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sends the cookies with every call', () => {
    api.odates().subscribe();
    const request = httpMock.expectOne({ url: '/organizator/odates', method: 'GET' });
    expect(request.request.withCredentials).toBe(true);
    request.flush({ odates: [], requester: { id: 7, name: 'u7' } });
  });

  it('reads the calendar', () => {
    let received: Odate[] | undefined;
    api.odates().subscribe(entries => (received = entries));

    httpMock
      .expectOne({ url: '/organizator/odates', method: 'GET' })
      .flush({ odates: [ENTRY], requester: { id: 7, name: 'u7' } });

    expect(received).toEqual([ENTRY]);
  });

  it('turns a null list into an empty one, for all three reads', () => {
    // The server builds these with json_agg, which is SQL NULL over no rows, so "nothing yet"
    // arrives as null — and a screen that reads a null list as an array breaks on first visit.
    let odates: Odate[] | undefined;
    api.odates().subscribe(entries => (odates = entries));
    httpMock
      .expectOne({ url: '/organizator/odates', method: 'GET' })
      .flush({ odates: null, requester: { id: 7, name: 'u7' } });
    expect(odates).toEqual([]);

    let locations: unknown;
    api.locations().subscribe(places => (locations = places));
    httpMock
      .expectOne({ url: '/organizator/locations', method: 'GET' })
      .flush({ locations: null, requester: { id: 7, name: 'u7' } });
    expect(locations).toEqual([]);

    let types: unknown;
    api.odateTypes().subscribe(list => (types = list));
    httpMock
      .expectOne({ url: '/organizator/odate_types', method: 'GET' })
      .flush({ odate_types: null, requester: { id: 7, name: 'u7' } });
    expect(types).toEqual([]);
  });

  it('creates an entry, sending only what was given', () => {
    let received: Odate | undefined;
    api
      .createOdate({ start_time: 1751000000000, end_time: 1751003600000 })
      .subscribe(created => (received = created));

    const request = httpMock.expectOne({ url: '/organizator/odates', method: 'POST' });
    // Times and nothing else: the optional fields are left out rather than sent empty.
    expect(request.request.body).toEqual({
      start_time: 1751000000000,
      end_time: 1751003600000,
    });

    request.flush(ENTRY);
    expect(received).toEqual(ENTRY);
  });

  it('creates an entry with everything filled in', () => {
    api
      .createOdate({
        start_time: 1,
        end_time: 2,
        description: 'Dentist',
        memo_text: 'bring the card',
        location_id: 3,
        type: 4,
      })
      .subscribe();

    const request = httpMock.expectOne({ url: '/organizator/odates', method: 'POST' });
    expect(request.request.body).toEqual({
      start_time: 1,
      end_time: 2,
      description: 'Dentist',
      memo_text: 'bring the card',
      location_id: 3,
      type: 4,
    });
    request.flush(ENTRY);
  });

  it('creates, replaces and deletes a location', () => {
    let created: unknown;
    const sent = { name: 'Office', latitude: 44.4268, longitude: 26.1025 };

    api.createLocation(sent).subscribe(place => (created = place));
    const post = httpMock.expectOne({ url: '/organizator/locations', method: 'POST' });
    expect(post.request.body).toEqual(sent);
    expect(post.request.withCredentials).toBe(true);
    post.flush(LOCATION);
    expect(created).toEqual(LOCATION);

    let saved: unknown;
    // A PUT replaces the whole location, timezone included — the panel carries back what was
    // there so that a save cannot quietly empty a field it does not show.
    const replacement = { ...sent, name: 'HQ', timezone: 'Europe/Bucharest' };
    api.updateLocation(4, replacement).subscribe(place => (saved = place));
    const put = httpMock.expectOne({ url: '/organizator/locations/4', method: 'PUT' });
    expect(put.request.body).toEqual(replacement);
    put.flush(LOCATION);
    expect(saved).toEqual(LOCATION);

    let deleted = false;
    api.deleteLocation(4).subscribe(() => (deleted = true));
    // A delete answers 204 with no body at all, not a row.
    httpMock
      .expectOne({ url: '/organizator/locations/4', method: 'DELETE' })
      .flush(null, { status: 204, statusText: 'No Content' });
    expect(deleted).toBe(true);
  });

  it('sends a location with no coordinates as just its name', () => {
    // A location without a point on the earth is still somewhere to say an entry happened, so
    // the fields are left out rather than sent as null.
    api.createLocation({ name: 'Home' }).subscribe();
    const post = httpMock.expectOne({ url: '/organizator/locations', method: 'POST' });
    expect(post.request.body).toEqual({ name: 'Home' });
    post.flush({ id: 5, name: 'Home', latitude: null, longitude: null, timezone: null, last_used: null });
  });

  it('creates, renames and deletes a date type', () => {
    api.createOdateType('Meeting').subscribe();
    const post = httpMock.expectOne({ url: '/organizator/odate_types', method: 'POST' });
    expect(post.request.body).toEqual({ name: 'Meeting' });
    post.flush({ id: 3, name: 'Meeting' });

    api.renameOdateType(3, 'Standup').subscribe();
    const put = httpMock.expectOne({ url: '/organizator/odate_types/3', method: 'PUT' });
    expect(put.request.body).toEqual({ name: 'Standup' });
    put.flush({ id: 3, name: 'Standup' });

    api.deleteOdateType(3).subscribe();
    httpMock
      .expectOne({ url: '/organizator/odate_types/3', method: 'DELETE' })
      .flush(null, { status: 204, statusText: 'No Content' });
  });
});

/** What a failure says to the visitor, which is the only part of the error they ever see. */
describe('placeChangeFailed', () => {
  function failure(status: number, error: unknown) {
    return { status, error } as Parameters<typeof placeChangeFailed>[0];
  }

  it('says the endpoint is not built yet when a bare 404 or 405 comes back', () => {
    // axum answers an unrouted path with a bare 404, and that — not the status on its own — is
    // what says nothing is listening there. The app can be served by an older backend.
    expect(placeChangeFailed(failure(404, null), 'the location')).toContain('does not support');
    expect(placeChangeFailed(failure(404, ''), 'the location')).toContain('does not support');
    expect(placeChangeFailed(failure(405, null), 'the location')).toContain('does not support');
  });

  it('reads a 404 that carries a reason as the refusal it is', () => {
    expect(placeChangeFailed(failure(404, { error: 'No such location' }), 'the location 「Office」')).toBe(
      'Could not change the location 「Office」: No such location'
    );
  });

  it('reads a 409 as the state refusing, in the server\'s own words', () => {
    // Both 409s these endpoints answer say which state refused: the name is taken, or entries
    // still hold the row.
    expect(
      placeChangeFailed(failure(409, { error: 'You already have a location called 「Home」' }), 'the location')
    ).toBe('Could not change the location: You already have a location called 「Home」');

    expect(
      placeChangeFailed(
        failure(409, { error: '3 entries still use this location' }),
        'the location 「Office」'
      )
    ).toBe('Could not change the location 「Office」: 3 entries still use this location');
  });

  it('says the caller is not allowed, rather than repeating the database', () => {
    // The database's own 403 body is "Data access forbidden", which names nothing.
    expect(placeChangeFailed(failure(403, { error: 'Data access forbidden' }), 'the location')).toBe(
      'You are not allowed to change the location.'
    );
  });

  it('says the server could not be reached when nothing came back', () => {
    expect(placeChangeFailed(failure(0, null), 'the location')).toBe(
      'The server could not be reached, so the location was not changed.'
    );
  });

  it('never shows a proxy\'s HTML error page', () => {
    const message = placeChangeFailed(
      failure(502, '<html><body>Bad Gateway</body></html>'),
      'the location'
    );

    expect(message).not.toContain('<');
    expect(message).toBe('Failed to change the location.');
  });
});
