import { describe, it, expect } from "vitest";
import { day_end, day_start, start_of_day, whole_days_between } from "@dom/day_range.js";

// The two date fields turned into the epoch milliseconds the server takes. Everything here is about
// the reader's own clock: a search for "the 5th" means the 5th where they are sitting.
describe("the stretch a search asks for", () => {
  it("should read a date field as local midnight, not as UTC midnight", () => {
    const start = day_start("2026-03-05");
    const local = new Date(start!);
    expect(local.getFullYear()).to.equal(2026);
    expect(local.getMonth()).to.equal(2);
    expect(local.getDate()).to.equal(5);
    expect(local.getHours()).to.equal(0);
    // The shorter form is read as UTC, which in Bucharest loses the first hours of the day asked
    // for; this is the difference that says the parts are used instead.
    expect(start).to.equal(new Date(2026, 2, 5).getTime());
  });

  it("should end the day the field names, because the range is half open", () => {
    const end = day_end("2026-03-05");
    expect(end).to.equal(new Date(2026, 2, 6).getTime());
  });

  it("should answer nothing for an empty field", () => {
    expect(day_start("")).to.be.null;
    expect(day_end("")).to.be.null;
  });

  it("should refuse a day that is not on the calendar", () => {
    // `new Date` rolls the 31st of February into March, and searching a different day than the one
    // typed is worse than searching none.
    expect(day_start("2026-02-31")).to.be.null;
    expect(day_start("2026-13-01")).to.be.null;
  });

  it("should count a daylight-saving day as one day", () => {
    const first = start_of_day(new Date(2026, 2, 28, 12, 0));
    const next = start_of_day(new Date(2026, 2, 29, 12, 0));
    // Twenty-three hours in Bucharest, and still one day.
    expect(whole_days_between(first, next)).to.equal(1);
  });

  it("should count days backwards as negative, which is how a finished entry is spotted", () => {
    const today = start_of_day(new Date(2026, 5, 10));
    const before = start_of_day(new Date(2026, 5, 7));
    expect(whole_days_between(today, before)).to.equal(-3);
  });
});
