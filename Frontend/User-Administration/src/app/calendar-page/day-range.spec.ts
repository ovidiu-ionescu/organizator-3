import { dayEnd, dayStart } from './day-range';

/** A date field's value, as local midnight, whichever zone this runs in. */
function localMidnight(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day).getTime();
}

describe('dayStart', () => {
  it('reads a date field as midnight where the reader is', () => {
    expect(dayStart('2026-06-27')).toBe(localMidnight(2026, 6, 27));
  });

  it('does not read it as UTC midnight', () => {
    // The trap: `new Date('2026-06-27')` is midnight UTC, which in Bucharest is 03:00 on the
    // 27th — so the first three hours of the day somebody asked for would be missing.
    expect(dayStart('2026-06-27')).not.toBe(Date.parse('2026-06-27'));
  });

  it('takes an empty field as no date at all', () => {
    expect(dayStart('')).toBeNull();
  });

  it('refuses a day that is not on the calendar', () => {
    // Reading it as the 3rd of March would search a day nobody asked about.
    expect(dayStart('2026-02-31')).toBeNull();
    expect(dayStart('2026-13-01')).toBeNull();
  });

  it('refuses something that is not a date', () => {
    expect(dayStart('tomorrow')).toBeNull();
    expect(dayStart('2026-06')).toBeNull();
  });
});

describe('dayEnd', () => {
  it('is midnight the next morning, so the day it names is included', () => {
    // Half-open: a range ending on the 27th runs up to, but not including, midnight on the 28th.
    expect(dayEnd('2026-06-27')).toBe(localMidnight(2026, 6, 28));
  });

  it('rolls over the end of a month and the end of a year', () => {
    expect(dayEnd('2026-06-30')).toBe(localMidnight(2026, 7, 1));
    expect(dayEnd('2026-12-31')).toBe(localMidnight(2027, 1, 1));
  });

  it('takes an empty field as no date at all', () => {
    expect(dayEnd('')).toBeNull();
  });
});
