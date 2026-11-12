/**
 * The messages exchanged with the signaling service.
 *
 * The Rust side tags its enums with `type` in kebab-case and leaves the field names to serde's
 * default, so the JSON is a mix: `peer-joined`, but `self_id` and `room_id`. The ICE candidate
 * is the one struct with camelCase fields, because the browser's RTCIceCandidateInit uses them.
 *
 * Everything that arrives is parsed, not cast. The socket is the only thing between the browser
 * and the service, but a message arriving during a deploy can be a different shape than this
 * build expects, and a parser that says "not a message" is easier to live with than one that
 * hands the rest of the app `undefined`.
 */

export type ParticipantInfo = {
  id: string;
  name: string;
  audio: boolean;
  video: boolean;
};

/** An ICE candidate in the shape `RTCIceCandidate.toJSON()` produces. */
export type ClientIceCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
};

/** The candidate as the service sends it back, in camelCase, with missing fields allowed. */
export type ServerIceCandidate = ClientIceCandidate;

export type ClientMessage =
  | { type: "offer"; to: string; sdp: string }
  | { type: "answer"; to: string; sdp: string }
  | { type: "ice-candidate"; to: string; candidate: ClientIceCandidate }
  | { type: "chat"; text: string }
  | { type: "state"; audio: boolean; video: boolean };

export type ServerMessage =
  | {
      type: "welcome";
      self_id: string;
      room_id: string;
      participants: ParticipantInfo[];
    }
  | { type: "peer-joined"; participant: ParticipantInfo }
  | { type: "peer-left"; id: string }
  | { type: "offer"; from: string; sdp: string }
  | { type: "answer"; from: string; sdp: string }
  | { type: "ice-candidate"; from: string; candidate: ServerIceCandidate }
  | { type: "chat"; from: string; name: string; text: string; at: number }
  | { type: "participant-state"; id: string; audio: boolean; video: boolean }
  | { type: "error"; message: string };

const is_object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const is_string = (value: unknown): value is string => typeof value === "string";
const is_boolean = (value: unknown): value is boolean => typeof value === "boolean";
const is_number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function parse_participant(value: unknown): ParticipantInfo | null {
  if (!is_object(value)) return null;
  if (!is_string(value.id) || !is_string(value.name)) return null;
  if (!is_boolean(value.audio) || !is_boolean(value.video)) return null;
  return {
    id: value.id,
    name: value.name,
    audio: value.audio,
    video: value.video,
  };
}

function parse_candidate(value: unknown): ServerIceCandidate | null {
  if (!is_object(value) || !is_string(value.candidate)) return null;

  const mid = value.sdpMid;
  const index = value.sdpMLineIndex;
  const fragment = value.usernameFragment;
  if (mid !== undefined && mid !== null && !is_string(mid)) return null;
  if (index !== undefined && index !== null && !is_number(index)) return null;
  if (fragment !== undefined && fragment !== null && !is_string(fragment)) return null;

  return {
    candidate: value.candidate,
    sdpMid: is_string(mid) ? mid : null,
    sdpMLineIndex: is_number(index) ? index : null,
    usernameFragment: is_string(fragment) ? fragment : null,
  };
}

/** Parse one frame from the service. A frame this build does not understand is ignored. */
export function parse_server_message(text: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!is_object(value) || !is_string(value.type)) return null;

  switch (value.type) {
    case "welcome": {
      if (!is_string(value.self_id) || !is_string(value.room_id)) return null;
      if (!Array.isArray(value.participants)) return null;
      const participants: ParticipantInfo[] = [];
      for (const entry of value.participants) {
        const participant = parse_participant(entry);
        if (participant === null) return null;
        participants.push(participant);
      }
      return {
        type: "welcome",
        self_id: value.self_id,
        room_id: value.room_id,
        participants,
      };
    }
    case "peer-joined": {
      const participant = parse_participant(value.participant);
      if (participant === null) return null;
      return { type: "peer-joined", participant };
    }
    case "peer-left":
      if (!is_string(value.id)) return null;
      return { type: "peer-left", id: value.id };
    case "offer":
    case "answer": {
      if (!is_string(value.from) || !is_string(value.sdp)) return null;
      return { type: value.type, from: value.from, sdp: value.sdp };
    }
    case "ice-candidate": {
      if (!is_string(value.from)) return null;
      const candidate = parse_candidate(value.candidate);
      if (candidate === null) return null;
      return { type: "ice-candidate", from: value.from, candidate };
    }
    case "chat": {
      if (!is_string(value.from) || !is_string(value.name)) return null;
      if (!is_string(value.text) || !is_number(value.at)) return null;
      return {
        type: "chat",
        from: value.from,
        name: value.name,
        text: value.text,
        at: value.at,
      };
    }
    case "participant-state": {
      if (!is_string(value.id)) return null;
      if (!is_boolean(value.audio) || !is_boolean(value.video)) return null;
      return {
        type: "participant-state",
        id: value.id,
        audio: value.audio,
        video: value.video,
      };
    }
    case "error":
      if (!is_string(value.message)) return null;
      return { type: "error", message: value.message };
    default:
      return null;
  }
}

export function encode_client_message(message: ClientMessage): string {
  return JSON.stringify(message);
}
