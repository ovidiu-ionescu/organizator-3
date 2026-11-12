/**
 * Camera and microphone acquisition.
 *
 * A participant without a working camera is still a participant: they can watch and listen, and
 * they can still type. So each fallback keeps whatever the browser will give, and version four —
 * nothing at all — is a receive-only call rather than a failure to join.
 */

export type MediaResult = {
  stream: MediaStream | null;
  /** What the participant should be told about a partial result, if anything. */
  note: string | null;
};

export async function acquire_media(): Promise<MediaResult> {
  if (navigator.mediaDevices?.getUserMedia === undefined) {
    return {
      stream: null,
      note: "This browser cannot capture media on this page. Joining in listen-only mode.",
    };
  }

  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: true }),
      note: null,
    };
  } catch (error) {
    const full_failure = error;
    try {
      return {
        stream: await navigator.mediaDevices.getUserMedia({ audio: true }),
        note: `Camera unavailable — joining with audio only. ${describe_media_error(full_failure)}`,
      };
    } catch {
      try {
        return {
          stream: await navigator.mediaDevices.getUserMedia({ video: true }),
          note: `Microphone unavailable — joining with video only. ${describe_media_error(full_failure)}`,
        };
      } catch {
        return {
          stream: null,
          note: `Joining in listen-only mode. ${describe_media_error(full_failure)}`,
        };
      }
    }
  }
}

function describe_media_error(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera and microphone access was blocked.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone was found.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera or microphone is already in use.";
    default:
      return "The camera and microphone could not be started.";
  }
}

export function track_for(stream: MediaStream | null, kind: "audio" | "video"): MediaStreamTrack | null {
  if (stream === null) return null;
  return stream.getTracks().find((track) => track.kind === kind) ?? null;
}

export function set_track_enabled(
  stream: MediaStream | null,
  kind: "audio" | "video",
  enabled: boolean,
): void {
  for (const track of stream?.getTracks() ?? []) {
    if (track.kind === kind) track.enabled = enabled;
  }
}

export function stop_stream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
