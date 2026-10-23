import { describe, it, expect } from "vitest";
import { parse_ics, parse_shared_event } from "@dom/shared_event.js";

/// A minimal .ics file around one VEVENT's properties.
const ics = (properties: string) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", properties, "END:VEVENT", "END:VCALENDAR"].join(
    "\r\n"
  );

// What another app hands over when its event is shared into this one. The Google Calendar
// template link is the only part that can say when the event is; everything else is text.
describe("an event shared into the app", () => {
  it("should read a Google Calendar template link, with the sharing app's own words", () => {
    const event = parse_shared_event({
      title: "Dentist",
      text: "Bring the card",
      url:
        "https://calendar.google.com/calendar/render?action=TEMPLATE" +
        "&text=Dentist+visit&dates=20261028T080000Z/20261028T090000Z" +
        "&details=Bring+the+card&location=Office",
    });

    expect(event).to.deep.equal({
      description: "Dentist visit",
      memo_text: "Bring the card",
      start_time: Date.UTC(2026, 9, 28, 8, 0),
      end_time: Date.UTC(2026, 9, 28, 9, 0),
      location: "Office",
    });
  });

  it("should find the calendar link inside the shared text too", () => {
    const event = parse_shared_event({
      title: null,
      text:
        "Dentist\nhttps://calendar.google.com/calendar/render?action=TEMPLATE" +
        "&text=Dentist&dates=20261028T080000Z/20261028T090000Z",
      url: null,
    });

    expect(event).to.deep.equal({
      description: "Dentist",
      start_time: Date.UTC(2026, 9, 28, 8, 0),
      end_time: Date.UTC(2026, 9, 28, 9, 0),
    });
  });

  it("should read an all-day link as the reader's own days", () => {
    const event = parse_shared_event({
      title: null,
      text: null,
      url:
        "https://calendar.google.com/calendar/render?action=TEMPLATE" +
        "&text=Holiday&dates=20261028/20261029",
    });

    // Local midnights: the day the reader sees beside the entry is the day the link names.
    expect(event.start_time).to.equal(new Date(2026, 9, 28).getTime());
    expect(event.end_time).to.equal(new Date(2026, 9, 29).getTime());
    expect(event.description).to.equal("Holiday");
  });

  it("should take the shared title when the link carries none, and keep the link without dates", () => {
    const event = parse_shared_event({
      title: "Dentist",
      text: "Bring the card",
      url:
        "https://calendar.google.com/calendar/render?action=TEMPLATE" +
        "&dates=20261028T080000Z/20261028T090000Z",
    });
    expect(event.description).to.equal("Dentist");
    expect(event.memo_text).to.equal("Bring the card");
    expect(event.start_time).to.equal(Date.UTC(2026, 9, 28, 8, 0));

    // A link with no dates says nothing usable about time; it stays a link in the notes.
    const undated = parse_shared_event({
      title: "Event page",
      text: null,
      url: "https://example.com/event/42",
    });
    expect(undated).to.deep.equal({
      description: "Event page",
      memo_text: "https://example.com/event/42",
    });
  });

  it("should make an entry from a title and text alone, with no time invented", () => {
    expect(parse_shared_event({ title: "Dentist", text: "Bring the card", url: null })).to.deep.equal({
      description: "Dentist",
      memo_text: "Bring the card",
    });
    expect(parse_shared_event({ title: null, text: "Dentist\nBring the card", url: null })).to.deep.equal({
      description: "Dentist",
      memo_text: "Bring the card",
    });
    // A shared link with nothing else is still something to keep.
    expect(parse_shared_event({ title: null, text: null, url: "https://example.com/event" }))
      .to.deep.equal({ memo_text: "https://example.com/event" });
  });

  it("should read an .ics file's event, escaping and all", () => {
    const event = parse_shared_event({
      title: null,
      text: null,
      url: null,
      ics: ics(
        [
          "SUMMARY:Team\\, sync",
          "DTSTART:20261028T080000Z",
          "DTEND:20261028T090000Z",
          "LOCATION:Office",
          "DESCRIPTION:Line one\\nLine two",
        ].join("\r\n")
      ),
    });

    expect(event).to.deep.equal({
      description: "Team, sync",
      memo_text: "Line one\nLine two",
      start_time: Date.UTC(2026, 9, 28, 8, 0),
      end_time: Date.UTC(2026, 9, 28, 9, 0),
      location: "Office",
    });
  });

  it("should read a TZID time in its own zone, summer and winter", () => {
    // Bucharest is UTC+3 in July and UTC+2 at the end of October.
    const summer = parse_ics(
      ics(
        [
          "SUMMARY:Standup",
          "DTSTART;TZID=Europe/Bucharest:20260715T100000",
          "DTEND;TZID=Europe/Bucharest:20260715T110000",
        ].join("\r\n")
      )
    );
    expect(summer.start_time).to.equal(Date.UTC(2026, 6, 15, 7, 0));
    expect(summer.end_time).to.equal(Date.UTC(2026, 6, 15, 8, 0));

    const winter = parse_ics(
      ics(
        [
          "SUMMARY:Standup",
          "DTSTART;TZID=Europe/Bucharest:20261028T100000",
          "DTEND;TZID=Europe/Bucharest:20261028T110000",
        ].join("\r\n")
      )
    );
    expect(winter.start_time).to.equal(Date.UTC(2026, 9, 28, 8, 0));
    expect(winter.end_time).to.equal(Date.UTC(2026, 9, 28, 9, 0));
  });

  it("should read an all-day event as the reader's own days", () => {
    const event = parse_ics(
      ics(["SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261028", "DTEND;VALUE=DATE:20261029"].join("\r\n"))
    );

    expect(event.start_time).to.equal(new Date(2026, 9, 28).getTime());
    expect(event.end_time).to.equal(new Date(2026, 9, 29).getTime());
  });

  it("should unfold a long line and take the sharing app's words alongside the file", () => {
    const event = parse_shared_event({
      title: "Ignored title",
      text: "Bring the card",
      url: null,
      ics: ics(
        [
          "SUMMARY:Dentist",
          "DTSTART:20261028T080000Z",
          "DTEND:20261028T090000Z",
          "DESCRIPTION:A very long",
          "  description",
        ].join("\r\n")
      ),
    });

    expect(event.description).to.equal("Dentist");
    expect(event.memo_text).to.equal("A very long description\n\nBring the card");
  });

  it("should fall back to the shared text when the file has no event in it", () => {
    const event = parse_shared_event({
      title: "Dentist",
      text: "Bring the card",
      url: null,
      ics: "not a calendar at all",
    });

    expect(event).to.deep.equal({ description: "Dentist", memo_text: "Bring the card" });
  });

  it("should say nothing when nothing was shared", () => {
    expect(parse_shared_event({ title: null, text: null, url: null })).to.deep.equal({});
  });
});
