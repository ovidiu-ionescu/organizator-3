import { describe, expect, it } from "vitest";

import { is_room_id, new_room_id, room_id_from_input, share_url } from "./room";

const ROOM = "123e4567-e89b-42d3-a456-426614174000";

describe("room ids", () => {
  it("generates ids the service accepts", () => {
    const id = new_room_id();
    expect(is_room_id(id)).toBe(true);
    expect(room_id_from_input(id)).toBe(id);
  });

  it("does not mistake arbitrary text for an id", () => {
    expect(is_room_id("room")).toBe(false);
    expect(is_room_id("123e4567e89b42d3a456426614174000")).toBe(false);
    expect(room_id_from_input("")).toBeNull();
    expect(room_id_from_input("not a room")).toBeNull();
  });
});

describe("room_id_from_input", () => {
  it("takes the id from a shared link", () => {
    expect(room_id_from_input(share_url(ROOM, "https://organizator.ro"))).toBe(ROOM);
  });

  it("takes the id from a pasted relative query", () => {
    expect(room_id_from_input(`?room=${ROOM}`)).toBe(ROOM);
    expect(room_id_from_input(`/videocall/?room=${ROOM}`)).toBe(ROOM);
  });

  it("takes the id from the last path segment of another URL", () => {
    expect(room_id_from_input(`https://example.test/call/${ROOM}`)).toBe(ROOM);
  });

  it("normalizes the id to lower case", () => {
    expect(room_id_from_input(ROOM.toUpperCase())).toBe(ROOM);
  });
});

describe("share_url", () => {
  it("points at the videocall page with the room query", () => {
    expect(share_url(ROOM, "https://organizator.ro")).toBe(
      `https://organizator.ro/videocall/?room=${ROOM}`,
    );
    expect(share_url(ROOM, "https://organizator.ro/")).toBe(
      `https://organizator.ro/videocall/?room=${ROOM}`,
    );
  });
});
