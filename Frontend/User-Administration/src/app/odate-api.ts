import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { serverReason } from './panel-status';

/** An id and a name: what an entry carries for its location and its type. */
export interface Named {
  id: number;
  name: string;
}

/** A place the caller has saved, to put on an entry. */
export interface OdateLocation extends Named {
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
  /** Not maintained by anything yet; always null. See docs/odate.md. */
  last_used: number | null;
}

export type OdateType = Named;

/**
 * Where an entry is: the name, and the point if that location has one.
 *
 * Both coordinates ride along with the name so a list can offer a map without a second read, and
 * both are null for a location nobody has put on the earth — which is the ordinary state of one.
 */
export interface OdatePlace extends Named {
  latitude: number | null;
  longitude: number | null;
}

export interface Odate {
  id: number;
  /** Epoch milliseconds, as the column stores them. */
  start_time: number;
  end_time: number;
  /** True while the entry is happening now — computed by the server, which owns the clock. */
  ongoing: boolean;
  description: string | null;
  memo_text: string | null;
  /** Null when the entry has none: the location is optional. */
  location: OdatePlace | null;
  type: Named | null;
}

/** What creating an entry sends. Everything but the two times is optional. */
export interface NewOdate {
  start_time: number;
  end_time: number;
  description?: string;
  memo_text?: string;
  location_id?: number;
  type?: number;
}

/**
 * What creating or replacing a location sends. Only the name is required — a location with no
 * coordinates is still somewhere to say an entry happened.
 *
 * `timezone` is offered by no screen, and something has to carry it nonetheless: `PUT` replaces
 * the whole location, so a caller that left it out would take it away. The panel round-trips
 * whatever the row already had.
 */
export interface NewLocation {
  name: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

interface OdateListWire {
  odates: Odate[] | null;
  requester: Named;
}

interface LocationListWire {
  locations: OdateLocation[] | null;
  requester: Named;
}

interface OdateTypeListWire {
  odate_types: OdateType[] | null;
  requester: Named;
}

/**
 * The calendar endpoints.
 *
 * Every list is normalized on the way in: the server builds them with `json_agg`, which is SQL
 * NULL over no rows, so "nothing yet" arrives as `null` rather than `[]` — and a screen that
 * reads a null list as an array breaks on the first visit rather than showing an empty one.
 */
@Injectable({
  providedIn: 'root',
})
export class OdateApi {
  private http = inject(HttpClient);

  // Automatically sends the stored JWT cookie, like every other call in the app.
  private readonly options = { withCredentials: true } as const;

  /**
   * The caller's entries, soonest first.
   *
   * With no range that is everything which has not finished — what the screen shows on arrival.
   * With one it is whatever overlaps that stretch of time, **entries that have already happened
   * included**, which is the whole point of asking for a range: the plain list stops at now.
   */
  odates(range?: { from?: number; until?: number }): Observable<Odate[]> {
    let params = new HttpParams();
    if (range?.from !== undefined) params = params.set('from', `${range.from}`);
    if (range?.until !== undefined) params = params.set('until', `${range.until}`);

    return this.http
      .get<OdateListWire>('/organizator/odates', { ...this.options, params })
      .pipe(map(wire => wire.odates ?? []));
  }

  locations(): Observable<OdateLocation[]> {
    return this.http
      .get<LocationListWire>('/organizator/locations', this.options)
      .pipe(map(wire => wire.locations ?? []));
  }

  odateTypes(): Observable<OdateType[]> {
    return this.http
      .get<OdateTypeListWire>('/organizator/odate_types', this.options)
      .pipe(map(wire => wire.odate_types ?? []));
  }

  /** Answers with the entry it made, so the caller can show it without a second read. */
  createOdate(entry: NewOdate): Observable<Odate> {
    return this.http.post<Odate>('/organizator/odates', entry, this.options);
  }

  /** Replaces an entry wholesale: the body is the whole of it, the same shape create takes. */
  updateOdate(id: number, entry: NewOdate): Observable<Odate> {
    return this.http.put<Odate>(`/organizator/odates/${id}`, entry, this.options);
  }

  // The writes behind the location and date-type panels. Each of the creates and renames answers
  // with the row it wrote, so the caller can put it on the screen without reading the list again;
  // the deletes answer 204 and nothing else. Only the name travels: a location's coordinates are
  // optional and nothing on this screen sets them.

  createLocation(place: NewLocation): Observable<OdateLocation> {
    return this.http.post<OdateLocation>('/organizator/locations', place, this.options);
  }

  /** Replaces a location wholesale: the body is the whole of it, the same shape create takes. */
  updateLocation(id: number, place: NewLocation): Observable<OdateLocation> {
    return this.http.put<OdateLocation>(`/organizator/locations/${id}`, place, this.options);
  }

  deleteLocation(id: number): Observable<void> {
    return this.http.delete<void>(`/organizator/locations/${id}`, this.options);
  }

  createOdateType(name: string): Observable<OdateType> {
    return this.http.post<OdateType>('/organizator/odate_types', { name }, this.options);
  }

  renameOdateType(id: number, name: string): Observable<OdateType> {
    return this.http.put<OdateType>(`/organizator/odate_types/${id}`, { name }, this.options);
  }

  deleteOdateType(id: number): Observable<void> {
    return this.http.delete<void>(`/organizator/odate_types/${id}`, this.options);
  }
}

/**
 * What to tell the visitor about a change to a location or a date type that failed.
 *
 * The shape `groupChangeFailed` uses, for the same reasons: the server's own words come first,
 * because a 409 here is the real answer — the name is taken, or entries still use the row — and
 * 403 is reworded because the database's own refusal names nothing.
 */
export function placeChangeFailed(err: HttpErrorResponse, what: string): string {
  // A refusal the database made on the caller's behalf carries only "Data access forbidden",
  // which names nothing, so the app's own wording is more use here than the server's.
  if (err.status === 403) return `You are not allowed to change ${what}.`;

  const reason = serverReason(err);
  if (reason !== null) return `Could not change ${what}: ${reason}`;

  // Nothing said. A 404 with no body is axum's fallback for a path no handler is registered on,
  // and a 405 is a path that exists without that method: both mean the app is being served by a
  // backend older than these endpoints.
  if (err.status === 404 || err.status === 405) {
    return `The server does not support changing ${what} yet (it answered ${err.status}).`;
  }
  if (err.status === 0) {
    return `The server could not be reached, so ${what} was not changed.`;
  }
  // Not "the name is taken": the body says which state refused, and there was none to read.
  if (err.status === 409) return `Something else changed first, so ${what} was not changed.`;
  return `Failed to change ${what}.`;
}
