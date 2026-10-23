/**
 * @prettier
 *
 * What an event shared into the app says, turned into the fields of an entry.
 *
 * Android's share sheet is the one door a web app has into another app's "add to calendar": the
 * system's own calendar-insert intent only reaches native calendar providers, so a PWA cannot be
 * in that chooser. What arrives here is what the sharing app put in title/text/url — most usefully
 * a Google Calendar template link, which carries the title, the times, the place and the details
 * as query parameters. A share without such a link still makes an entry; only its times are left
 * for the reader, which is what a calendar's own insert screen does with a bare event.
 */

export interface SharedContent {
  title: string | null;
  text: string | null;
  url: string | null;
  /// An .ics file shared with the event, as its text. The share target accepts one.
  ics?: string | null;
}

export interface SharedEvent {
  description?: string;
  memo_text?: string;
  start_time?: number;
  end_time?: number;
  location?: string;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/g;

const first_line = (text: string | null): string | undefined => {
  if (text === null) return undefined;
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line !== "");
};

/**
 * The start and end a Google Calendar link carries in `dates`:
 *
 *   YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ   a timed event, in UTC
 *   YYYYMMDD/YYYYMMDD                   an all-day one, in local days
 *
 * The all-day end is exclusive — the second date is the morning after, which is how Google
 * writes it. A link with a timed start and an untimed end (or the reverse) says nothing usable
 * and is refused rather than half-read.
 */
const google_dates = (dates: string | null): {start_time: number; end_time: number} | null => {
  if (dates === null) return null;
  const at =
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?\/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(
      dates
    );
  if (at === null) return null;

  const [, y1, mo1, d1, h1, mi1, s1, y2, mo2, d2, h2, mi2, s2] = at;
  const timed = h1 !== undefined && h2 !== undefined;
  if ((h1 === undefined) !== (h2 === undefined)) return null;

  const start_time = timed
    ? Date.UTC(+y1, +mo1 - 1, +d1, +h1, +mi1, +s1)
    : new Date(+y1, +mo1 - 1, +d1).getTime();
  const end_time = timed
    ? Date.UTC(+y2, +mo2 - 1, +d2, +h2, +mi2, +s2)
    : new Date(+y2, +mo2 - 1, +d2).getTime();

  return end_time > start_time ? {start_time, end_time} : null;
};

const google_event = (source: string): SharedEvent | null => {
  let at: URL;
  try {
    at = new URL(source);
  } catch {
    return null;
  }
  const is_calendar =
    at.hostname === "calendar.google.com" ||
    (at.hostname === "www.google.com" && at.pathname.startsWith("/calendar"));
  if (!is_calendar) return null;

  const dates = google_dates(at.searchParams.get("dates"));
  if (dates === null) return null;

  const description = at.searchParams.get("text")?.trim() || undefined;
  const details = at.searchParams.get("details")?.trim() || undefined;
  const location = at.searchParams.get("location")?.trim() || undefined;

  const event: SharedEvent = {start_time: dates.start_time, end_time: dates.end_time};
  if (description !== undefined) event.description = description;
  if (details !== undefined) event.memo_text = details;
  if (location !== undefined) event.location = location;
  return event;
};

const from_text = (shared: SharedContent): SharedEvent => {
  const lines = (shared.text ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== "");

  let description = shared.title?.trim() ?? "";
  if (description === "" && lines.length > 0) description = lines.shift() as string;
  // A sharing app often repeats the title as the first line of the text.
  if (lines.length > 0 && lines[0] === description) lines.shift();

  const url = shared.url?.trim() ?? "";
  const memo_lines = lines.filter(line => line !== url);
  // The source link is worth keeping, once — unless it was all the text had, in which case it is
  // already the description.
  if (url !== "" && url !== description) memo_lines.push(url);

  const event: SharedEvent = {};
  if (description !== "") event.description = description;
  const memo = memo_lines.join("\n").trim();
  if (memo !== "") event.memo_text = memo;
  return event;
};

/// An .ics file's escaping: `\n` is a newline, `\,` a comma, `\;` a semicolon, `\\` a backslash.
const unescape_ics = (value: string): string =>
  value.replace(/\\([\\;,nN])/g, (_, character: string) =>
    character === "n" || character === "N" ? "\n" : character
  );

/// An IANA zone name inside a TZID, which may carry a vendor prefix such as
/// `/mozilla.org/20050126_1/Europe/Bucharest`. Null when the browser does not know the zone.
const zone_name = (tzid: string): string | null => {
  const unquoted = tzid.replace(/^"|"$/g, "");
  const name = /([A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+)+)$/.exec(unquoted)?.[1] ?? unquoted;
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: name});
    return name;
  } catch {
    return null;
  }
};

/// A wall-clock time in a named zone, as epoch milliseconds. Two passes settle a time near a
/// daylight-saving change, where the first guess lands on the other side of it.
const wall_time_in_zone = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: string
): number => {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let epoch = wall;
  for (let pass = 0; pass < 3; pass++) {
    const parts = Object.fromEntries(
      format.formatToParts(new Date(epoch)).map(part => [part.type, part.value])
    );
    const seen = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const correction = wall - seen;
    epoch += correction;
    if (correction === 0) break;
  }
  return epoch;
};

interface IcsProperty {
  name: string;
  params: string;
  value: string;
}

const ics_properties = (vevent: string): IcsProperty[] =>
  vevent
    // A long line is folded with a newline and one space or tab; unfolded, it is one line again.
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/)
    .map(line => {
      const colon = line.indexOf(":");
      if (colon < 0) return null;
      const left = line.slice(0, colon);
      const semicolon = left.indexOf(";");
      return {
        name: (semicolon < 0 ? left : left.slice(0, semicolon)).trim().toUpperCase(),
        params: semicolon < 0 ? "" : left.slice(semicolon + 1),
        value: line.slice(colon + 1),
      };
    })
    .filter((property): property is IcsProperty => property !== null);

const ics_time = (property: IcsProperty): number | null => {
  if (/VALUE=DATE(;|$)/i.test(property.params)) {
    const date = /^(\d{4})(\d{2})(\d{2})$/.exec(property.value.trim());
    return date === null
      ? null
      : new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3])).getTime();
  }

  const at = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(property.value.trim());
  if (at === null) return null;
  const [, y, mo, d, h, mi, s] = at;
  const parts = [y, mo, d, h, mi, s].map(Number);

  // Z is UTC, and the only form that means the same thing everywhere.
  if (at[7] === "Z") return Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);

  // A TZID says which wall clock the time belongs to; without one it is a floating time, which
  // is the reader's own clock.
  const tzid = /(?:^|;)TZID=([^;]+)/i.exec(property.params)?.[1];
  const zone = tzid === undefined ? null : zone_name(tzid);
  if (zone !== null) {
    return wall_time_in_zone(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], zone);
  }
  return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).getTime();
};

/**
 * The fields of the first VEVENT in an .ics file: the part that is an entry here.
 *
 * DTSTART and DTEND are both read, so an all-day event (VALUE=DATE) keeps the reader's own
 * midnights. A file with no VEVENT, or with nothing this app can use, answers an empty object
 * and the caller falls back to the sharing app's text.
 */
export const parse_ics = (text: string): SharedEvent => {
  const begin = text.search(/BEGIN:VEVENT/i);
  if (begin < 0) return {};
  const end = text.indexOf("END:VEVENT", begin);
  const properties = ics_properties(text.slice(begin, end < 0 ? undefined : end));

  const first = (name: string): IcsProperty | undefined =>
    properties.find(property => property.name === name);
  const summary = first("SUMMARY");
  const description = first("DESCRIPTION");
  const location = first("LOCATION");
  const dtstart = first("DTSTART");
  const dtend = first("DTEND");

  const start_time = dtstart === undefined ? null : ics_time(dtstart);
  const end_time = dtend === undefined ? null : ics_time(dtend);

  const event: SharedEvent = {};
  if (summary !== undefined && summary.value.trim() !== "") {
    event.description = unescape_ics(summary.value.trim());
  }
  if (description !== undefined && description.value.trim() !== "") {
    event.memo_text = unescape_ics(description.value.trim());
  }
  if (location !== undefined && location.value.trim() !== "") {
    event.location = unescape_ics(location.value.trim());
  }
  if (start_time !== null) event.start_time = start_time;
  if (end_time !== null && (start_time === null || end_time > start_time)) {
    event.end_time = end_time;
  }
  return event;
};

/// A calendar file's fields, with the sharing app's own words for anything the file leaves out.
const merge_event = (event: SharedEvent, shared: SharedContent): SharedEvent => {
  const description = event.description ?? first_line(shared.title) ?? first_line(shared.text);
  const notes = [
    ...new Set(
      [event.memo_text, shared.text]
        .filter((part): part is string => typeof part === "string" && part.trim() !== "")
        .map(part => part.trim())
    ),
  ].filter(part => part !== description);

  const result: SharedEvent = {};
  if (description !== undefined) result.description = description;
  if (notes.length > 0) result.memo_text = notes.join("\n\n");
  if (event.start_time !== undefined) result.start_time = event.start_time;
  if (event.end_time !== undefined) result.end_time = event.end_time;
  if (event.location !== undefined) result.location = event.location;
  return result;
};

/**
 * What the share means. A calendar file says the most, then a calendar link — both can say
 * when — and anything they leave out comes from the sharing app's own words.
 */
export const parse_shared_event = (shared: SharedContent): SharedEvent => {
  if (shared.ics) {
    const event = parse_ics(shared.ics);
    if (
      event.description !== undefined ||
      event.start_time !== undefined ||
      event.memo_text !== undefined
    ) {
      return merge_event(event, shared);
    }
  }

  const candidates = [
    ...(shared.url === null ? [] : [shared.url]),
    ...(shared.text === null ? [] : shared.text.match(URL_IN_TEXT) ?? []),
  ];

  for (const candidate of candidates) {
    const event = google_event(candidate);
    if (event === null) continue;

    // The link is where the event came from, not part of it: it is taken out of the text before
    // what is left is kept as notes.
    const text = shared.text === null ? "" : shared.text.split(candidate).join("").trim();
    const description = event.description ?? first_line(shared.title) ?? first_line(text);
    const notes = [
      ...new Set(
        [event.memo_text, text]
          .filter((part): part is string => part !== undefined && part.trim() !== "")
          .map(part => part.trim())
      ),
    ].filter(part => part !== description);

    const result: SharedEvent = {
      start_time: event.start_time as number,
      end_time: event.end_time as number,
    };
    if (description !== undefined) result.description = description;
    if (notes.length > 0) result.memo_text = notes.join("\n\n");
    if (event.location !== undefined) result.location = event.location;
    return result;
  }

  return from_text(shared);
};

/**
 * What the service worker saved from a share target POST, taken away as it is read.
 *
 * The system sends the POST to the worker, never to the page: the worker keeps the body — file
 * and all — here, then redirects to the calendar, which reads it once. A reload finds nothing
 * left, so a share cannot turn into two entries.
 */
export const read_shared_inbox = async (): Promise<SharedContent | null> => {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open("organizator-share");
    const saved = await cache.match("/share-target/inbox");
    if (!saved) return null;
    await cache.delete("/share-target/inbox");
    const stored = (await saved.json()) as Partial<SharedContent>;
    return {
      title: typeof stored.title === "string" ? stored.title : null,
      text: typeof stored.text === "string" ? stored.text : null,
      url: typeof stored.url === "string" ? stored.url : null,
      ics: typeof stored.ics === "string" ? stored.ics : null,
    };
  } catch {
    // A worker that wrote something unreadable leaves no share to take; the calendar opens as
    // usual rather than failing on it.
    return null;
  }
};
