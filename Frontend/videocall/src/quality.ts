/**
 * What the connection indicator says.
 *
 * A video call is usable well before its statistics are perfect, so the thresholds are the point
 * at which a participant would start to notice: 150 ms round trip is still conversational,
 * 300 ms is not; two percent packet loss is a glitch, eight percent is a broken sentence.
 */

export type Quality = "good" | "fair" | "poor" | "unknown";

export type QualitySample = {
  /** Round-trip time in milliseconds, when a candidate pair has reported one. */
  rtt_ms: number | null;
  /** Lost packets divided by the packets that should have arrived, 0..1. */
  loss_ratio: number | null;
  /** Jitter in milliseconds. */
  jitter_ms: number | null;
};

export function classify_quality(sample: QualitySample): Quality {
  const { rtt_ms, loss_ratio, jitter_ms } = sample;
  if (rtt_ms === null && loss_ratio === null && jitter_ms === null) return "unknown";

  const rtt = rtt_ms ?? 0;
  const loss = loss_ratio ?? 0;
  const jitter = jitter_ms ?? 0;

  if (rtt <= 150 && loss <= 0.02 && jitter <= 30) return "good";
  if (rtt <= 300 && loss <= 0.08 && jitter <= 60) return "fair";
  return "poor";
}

/** A sentence for a tooltip or an accessible name. */
export function describe_quality(quality: Quality): string {
  switch (quality) {
    case "good":
      return "Good connection";
    case "fair":
      return "Fair connection";
    case "poor":
      return "Poor connection";
    case "unknown":
      return "Measuring connection";
  }
}

/** A word for the participant list, where the row has no room for a sentence. */
export function short_quality(quality: Quality): string {
  switch (quality) {
    case "good":
      return "Good";
    case "fair":
      return "Fair";
    case "poor":
      return "Poor";
    case "unknown":
      return "Measuring";
  }
}
