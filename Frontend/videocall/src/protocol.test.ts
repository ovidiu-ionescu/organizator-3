import { describe, expect, it } from "vitest";

import { encode_client_message, parse_server_message } from "./protocol";

describe("parse_server_message", () => {
  it("reads a welcome with its participants", () => {
    const message = parse_server_message(
      JSON.stringify({
        type: "welcome",
        self_id: "a",
        room_id: "b",
        participants: [{ id: "a", name: "alice", audio: true, video: false }],
      }),
    );
    expect(message).toEqual({
      type: "welcome",
      self_id: "a",
      room_id: "b",
      participants: [{ id: "a", name: "alice", audio: true, video: false }],
    });
  });

  it("reads the kebab-case lifecycle and state messages", () => {
    expect(
      parse_server_message(
        JSON.stringify({
          type: "peer-joined",
          participant: { id: "a", name: "alice", audio: true, video: true },
        }),
      )?.type,
    ).toBe("peer-joined");
    expect(parse_server_message(JSON.stringify({ type: "peer-left", id: "a" }))).toEqual({
      type: "peer-left",
      id: "a",
    });
    expect(
      parse_server_message(
        JSON.stringify({ type: "participant-state", id: "a", audio: false, video: true }),
      ),
    ).toEqual({ type: "participant-state", id: "a", audio: false, video: true });
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
    expect(
      parse_server_message(JSON.stringify({ type: "ice-candidate", from: "a", candidate: {} })),
    ).toBeNull();
  });
});

describe("encode_client_message", () => {
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
