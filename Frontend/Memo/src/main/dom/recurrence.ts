/**
 * @prettier
 *
 * The times of an entry's copies, one per interval.
 *
 * The arithmetic goes through Date's local setters rather than through milliseconds: a copy is
 * the same time of day on another day, not the same number of milliseconds later. Adding
 * 86_400_000 to a 10:00 entry the day the clocks go forward gives 11:00; `setDate` gives 10:00,
 * which is what the reader means by "tomorrow at ten". For the same reason a monthly copy of a
 * 31st lands on the last day of a shorter month instead of rolling into the next one.
 */

export type RepeatUnit = "day" | "week" | "biweekly" | "month";

export interface RepeatedTimes {
  start_time: number;
  end_time: number;
}

const DAYS_PER: Record<Exclude<RepeatUnit, "month">, number> = {
  day: 1,
  week: 7,
  biweekly: 14,
};

const shift_days = (ms: number, days: number): number => {
  const at = new Date(ms);
  at.setDate(at.getDate() + days);
  return at.getTime();
};

/**
 * The same day of the month in a later month, or the last day of that month when the day does
 * not exist there: 31 January plus a month is 28 February (29 in a leap year), never 3 March.
 *
 * Each copy is counted from the original, not from the copy before it, so a 31 January series
 * has its February copy on the 28th and its March copy back on the 31st.
 */
const shift_months = (ms: number, months: number): number => {
  const at = new Date(ms);
  const day = at.getDate();
  // The first of the month before moving it: setting the month while the day is 31 rolls over
  // into the following month, which is the thing being avoided.
  at.setDate(1);
  at.setMonth(at.getMonth() + months);
  const last_day = new Date(at.getFullYear(), at.getMonth() + 1, 0).getDate();
  at.setDate(Math.min(day, last_day));
  return at.getTime();
};

/**
 * `count` copies, the first one interval after the original. `count` 2 with `week` is the next
 * two weeks — the original is not one of them.
 */
export const repeated_times = (
  start_time: number,
  end_time: number,
  count: number,
  unit: RepeatUnit
): RepeatedTimes[] => {
  if (!Number.isFinite(count) || count < 1) return [];

  const times: RepeatedTimes[] = [];
  for (let copy = 1; copy <= count; copy++) {
    if (unit === "month") {
      times.push({
        start_time: shift_months(start_time, copy),
        end_time: shift_months(end_time, copy),
      });
    } else {
      const days = DAYS_PER[unit] * copy;
      times.push({
        start_time: shift_days(start_time, days),
        end_time: shift_days(end_time, days),
      });
    }
  }
  return times;
};
