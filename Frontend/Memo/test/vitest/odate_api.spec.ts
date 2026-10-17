import { describe, it, expect, afterEach, vi } from "vitest";
import * as api from "@dom/odate_api.js";
import { UnauthenticatedError } from "@dom/http.js";

// The calendar's side of the server: what it asks for, what it does with the answer, and what it
// says when the answer is a refusal. The server is a stub in these tests — the shape of its answers
// is what matters here.
const real_fetch = globalThis.fetch;

interface Call {
  url: string;
  method: string;
  credentials: string | undefined;
  body: string | undefined;
}

const calls: Call[] = [];

const answer = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/// A server that answers with whatever the test hands it, and remembers what it was asked.
const stub = (reply: (url: string, method: string) => Response) => {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: String(url),
      method,
      credentials: (init?.credentials as string) ?? undefined,
      body: (init?.body as string) ?? undefined,
    });
    return reply(String(url), method);
  });
};

const requester = { id: 1, name: "alice" };

describe("the calendar's calls", () => {
  afterEach(() => {
    calls.length = 0;
    vi.unstubAllGlobals();
  });

  it("should send the session cookie with every call", async () => {
    stub(() => answer({ odates: [], requester }));
    await api.read_odates();
    await api.read_locations();
    await api.read_odate_types();
    await api.create_odate({ start_time: 1, end_time: 2 });
    await api.delete_odate_type(3);

    expect(calls.length).to.equal(5);
    calls.forEach(call => expect(call.credentials).to.equal("include"));
  });

  it("should read an empty list as an empty list, not as nothing", async () => {
    // The server builds these with json_agg, which is SQL NULL over no rows: "nothing yet" arrives
    // as null, and a screen that reads null as an array breaks on the first visit.
    stub(() => answer({ odates: null, locations: null, odate_types: null, requester }));

    expect(await api.read_odates()).to.deep.equal([]);
    expect(await api.read_locations()).to.deep.equal([]);
    expect(await api.read_odate_types()).to.deep.equal([]);
  });

  it("should ask for the range it was given, and only for that", async () => {
    stub(() => answer({ odates: [], requester }));

    await api.read_odates({ from: 1000 });
    await api.read_odates({ until: 2000 });
    await api.read_odates();

    expect(calls[0].url).to.contain("from=1000");
    expect(calls[0].url).to.not.contain("until=");
    expect(calls[1].url).to.contain("until=2000");
    expect(calls[1].url).to.not.contain("from=");
    expect(calls[2].url).to.not.contain("from=");
    expect(calls[2].url).to.not.contain("until=");
  });

  it("should send an entry with only the fields that were given", async () => {
    stub(() => answer({ id: 7 }, 201));

    await api.create_odate({ start_time: 10, end_time: 20, description: "Dentist" });

    const body = JSON.parse(calls[0].body!);
    // "No notes" is not the same answer as "notes that are empty": the server stores what it is
    // given.
    expect(body).to.deep.equal({ start_time: 10, end_time: 20, description: "Dentist" });
  });

  it("should name the entry in the address a change goes to", async () => {
    stub(() => answer({ id: 7 }));
    await api.update_odate(7, { start_time: 1, end_time: 2 });
    expect(calls[0].url).to.contain("/organizator/odates/7");
    expect(calls[0].method).to.equal("PUT");
  });

  it("should keep the server's own words when it explains itself", async () => {
    stub(() => answer({ error: "1 entry still uses this location" }, 409));

    const failure = await api.delete_location(4).catch((e: unknown) => e);

    expect(failure).to.be.instanceOf(api.ServerRefusal);
    expect((failure as api.ServerRefusal).status).to.equal(409);
    expect((failure as api.ServerRefusal).reason).to.equal("1 entry still uses this location");
  });

  it("should not repeat a proxy's error page as if it were a reason", async () => {
    stub(() => new Response("<html><body>502 Bad Gateway</body></html>", { status: 502 }));

    const failure = (await api.read_locations().catch((e: unknown) => e)) as api.ServerRefusal;

    expect(failure.reason).to.be.null;
    expect(api.place_change_failed(failure, "the location")).to.equal("Failed to change the location.");
  });

  it("should say the server cannot be reached when the request never arrives", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("NetworkError when attempting to fetch resource.");
    });

    const failure = (await api.read_odates().catch((e: unknown) => e)) as api.ServerRefusal;

    expect(failure.status).to.equal(0);
    expect(api.place_change_failed(failure, "the date type")).to.equal(
      "The server could not be reached, so the date type was not changed."
    );
  });

  it("should tell a session that is gone from a refusal", async () => {
    stub(() => answer({}, 401));

    const failure = await api.read_odates().catch((e: unknown) => e);
    expect(failure).to.be.instanceOf(UnauthenticatedError);
  });

  it("should word the refusals the way a reader needs them", () => {
    const refusal = (status: number, reason: string | null) => new api.ServerRefusal(status, reason);

    // A refusal the database made on the caller's behalf names nothing, so the app's own words are
    // more use than the server's.
    expect(api.place_change_failed(refusal(403, "Data access forbidden"), "the location")).to.equal(
      "You are not allowed to change the location."
    );
    // A bare 404 is axum's fallback for a path no handler is on: the app is ahead of its backend.
    expect(api.place_change_failed(refusal(404, null), "the date type")).to.equal(
      "The server does not support changing the date type yet (it answered 404)."
    );
    // Not "the name is taken": a 409 with no body says only that something else changed first.
    expect(api.place_change_failed(refusal(409, null), "the location “X”")).to.equal(
      "Something else changed first, so the location “X” was not changed."
    );
    expect(api.place_change_failed(refusal(422, "An entry has to end after it starts"), "the location")).to.equal(
      "Could not change the location: An entry has to end after it starts"
    );
  });

  it("should word a refusal of the entry itself with the server's reason", () => {
    expect(api.entry_change_failed(new api.ServerRefusal(422, "No such location of yours"), "add")).to.equal(
      "Could not add the entry: No such location of yours"
    );
    expect(api.entry_change_failed(new api.ServerRefusal(500, null), "save")).to.equal(
      "Could not save the entry."
    );
  });
});
