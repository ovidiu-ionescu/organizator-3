import { describe, expect, it } from "vitest";

import { encode_client_message, parse_server_message } from "./protocol";

describe("parse_server_message", () => {
  it("reads a welcome with its participants", () => {
    const message = parse_server_message(
      JSON.stringify({
        type: "welcome",
        self_id: "a",
        room_id: "b",
        participants: [
          { id: "a", name: "alice", audio: true, video: false, screen: false },
        ],
      }),
    );
    expect(message).toEqual({
      type: "welcome",
      self_id: "a",
      room_id: "b",
      participants: [
        { id: "a", name: "alice", audio: true, video: false, screen: false },
      ],
      ice_servers: [],
    });
  });

  it("reads the kebab-case lifecycle and state messages", () => {
    expect(
      parse_server_message(
        JSON.stringify({
          type: "peer-joined",
          participant: { id: "a", name: "alice", audio: true, video: true, screen: false },
        }),
      )?.type,
    ).toBe("peer-joined");
    expect(parse_server_message(JSON.stringify({ type: "peer-left", id: "a" }))).toEqual({
      type: "peer-left",
      id: "a",
    });
    expect(
      parse_server_message(
        JSON.stringify({
          type: "participant-state",
          id: "a",
          audio: false,
          video: true,
          screen: true,
        }),
      ),
    ).toEqual({ type: "participant-state", id: "a", audio: false, video: true, screen: true });
  });

  it("reads an offer and an ICE candidate", () => {
    expect(
      parse_server_message(JSON.stringify({ type: "offer", from: "a", sdp: "v=0" })),
    ).toEqual({ type: "offer", from: "a", sdp: "v=0" });

    expect(
      parse_server_message(
        JSON.stringify({
          type: "ice-candidate",
          from: "a",
          candidate: {
            candidate: "candidate:1",
            sdpMid: "0",
            sdpMLineIndex: 0,
            usernameFragment: null,
          },
        }),
      ),
    ).toEqual({
      type: "ice-candidate",
      from: "a",
      candidate: {
        candidate: "candidate:1",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
    });
  });

  it("reads the relay list, and tolerates a missing or broken one", () => {
    const base = {
      type: "welcome",
      self_id: "a",
      room_id: "b",
      participants: [{ id: "a", name: "alice", audio: true, video: true, screen: false }],
    };
    const relays = (payload: object) => {
      const message = parse_server_message(JSON.stringify(payload));
      return message?.type === "welcome" ? message.ice_servers : null;
    };

    expect(
      relays({
        ...base,
        ice_servers: [
          {
            urls: ["turn:turn.example.test:3478?transport=udp"],
            username: "1700000000:alice",
            credential: "abc=",
          },
          { urls: "stun:stun.example.test" },
          { urls: 12 },
        ],
      }),
    ).toEqual([
      {
        urls: ["turn:turn.example.test:3478?transport=udp"],
        username: "1700000000:alice",
        credential: "abc=",
      },
      { urls: "stun:stun.example.test" },
    ]);
    expect(relays(base)).toEqual([]);
    expect(relays({ ...base, ice_servers: "not a list" })).toEqual([]);
  });

  it("reads a chat line", () => {
    expect(
      parse_server_message(
        JSON.stringify({ type: "chat", from: "a", name: "alice", text: "hi", at: 12 }),
      ),
    ).toEqual({ type: "chat", from: "a", name: "alice", text: "hi", at: 12 });
  });

  it("rejects anything that is not a message this build understands", () => {
    expect(parse_server_message("not json")).toBeNull();
    expect(parse_server_message("null")).toBeNull();
    expect(parse_server_message(JSON.stringify({ type: "unknown" }))).toBeNull();
    expect(parse_server_message(JSON.stringify({ type: "chat", text: "hi" }))).toBeNull();
    expect(
      parse_server_message(
        JSON.stringify({ type: "welcome", self_id: "a", room_id: "b", participants: [{}] }),
      ),
    ).toBeNull();
    // A message from a server built before screen sharing reads as a camera, not a screen.
    expect(
      parse_server_message(
        JSON.stringify({
          type: "welcome",
          self_id: "a",
          room_id: "b",
          participants: [{ id: "a", name: "alice", audio: true, video: true }],
        }),
      ),
    ).toEqual({
      type: "welcome",
      self_id: "a",
      room_id: "b",
      participants: [{ id: "a", name: "alice", audio: true, video: true, screen: false }],
      ice_servers: [],
    });
    expect(
      parse_server_message(JSON.stringify({ type: "ice-candidate", from: "a", candidate: {} })),
    ).toBeNull();
  });
});

describe("encode_client_message", () => {
  it("sends the screen flag with the participant state", () => {
    expect(
      encode_client_message({ type: "state", audio: true, video: true, screen: true }),
    ).toBe('{"type":"state","audio":true,"video":true,"screen":true}');
  });

  it("uses the camelCase candidate fields the service reads", () => {
    expect(
      encode_client_message({
        type: "ice-candidate",
        to: "a",
        candidate: {
          candidate: "candidate:1",
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: null,
        },
      }),
    ).toBe(
      '{"type":"ice-candidate","to":"a","candidate":{"candidate":"candidate:1","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":null}}',
    );
  });
});
