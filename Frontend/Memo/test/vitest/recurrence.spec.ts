import { describe, it, expect } from "vitest";
import { repeated_times } from "@dom/recurrence.js";

// The times an entry is copied to. Local constructors on both sides of every expectation: what
// matters is the wall clock the reader sees, not an absolute number of milliseconds.
const local = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month - 1, day, hour, minute).getTime();

describe("the times of an entry's copies", () => {
  it("should make one copy per day, at the same time of day", () => {
    expect(repeated_times(local(2026, 3, 5, 10, 0), local(2026, 3, 5, 11, 30), 2, "day"))
      .to.deep.equal([
        { start_time: local(2026, 3, 6, 10, 0), end_time: local(2026, 3, 6, 11, 30) },
        { start_time: local(2026, 3, 7, 10, 0), end_time: local(2026, 3, 7, 11, 30) },
      ]);
  });

  it("should space weekly and two-weekly copies by one and two weeks", () => {
    const start = local(2026, 3, 5, 9, 0);
    const end = local(2026, 3, 5, 10, 0);

    expect(repeated_times(start, end, 2, "week").map(at => at.start_time)).to.deep.equal([
      local(2026, 3, 12, 9, 0),
      local(2026, 3, 19, 9, 0),
    ]);
    expect(repeated_times(start, end, 2, "biweekly").map(at => at.start_time)).to.deep.equal([
      local(2026, 3, 19, 9, 0),
      local(2026, 4, 2, 9, 0),
    ]);
  });

  it("should keep the day of the month where it exists and use the last day where it does not", () => {
    // Each copy is counted from the original, so February is the 28th and March is the 31st
    // again — not a series that drifts earlier every month.
    const times = repeated_times(local(2026, 1, 31, 9, 0), local(2026, 1, 31, 10, 0), 3, "month");

    expect(times.map(at => at.start_time)).to.deep.equal([
      local(2026, 2, 28, 9, 0),
      local(2026, 3, 31, 9, 0),
      local(2026, 4, 30, 9, 0),
    ]);
    expect(times.map(at => at.end_time)).to.deep.equal([
      local(2026, 2, 28, 10, 0),
      local(2026, 3, 31, 10, 0),
      local(2026, 4, 30, 10, 0),
    ]);
  });

  it("should carry a monthly copy across the end of the year", () => {
    const times = repeated_times(local(2026, 12, 15, 9, 0), local(2026, 12, 15, 10, 0), 2, "month");

    expect(times[1].start_time).to.equal(local(2027, 2, 15, 9, 0));
  });

  it("should keep the time of day across a daylight-saving change", () => {
    // The day the clocks go forward in the EU, 2026: a copy at 10:00 is at 10:00, not 11:00.
    const start = local(2026, 3, 28, 10, 0);
    const copy = new Date(repeated_times(start, start + 3_600_000, 1, "day")[0].start_time);

    expect([copy.getHours(), copy.getMinutes()]).to.deep.equal([10, 0]);
  });

  it("should make nothing when it is asked for no copies", () => {
    expect(repeated_times(local(2026, 3, 5, 9, 0), local(2026, 3, 5, 10, 0), 0, "day"))
      .to.deep.equal([]);
  });
});
