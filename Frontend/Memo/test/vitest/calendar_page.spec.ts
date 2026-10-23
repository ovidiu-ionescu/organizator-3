import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import "@dom/calendar-page.js";
import type { NewOdate, Odate, OdateLocation, OdateType } from "@dom/odate_api.js";

// The calendar page: what it reads on arrival, what it does with the answers, and which read each
// write is followed by. The server is a stub; the shape of its answers is what is under test.
const requester = { id: 1, name: "alice" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const at = (days_from_today: number, hour: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days_from_today, hour, 0).getTime();
};

/// What a datetime-local field holds for a moment, built the way the form builds it.
const local_input = (ms: number) => {
  const when = new Date(ms);
  const two = (value: number) => `${value}`.padStart(2, "0");
  return `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}T${two(when.getHours())}:${two(when.getMinutes())}`;
};

const entry = (over: Partial<Odate> = {}): Odate => ({
  id: 1,
  start_time: at(1, 10),
  end_time: at(1, 11),
  ongoing: false,
  description: "Dentist",
  memo_text: null,
  location: null,
  type: null,
  ...over,
});

const office: OdateLocation = {
  id: 3,
  name: "Office",
  latitude: null,
  longitude: null,
  timezone: null,
  last_used: null,
};

interface Answer {
  odates?: Odate[];
  locations?: OdateLocation[];
  types?: OdateType[];
}

/// Every call the page makes, in order, and the answers it is given.
const server = (answers: Answer) => {
  const seen: {method: string; url: string; body: string | undefined}[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    seen.push({method, url: String(url), body: (init?.body as string) ?? undefined});
    const path = String(url).replace(/^.*\/organizator/, "").split("?")[0];

    if (method === "GET" && path === "/odates") {
      const params = new URL(String(url), "http://x").searchParams;
      const from = params.get("from");
      const q = params.get("q");
      // The server's rule: with no from, a text search covers the whole calendar and the plain
      // list covers what is coming up.
      const start = from === null ? (q === null ? Date.now() : 0) : Number(from);
      const rooms = answers.odates ?? [];
      const in_range = rooms.filter(o => o.end_time > start);
      // The real one is full-text; matching whole words is enough for the shape of the answer.
      const matched = q === null
        ? in_range
        : in_range.filter(o =>
            `${o.description ?? ""} ${o.memo_text ?? ""}`.toLowerCase()
              .split(/\s+/)
              .includes(q.toLowerCase())
          );
      return json({odates: matched, requester});
    }
    if (method === "GET" && path === "/locations") return json({locations: answers.locations ?? [], requester});
    if (method === "GET" && path === "/odate_types") return json({odate_types: answers.types ?? [], requester});
    if (method === "POST" && path === "/odates") return json(entry({id: 99, description: "Dentist"}), 201);
    if (method === "PUT" && path === "/locations/3") return json({...office, name: "Office (new)"});
    return json({id: 1}, 200);
  });
  return seen;
};

describe("the calendar page", () => {
  let page: HTMLElement;
  let shadow: ShadowRoot;

  const list = () => shadow.querySelector("calendar-list")!.shadowRoot!;
  const rows = () => [...list().querySelectorAll("li")];
  const status = () => shadow.querySelector("#status")!.textContent ?? "";
  const panel = (id: string) => shadow.querySelector(id)!.shadowRoot!;

  const loaded = async () => {
    await vi.waitFor(() => expect(rows().length).to.be.greaterThan(0));
  };

  /// Built after the server is stubbed, never before: the page reads the three lists as it is
  /// constructed, and a page built first would read them from the real network and spend the test
  /// showing the failure line.
  const mount = () => {
    document.body.innerHTML = "<calendar-page></calendar-page>";
    page = document.querySelector("calendar-page")!;
    shadow = page.shadowRoot!;
  };

  beforeEach(async () => {
    document.body.innerHTML = "";
    // A test that shares an event into the page writes the URL; the next one starts without it.
    history.replaceState(null, "", "/");
    if (typeof caches !== "undefined") await caches.delete("organizator-share");
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
    if (typeof caches !== "undefined") await caches.delete("organizator-share");
  });

  it("should read the entries, the locations and the date types on arrival", async () => {
    const seen = server({odates: [entry()], locations: [office], types: [{id: 4, name: "Meeting"}]});
    mount();

    await loaded();
    const paths = seen.map(call => `${call.method} ${call.url.replace(/^.*\/organizator/, "").split("?")[0]}`);
    expect(paths).to.include.members(["GET /odates", "GET /locations", "GET /odate_types"]);
  });

  it("should start an entry from an event shared to the app", async () => {
    // What the Android share sheet puts in the URL: the sharing app's title and text, and the
    // calendar link it shared, which is the part that knows when the event is.
    const shared = new URLSearchParams({
      title: "Dentist",
      text: "Bring the card",
      url:
        "https://calendar.google.com/calendar/render?action=TEMPLATE" +
        "&text=Dentist&dates=20261028T080000Z/20261028T090000Z&location=Office",
    });
    history.replaceState(null, "", `/calendar?${shared}`);
    server({ odates: [], locations: [office], types: [] });
    mount();

    const form = shadow.querySelector("odate-form")!.shadowRoot!;
    await vi.waitFor(() =>
      expect(form.querySelector("#entry_form")!.classList.contains("hidden")).to.equal(false)
    );
    expect(form.querySelector<HTMLInputElement>("#what")!.value).to.equal("Dentist");
    expect(form.querySelector<HTMLTextAreaElement>("#notes")!.value).to.equal("Bring the card");
    // The share's place is one of the reader's own, so the control is set to it.
    expect(form.querySelector<HTMLSelectElement>("#where")!.value).to.equal("3");
    expect(form.querySelector<HTMLInputElement>("#start")!.value).to.equal(
      local_input(Date.UTC(2026, 9, 28, 8, 0))
    );
    expect(form.querySelector<HTMLInputElement>("#end")!.value).to.equal(
      local_input(Date.UTC(2026, 9, 28, 9, 0))
    );
    expect(status()).to.contain("From the shared event");
  });

  it("should start an entry from an .ics file shared to the app", async () => {
    const file = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "SUMMARY:Dentist",
      "DTSTART:20261028T080000Z",
      "DTEND:20261028T090000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    // What share-target.js leaves behind before redirecting to the calendar: the POST body
    // itself never reaches the page.
    const cache = await caches.open("organizator-share");
    await cache.put(
      "/share-target/inbox",
      new Response(JSON.stringify({title: null, text: null, url: null, ics: file}), {
        headers: {"Content-Type": "application/json"},
      })
    );
    history.replaceState(null, "", "/calendar?share-target=1");
    server({ odates: [], locations: [office], types: [] });
    mount();

    const form = shadow.querySelector("odate-form")!.shadowRoot!;
    await vi.waitFor(() =>
      expect(form.querySelector("#entry_form")!.classList.contains("hidden")).to.equal(false)
    );
    expect(form.querySelector<HTMLInputElement>("#what")!.value).to.equal("Dentist");
    expect(form.querySelector<HTMLInputElement>("#start")!.value).to.equal(
      local_input(Date.UTC(2026, 9, 28, 8, 0))
    );
    expect(form.querySelector<HTMLInputElement>("#end")!.value).to.equal(
      local_input(Date.UTC(2026, 9, 28, 9, 0))
    );
    // Read once: a reload cannot make the same event a second time.
    expect(await (await caches.open("organizator-share")).match("/share-target/inbox")).to.not.exist;
  });

  it("should colour an entry by how soon it is, and mark the one happening now", async () => {
    // A fixed clock: whether 23:00 is still ahead depends on when the suite runs, and so does the
    // colour of the day's last entry.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 2, 5, 12, 0));
      server({
        odates: [
          entry({id: 1, ongoing: true, description: "Now"}),
          entry({id: 2, start_time: at(0, 23), end_time: at(0, 23) + 3_600_000, description: "Today"}),
          entry({id: 3, start_time: at(3, 9), end_time: at(3, 10), description: "This week"}),
          entry({id: 4, start_time: at(30, 9), end_time: at(30, 10), description: "Later"}),
        ],
      });
      mount();

      await loaded();
      const classes = rows().map(row => row.className);
      expect(classes).to.deep.equal(["happening", "today", "week", ""]);
      // The badge is a word as well as a colour: the red is the second thing said, not the only one.
      expect(rows()[0].textContent).to.contain("Happening now");
    } finally {
      vi.useRealTimers();
    }
  });

  it("should show an entry that was earlier today as today, fading into the past", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 2, 5, 12, 0));
      server({
        odates: [
          entry({id: 1, start_time: at(0, 9), end_time: at(0, 10), description: "This morning"}),
          entry({id: 2, start_time: at(0, 15), end_time: at(0, 16), description: "This afternoon"}),
        ],
      });
      mount();
      // The plain list is what is coming up; the morning is over, so it is found by searching
      // today — which is also where an expired entry from today is shown at all.
      await vi.waitFor(() => expect(rows().length).to.equal(1));
      shadow.querySelector<HTMLInputElement>("#search_from")!.value = "2026-03-05";
      shadow.querySelector<HTMLInputElement>("#search_until")!.value = "2026-03-05";
      shadow.querySelector<HTMLButtonElement>("#search_button")!.click();

      await vi.waitFor(() => expect(rows().length).to.equal(2));
      expect(rows()[0].className).to.equal("was_today");
      expect(rows()[1].className).to.equal("today");
      // A gradient on the line, not the flat today colour.
      expect(getComputedStyle(rows()[0], "::before").backgroundImage).to.contain("linear-gradient");
    } finally {
      vi.useRealTimers();
    }
  });

  it("should say nothing is coming up rather than nothing at all", async () => {
    server({odates: []});
    mount();
    await vi.waitFor(() => expect(list().querySelector("#state")!.textContent).to.contain("Nothing coming up"));
    expect(status()).to.equal("");
  });

  it("should not dress a failed read as an empty calendar", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", {status: 500}));
    mount();

    await vi.waitFor(() => expect(status()).to.contain("Could not read your calendar."));
    // "Nothing coming up" under "could not read your calendar" would say the calendar is empty when
    // the request merely failed.
    expect(list().querySelector("#state")!.textContent).to.equal("");
  });

  it("should add an entry and say so", async () => {
    const seen = server({odates: []});
    mount();
    await vi.waitFor(() => expect(seen.some(c => c.method === "GET")).to.equal(true));

    const form = shadow.querySelector("odate-form")!.shadowRoot!;
    form.querySelector<HTMLButtonElement>("#trigger")!.click();
    form.querySelector<HTMLInputElement>("#start")!.value = "2026-03-05T09:30";
    form.querySelector<HTMLInputElement>("#end")!.value = "2026-03-05T10:30";
    form.querySelector<HTMLInputElement>("#what")!.value = "Dentist";
    form
      .querySelector("form")!
      .dispatchEvent(new Event("submit", {cancelable: true, bubbles: true}));

    await vi.waitFor(() => expect(status()).to.contain("Added “Dentist”."));
    const posts = seen.filter(call => call.method === "POST");
    expect(posts.length).to.equal(1);
    expect(JSON.parse(posts[0].body!)).to.deep.equal({
      start_time: new Date(2026, 2, 5, 9, 30).getTime(),
      end_time: new Date(2026, 2, 5, 10, 30).getTime(),
      description: "Dentist",
    });
    // The form stays open for the next one.
    expect(shadow.querySelector("odate-form")!.shadowRoot!.querySelector("#entry_form")!.classList.contains("hidden")).to.equal(false);
  });

  it("should ask for the range that was given, and call the list by it", async () => {
    const seen = server({odates: []});
    mount();
    await vi.waitFor(() => expect(seen.length).to.be.greaterThan(0));
    seen.length = 0;

    shadow.querySelector<HTMLInputElement>("#search_from")!.value = "2026-03-05";
    shadow.querySelector<HTMLInputElement>("#search_until")!.value = "2026-03-06";
    shadow.querySelector<HTMLButtonElement>("#search_button")!.click();

    await vi.waitFor(() => expect(list().querySelector("h2")!.textContent).to.equal("Between those dates"));
    const asked = new URL(seen[0].url, "http://x").searchParams;
    expect(asked.get("from")).to.equal(`${new Date(2026, 2, 5).getTime()}`);
    // The end of the 6th, because the range the server takes is half open: a search that ends on
    // the 6th has to include the 6th.
    expect(asked.get("until")).to.equal(`${new Date(2026, 2, 7).getTime()}`);
    // Clear is offered once the range is being shown rather than while it is still being read.
    await vi.waitFor(() =>
      expect(shadow.querySelector<HTMLButtonElement>("#clear_button")!.disabled).to.equal(false)
    );
  });

  it("should search the text across the whole calendar", async () => {
    const past = entry({
      id: 2,
      start_time: at(-30, 9),
      end_time: at(-30, 10),
      description: "Dentist visit",
      memo_text: "Bring the card",
    });
    const soon = entry({id: 3, description: "Lunch"});
    const seen = server({odates: [past, soon]});
    mount();
    await loaded();
    // The plain list is what is coming up: only the lunch.
    expect(list().textContent).to.contain("Lunch");
    expect(list().textContent).not.to.contain("Dentist visit");
    seen.length = 0;

    shadow.querySelector<HTMLInputElement>("#search_text")!.value = "dentist";
    shadow.querySelector<HTMLButtonElement>("#search_button")!.click();

    await vi.waitFor(() => expect(list().querySelector("h2")!.textContent).to.equal("Matching “dentist”"));
    // The old list already had a row, so the wait is on what the row says rather than on how
    // many there are.
    await vi.waitFor(() => expect(rows()[0]?.textContent ?? "").to.contain("Dentist visit"));
    expect(rows().length).to.equal(1);
    // A text search on its own covers the whole calendar, so no from is asked for.
    const asked = new URL(seen[0].url, "http://x").searchParams;
    expect(asked.get("q")).to.equal("dentist");
    expect(asked.get("from")).to.be.null;

    // Clearing puts the screen back to what is coming up, text box included.
    shadow.querySelector<HTMLButtonElement>("#clear_button")!.click();
    await vi.waitFor(() => expect(list().querySelector("h2")!.textContent).to.equal("Coming up"));
    expect(shadow.querySelector<HTMLInputElement>("#search_text")!.value).to.equal("");
  });

  it("should read two empty fields as clearing rather than as a search for nothing", async () => {
    const seen = server({odates: [entry()]});
    mount();
    await loaded();

    shadow.querySelector<HTMLInputElement>("#search_from")!.value = "";
    shadow.querySelector<HTMLInputElement>("#search_until")!.value = "";
    shadow.querySelector<HTMLButtonElement>("#search_button")!.click();

    await vi.waitFor(() => expect(list().querySelector("h2")!.textContent).to.equal("Coming up"));
    const last = seen[seen.length - 1];
    expect(last.url).to.not.contain("from=");
    expect(last.url).to.not.contain("until=");
  });

  it("should open the form in the row being changed, not at the top of the page", async () => {
    const seen = server({odates: [entry()], locations: [office], types: [{id: 4, name: "Meeting"}]});
    mount();
    await loaded();

    // Edit on the row, which is how the page hears about it.
    list().querySelector<HTMLButtonElement>("button.edit")!.click();
    await vi.waitFor(() => expect(list().querySelector("li odate-form")).to.exist);

    const in_row = list().querySelector("li odate-form")!.shadowRoot!;
    expect(in_row.querySelector<HTMLInputElement>("#what")!.value).to.equal("Dentist");
    // ...and the form at the top is still the way to add one, closed and empty.
    const top = shadow.querySelector("odate-form")!.shadowRoot!;
    expect(top.querySelector("#entry_form")!.classList.contains("hidden")).to.equal(true);
    expect(top.querySelector<HTMLInputElement>("#what")!.value).to.equal("");

    // Saving it puts the entry back where it was.
    in_row.querySelector<HTMLInputElement>("#what")!.value = "Dentist (moved)";
    in_row
      .querySelector("form")!
      .dispatchEvent(new Event("submit", {cancelable: true, bubbles: true}));

    await vi.waitFor(() => expect(seen.filter(call => call.method === "PUT").length).to.equal(1));
    await vi.waitFor(() => expect(list().querySelector("li odate-form")).to.be.null);
  });

  it("should put the row back when a change is given up", async () => {
    server({odates: [entry()], locations: [office], types: [{id: 4, name: "Meeting"}]});
    mount();
    await loaded();

    list().querySelector<HTMLButtonElement>("button.edit")!.click();
    await vi.waitFor(() => expect(list().querySelector("li odate-form")).to.exist);

    list().querySelector("li odate-form")!.shadowRoot!.querySelector<HTMLButtonElement>("#cancel")!.click();

    // The entry is still in the list, as itself: not gone, and not a closed form in its place.
    await vi.waitFor(() => expect(list().querySelector("li odate-form")).to.be.null);
    expect(list().querySelectorAll("li").length).to.equal(1);
    expect(list().textContent).to.contain("Dentist");
  });

  it("should ask before deleting an entry, and delete only when told yes", async () => {
    let odates = [entry()];
    const seen: { method: string; url: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      seen.push({method, url: String(url)});
      const path = String(url).replace(/^.*\/organizator/, "").split("?")[0];
      if (method === "DELETE" && path === "/odates/1") {
        odates = odates.filter(one => one.id !== 1);
        return new Response(null, {status: 204});
      }
      if (path === "/odates") return json({odates, requester});
      if (path === "/locations") return json({locations: [], requester});
      if (path === "/odate_types") return json({odate_types: [], requester});
      return json({}, 200);
    });
    mount();
    await loaded();

    // Delete asks; it does not delete.
    list().querySelector<HTMLButtonElement>("button.delete")!.click();
    expect(list().textContent).to.contain("Delete “Dentist”?");
    expect(rows().length).to.equal(1);
    expect(seen.some(call => call.method === "DELETE")).to.equal(false);

    // Given up: the row is itself again, still without a request.
    list().querySelector<HTMLButtonElement>("button.cancel")!.click();
    expect(list().textContent).not.to.contain("Delete “Dentist”?");
    expect(seen.some(call => call.method === "DELETE")).to.equal(false);

    // Asked again and confirmed: now it goes, and the list is read again without it.
    list().querySelector<HTMLButtonElement>("button.delete")!.click();
    list().querySelector<HTMLButtonElement>("button.confirm")!.click();

    await vi.waitFor(() => expect(seen.filter(call => call.method === "DELETE").length).to.equal(1));
    await vi.waitFor(() => expect(rows().length).to.equal(0));
    expect(status()).to.contain("Deleted “Dentist”.");
  });

  it("should duplicate an entry by the chosen interval, skipping only copies of it that are there", async () => {
    const base = entry({id: 1, start_time: at(1, 10), end_time: at(1, 11), description: "Dentist"});
    // A copy from an earlier duplication: one week after the base.
    const already = entry({id: 2, start_time: at(8, 10), end_time: at(8, 11), description: "Dentist"});
    // Something else at the second week's slot: same time, a different description. It is not a
    // copy of this entry, so it must not take the slot.
    const other = entry({id: 3, start_time: at(15, 10), end_time: at(15, 11), description: "Lunch"});
    const odates = [base, already, other];
    const posted: NewOdate[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = String(url).replace(/^.*\/organizator/, "").split("?")[0];
      const params = new URL(String(url), "http://x").searchParams;
      if (method === "GET" && path === "/odates") {
        const from = params.get("from");
        const until = params.get("until");
        const start = from === null ? Date.now() : Number(from);
        const end = until === null ? Infinity : Number(until);
        return json({odates: odates.filter(o => o.end_time > start && o.start_time < end), requester});
      }
      if (method === "POST" && path === "/odates") {
        const body = JSON.parse(String(init?.body ?? "{}")) as NewOdate;
        posted.push(body);
        const made = entry({
          id: 100 + posted.length,
          start_time: body.start_time,
          end_time: body.end_time,
          description: body.description ?? null,
        });
        odates.push(made);
        return json(made, 201);
      }
      if (path === "/locations") return json({locations: [], requester});
      if (path === "/odate_types") return json({odate_types: [], requester});
      return json({}, 200);
    });
    mount();
    await loaded();
    expect(rows().length).to.equal(3);

    // Edit the base, which is the earliest of the rows.
    rows()[0].querySelector<HTMLButtonElement>("button.edit:not(.delete)")!.click();
    await vi.waitFor(() => expect(list().querySelector("li odate-form")).to.exist);
    const in_row = list().querySelector("li odate-form")!.shadowRoot!;

    in_row.querySelector<HTMLButtonElement>("#duplicate")!.click();
    in_row.querySelector<HTMLInputElement>("#duplicate_count")!.value = "3";
    in_row.querySelector<HTMLSelectElement>("#duplicate_unit")!.value = "week";
    in_row.querySelector<HTMLButtonElement>("#duplicate_confirm")!.click();

    // Three weeks asked for: the first is already a copy, the second is somebody else's entry
    // about lunch, so the second and third are made.
    await vi.waitFor(() => expect(posted.length).to.equal(2));
    expect(posted.map(one => one.start_time)).to.deep.equal([at(15, 10), at(22, 10)]);
    expect(posted.every(one => one.description === "Dentist")).to.equal(true);

    // The message names the date that was passed over, not just how many there were, and it is
    // under the buttons of the form that asked — not in the page's line at the top.
    const skipped_when = new Intl.DateTimeFormat(undefined, {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(at(8, 10));
    const form_status = in_row.querySelector<HTMLElement>("#form_status")!;
    await vi.waitFor(() =>
      expect(form_status.textContent).to.contain(
        `Added 2 copies of “Dentist”; 1 already existed. The event already existed on ${skipped_when}.`
      )
    );
    expect(status()).to.equal("");
  });

  it("should redraw the entries after a location is renamed, because they carry its name", async () => {
    const seen = server({odates: [entry({location: {id: 3, name: "Office", latitude: null, longitude: null}})], locations: [office]});
    mount();
    await loaded();
    seen.length = 0;

    // Rename it the way the panel does, in the one place the page listens to.
    panel("#locations").querySelector<HTMLButtonElement>("#new_name")!.value = "";
    const rename = new CustomEvent("place-save", {detail: {id: 3, name: "Office (new)", coordinates: null}});
    shadow.querySelector("#locations")!.dispatchEvent(rename);

    await vi.waitFor(() => expect(seen.filter(call => call.method === "PUT").length).to.equal(1));
    await vi.waitFor(() => expect(seen.filter(call => call.url.includes("/odates")).length).to.be.greaterThan(0));
    // Both: the list of places, and the entries that name one.
    expect(seen.some(call => call.url.includes("/locations"))).to.equal(true);
  });

  it("should keep a refused delete's words and leave the place alone", async () => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "DELETE") {
        return json({error: "1 entry still uses this location"}, 409);
      }
      const path = String(url).replace(/^.*\/organizator/, "").split("?")[0];
      if (path === "/locations") return json({locations: [office], requester});
      if (path === "/odate_types") return json({odate_types: [], requester});
      return json({odates: [], requester});
    });
    mount();

    await vi.waitFor(() => expect(panel("#locations").textContent).to.contain("Office"));
    shadow
      .querySelector("#locations")!
      .dispatchEvent(new CustomEvent("place-remove", {detail: {id: 3}}));

    await vi.waitFor(() =>
      expect(panel("#locations").textContent).to.contain("1 entry still uses this location")
    );
    expect(panel("#locations").textContent).to.contain("Office");
  });
});
