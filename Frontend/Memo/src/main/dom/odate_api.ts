/**
 * @prettier
 *
 * The calendar's side of the server: the entries, the locations and the date types.
 *
 * Every call goes out with the session cookie and answers either with what was asked for or with one
 * of two errors — UnauthenticatedError for a session that is gone, and ServerRefusal for everything
 * else, which carries the status and, when the server explained itself, its words.
 */
import konsole from "./console_log.js";
import {HttpError, UnauthenticatedError, server_reason} from "./http.js";

export interface Named {
  id: number;
  name: string;
}

/** The location as an entry carries it: a name and, if somebody put it on the earth, a point. */
export interface OdatePlace extends Named {
  latitude: number | null;
  longitude: number | null;
}

export interface OdateLocation extends OdatePlace {
  timezone: string | null;
  /// Not maintained by anything yet; always null.
  last_used: number | null;
}

export type OdateType = Named;

export interface Odate {
  id: number;
  /// Epoch milliseconds, as the column stores them.
  start_time: number;
  end_time: number;
  /// True while the entry is happening now — computed by the server, which owns the clock.
  ongoing: boolean;
  description: string | null;
  memo_text: string | null;
  location: OdatePlace | null;
  type: Named | null;
}

export interface NewOdate {
  start_time: number;
  end_time: number;
  description?: string;
  memo_text?: string;
  location_id?: number;
  type?: number;
}

export interface NewLocation {
  name: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

/// The three list answers. The lists are `json_agg` on the server, which is SQL NULL over no rows,
/// so "nothing yet" arrives as null rather than as an empty list.
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
 * A refusal that was not about the session. `status` 0 is the request that never arrived — the
 * server unreachable, the network down — which fetch reports by throwing rather than by answering.
 */
export class ServerRefusal extends HttpError {
  constructor(
    status: number,
    public reason: string | null
  ) {
    super(status, reason ?? `the server answered ${status}`);
    this.name = "ServerRefusal";
  }
}

/// The options every call here goes out with: the session cookie, and nothing cached anywhere along
/// the way — an entry that was just added has to be in the next list, not in a proxy's copy of the
/// last one.
const request_options = (method: string, body: unknown): RequestInit => ({
  method,
  credentials: "include",
  mode: "cors",
  headers: {
    Accept: "application/json",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "X-Requested-With": "XMLHttpRequest",
    "x-organizator-client-version": "3",
    ...(body === undefined ? {} : {"Content-Type": "application/json"}),
  },
  ...(body === undefined ? {} : {body: JSON.stringify(body)}),
});

/// What a GET adds so that no cache between here and the server answers it: the server ignores it.
const prevent_cache = (): string => `request.preventCache=${+new Date()}`;

const call = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, request_options(method, body));
  } catch (e) {
    konsole.log(`Could not reach the server for ${url}`, e);
    throw new ServerRefusal(0, null);
  }

  if (response.status === 401) throw new UnauthenticatedError();

  if (!response.ok) {
    // Read before throwing: the body is the server's own account of what was wrong, and a 409 in
    // particular is only worth anything with it.
    const reason = await server_reason(response);
    konsole.log(`${method} ${url} answered ${response.status}${reason ? `: ${reason}` : ""}`);
    throw new ServerRefusal(response.status, reason);
  }

  // The deletes answer 204 and nothing else.
  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch (e) {
    konsole.log(`${method} ${url} answered ${response.status} with a body that is not JSON`, e);
    throw new ServerRefusal(response.status, null);
  }
};

/**
 * The caller's entries, soonest first.
 *
 * With no range that is everything which has not finished — what the screen opens on. With one it is
 * whatever overlaps that stretch of time, **entries that have already happened included**, which is
 * the whole point of asking for a range: the plain list stops at now.
 */
export const read_odates = async (range?: {from?: number; until?: number}): Promise<Odate[]> => {
  const asked = new URLSearchParams();
  if (range?.from !== undefined) asked.set("from", `${range.from}`);
  if (range?.until !== undefined) asked.set("until", `${range.until}`);
  asked.set("request.preventCache", `${+new Date()}`);

  const wire = await call<OdateListWire>("GET", `/organizator/odates?${asked}`);
  return wire.odates ?? [];
};

export const read_locations = async (): Promise<OdateLocation[]> => {
  const wire = await call<LocationListWire>("GET", `/organizator/locations?${prevent_cache()}`);
  return wire.locations ?? [];
};

export const read_odate_types = async (): Promise<OdateType[]> => {
  const wire = await call<OdateTypeListWire>("GET", `/organizator/odate_types?${prevent_cache()}`);
  return wire.odate_types ?? [];
};

/** Answers with the entry it made, so the caller can name it without a second read. */
export const create_odate = (entry: NewOdate): Promise<Odate> =>
  call<Odate>("POST", "/organizator/odates", entry);

/** Replaces an entry wholesale: the body is the whole of it, the same shape create takes. */
export const update_odate = (id: number, entry: NewOdate): Promise<Odate> =>
  call<Odate>("PUT", `/organizator/odates/${id}`, entry);

/** The same pair for the places: a write replaces the row, so the body carries every field. */
export const create_location = (place: NewLocation): Promise<OdateLocation> =>
  call<OdateLocation>("POST", "/organizator/locations", place);

export const update_location = (id: number, place: NewLocation): Promise<OdateLocation> =>
  call<OdateLocation>("PUT", `/organizator/locations/${id}`, place);

export const delete_location = (id: number): Promise<void> =>
  call<void>("DELETE", `/organizator/locations/${id}`);

export const create_odate_type = (name: string): Promise<OdateType> =>
  call<OdateType>("POST", "/organizator/odate_types", {name});

export const rename_odate_type = (id: number, name: string): Promise<OdateType> =>
  call<OdateType>("PUT", `/organizator/odate_types/${id}`, {name});

export const delete_odate_type = (id: number): Promise<void> =>
  call<void>("DELETE", `/organizator/odate_types/${id}`);

/**
 * What to tell the reader about a change to a location or a date type that failed.
 *
 * The server's own words come first, because a 409 here is the real answer — the name is taken, or
 * entries still use the row — and 403 is reworded because the database's refusal names nothing.
 */
export const place_change_failed = (e: ServerRefusal, what: string): string => {
  if (e.status === 403) return `You are not allowed to change ${what}.`;
  if (e.reason !== null) return `Could not change ${what}: ${e.reason}`;

  // Nothing said. A 404 with no body is axum's fallback for a path no handler is registered on, and
  // a 405 is a path that exists without that method: both mean the app is being served by a backend
  // older than these endpoints.
  if (e.status === 404 || e.status === 405) {
    return `The server does not support changing ${what} yet (it answered ${e.status}).`;
  }
  if (e.status === 0) return `The server could not be reached, so ${what} was not changed.`;
  // Not "the name is taken": the body says which state refused, and there was none to read.
  if (e.status === 409) return `Something else changed first, so ${what} was not changed.`;
  return `Failed to change ${what}.`;
};

/** The same for the entry itself, where the server's words (422 on a backwards interval) matter. */
export const entry_change_failed = (e: ServerRefusal, doing: string): string =>
  e.reason !== null ? `Could not ${doing} the entry: ${e.reason}` : `Could not ${doing} the entry.`;
