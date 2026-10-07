/** A point on the earth, latitude first — the order the pair is written in. */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * A pair of coordinates as somebody copies them off a map.
 *
 * Google Maps hands you `44.4268, 26.1025` when you right-click a point and copy it, and that is
 * the gesture this is for; a space instead of the comma is accepted too, and so is a leading
 * minus for the south and the west.
 *
 * Anything else is null. It deliberately does not read the degrees-minutes-seconds form: half
 * reading it would be worse than not reading it, because `44°25'36.5"N` quietly becoming
 * 44.425365 would put the pin in another country and say nothing.
 *
 * The range is checked so that a swapped pair or a mistyped digit is refused here rather than
 * pinned somewhere the visitor did not mean. It cannot catch a clean swap — 26.1 and 44.4 are
 * each valid on their own — but it catches the rest.
 */
export function parseCoordinates(text: string): Coordinates | null {
  const parts = text.split(/[,\s]+/).filter(part => part !== '');
  if (parts.length !== 2) return null;

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  return { latitude, longitude };
}

/** The pair as it is shown: five decimals is about a metre, and further digits are noise. */
export function formatCoordinates(at: Coordinates): string {
  return `${at.latitude.toFixed(5)}, ${at.longitude.toFixed(5)}`;
}

/**
 * Where to send somebody to see the point.
 *
 * A plain Google Maps URL, which needs no API key and no script in the page: looking at a
 * location is opening a link, and an *embedded* Google map is a different thing that does need
 * a key and a billing account. The values are numbers that have been through the range check,
 * so there is nothing here to escape.
 */
export function mapUrl(at: Coordinates): string {
  return `https://www.google.com/maps?q=${at.latitude},${at.longitude}`;
}
