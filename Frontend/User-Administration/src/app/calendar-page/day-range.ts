/** The stretch a search asks for, in epoch milliseconds. Either end may be left out. */
export interface DayRange {
  from?: number;
  until?: number;
}

/**
 * The local midnight a `yyyy-mm-dd` date field stands for, or null when it is empty or
 * unreadable — which for a date field means empty, since the browser will not hand back a
 * value it cannot parse.
 *
 * Built from the parts rather than passed to `new Date(value)`. That shorter form is read as
 * **UTC** midnight, so in Bucharest a search from the 5th would begin at 03:00 on the 5th and
 * quietly lose the first three hours of the day somebody asked for. The same reason the entry
 * form builds its own field values from the local getters.
 */
export function dayStart(value: string): number | null {
  const parts = value.split('-');
  if (parts.length !== 3) return null;

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const at = new Date(year, month - 1, day);
  // A day that is not on the calendar rolls over to the next month as `new Date` builds it, so
  // the 31st of February would silently become the 3rd of March. A date field cannot produce
  // one, but searching a different day than the one typed is worse than searching none.
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day) return null;

  return at.getTime();
}

/**
 * Midnight at the *end* of the day a date field names — which is midnight the following
 * morning, because the range the server takes is half-open. A search that ends on the 5th has
 * to include the 5th.
 */
export function dayEnd(value: string): number | null {
  const start = dayStart(value);
  if (start === null) return null;

  // Through the date rather than by adding a day's worth of milliseconds: the day after a
  // daylight-saving change is not 24 hours long, and setDate handles that.
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}
