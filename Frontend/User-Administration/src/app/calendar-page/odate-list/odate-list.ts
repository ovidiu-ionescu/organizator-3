import { Component, inject, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Markdown } from '../../markdown';
import { Odate } from '../../odate-api';
import { Coordinates, mapUrl } from '../coordinates';

/**
 * The caller's upcoming entries, soonest first.
 *
 * An entry that is happening right now carries a marker rather than being sorted separately: the
 * server puts it at the front by ordering on start_time, and the screen only has to say which
 * ones they are. The marker is a word, not a colour alone, so it survives being read aloud.
 */
@Component({
  selector: 'app-odate-list',
  imports: [DatePipe],
  templateUrl: './odate-list.html',
  styleUrl: './odate-list.css',
})
export class OdateList {
  private markdown = inject(Markdown);

  odates = input.required<Odate[]>();
  /**
   * What the list is, and what it says when it is empty. The page decides both: the list holds
   * entries from the past as soon as a search asks for them, and "coming up" underneath a
   * search of last March would be plainly untrue.
   */
  heading = input('Coming up');
  emptyText = input('Nothing coming up. Add an entry above.');
  loading = input(false);
  /** Raised with the entry to change; the page hands it to the form. */
  edit = output<Odate>();

  readonly mapUrl = mapUrl;

  /**
   * Where the entry is, as a point, or null when it has no location or that location has not
   * been put on the earth.
   *
   * Both coordinates are asked for by name rather than by truth: `0` is a perfectly good
   * latitude — the equator — and a location on it is one somebody meant. They are checked
   * against undefined as well as null because the app can be served by a backend older than
   * these two fields.
   */
  coordinatesOf(entry: Odate): Coordinates | null {
    const place = entry.location;
    if (place === null) return null;
    if (place.latitude === null || place.latitude === undefined) return null;
    if (place.longitude === null || place.longitude === undefined) return null;

    return { latitude: place.latitude, longitude: place.longitude };
  }

  /**
   * A note as HTML, or null while the renderer is loading — the note is shown as it was written
   * until then. The renderer keeps what it has already produced, so asking on every change
   * detection costs nothing after the first time.
   */
  noteHtml(note: string): string | null {
    return this.markdown.render(note);
  }

  /**
   * How soon the entry is, which is what the line beside it is coloured by. One answer, never
   * two, and the names are the classes the template puts on the row: `'happening'`, `'today'`,
   * `'week'` for the seven days after today — or null, both for anything further off and for one
   * that is already over.
   *
   * The first of those is the server's `ongoing` flag and the rest are worked out from this
   * browser's clock. That split is deliberate: which entries are in the list at all is the
   * server's decision — a clock that was wrong there would hide an entry — while the date
   * printed beside each entry goes through this browser's clock, so the day it falls on has to
   * be read the same way. A server in another timezone would otherwise colour a line orange
   * beside a date reading tomorrow, for the hours around midnight.
   */
  howSoon(entry: Odate): 'happening' | 'today' | 'week' | null {
    // It has begun and not finished, so whatever day it started, it is what is going on.
    if (entry.ongoing) return 'happening';

    const days = wholeDaysBetween(startOfDay(new Date()), startOfDay(new Date(entry.start_time)));
    // Behind us and not running: it is over, and it is nothing of today's or this week's
    // business. That used to be unreachable — the plain list stops at now — and a search for a
    // stretch of the past is what makes it ordinary.
    if (days < 0) return null;
    if (days === 0) return 'today';
    if (days <= 7) return 'week';
    return null;
  }
  /**
   * True once reading the list has failed. The empty message has to keep quiet then: "nothing
   * coming up" under "could not read your calendar" says the calendar is empty when the request
   * merely failed.
   */
  failed = input(false);
}

/**
 * The midnight `at` falls after, in this browser's zone, as epoch milliseconds — built from the
 * local getters for the reason the form's `toLocalInput` is: `toISOString` answers in UTC and
 * would move the boundary by the offset without saying so.
 */
function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/**
 * Whole days from one midnight to another. Rounded, not floored: a day that a daylight-saving
 * change makes 23 or 25 hours long is still one day, and dividing by 24 hours gives 0.96 or 1.04.
 */
function wholeDaysBetween(from: number, to: number): number {
  return Math.round((to - from) / 86_400_000);
}
