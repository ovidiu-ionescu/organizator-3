import { describe, expect, it } from "vitest";

import { classify_quality } from "./quality";

describe("classify_quality", () => {
  it("has nothing to say before the first report", () => {
    expect(classify_quality({ rtt_ms: null, loss_ratio: null, jitter_ms: null })).toBe("unknown");
  });

  it("calls a fast, clean connection good", () => {
    expect(classify_quality({ rtt_ms: 40, loss_ratio: 0, jitter_ms: 5 })).toBe("good");
    expect(classify_quality({ rtt_ms: 150, loss_ratio: 0.02, jitter_ms: 30 })).toBe("good");
  });

  it("calls a connection that is starting to hurt fair", () => {
    expect(classify_quality({ rtt_ms: 200, loss_ratio: 0, jitter_ms: 10 })).toBe("fair");
    expect(classify_quality({ rtt_ms: 40, loss_ratio: 0.05, jitter_ms: 10 })).toBe("fair");
    expect(classify_quality({ rtt_ms: 40, loss_ratio: 0, jitter_ms: 45 })).toBe("fair");
  });

  it("calls a connection past those limits poor", () => {
    expect(classify_quality({ rtt_ms: 301, loss_ratio: 0, jitter_ms: 0 })).toBe("poor");
    expect(classify_quality({ rtt_ms: 40, loss_ratio: 0.09, jitter_ms: 0 })).toBe("poor");
    expect(classify_quality({ rtt_ms: 40, loss_ratio: 0, jitter_ms: 61 })).toBe("poor");
  });

  it("uses whatever it has when a report is partial", () => {
    expect(classify_quality({ rtt_ms: null, loss_ratio: 0, jitter_ms: null })).toBe("good");
    expect(classify_quality({ rtt_ms: null, loss_ratio: 0.5, jitter_ms: null })).toBe("poor");
  });
});
