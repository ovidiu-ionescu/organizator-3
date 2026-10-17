import { describe, it, expect } from "vitest";
import { format_coordinates, map_url, parse_coordinates } from "@dom/coordinates.js";

// What somebody copies off a map, and what the app refuses to guess at.
describe("coordinate pairs", () => {
  it("should read the pair Google Maps gives you", () => {
    expect(parse_coordinates("44.4268, 26.1025")).to.deep.equal({ latitude: 44.4268, longitude: 26.1025 });
    // A space instead of the comma is the same gesture with a different keyboard.
    expect(parse_coordinates("44.4268 26.1025")).to.deep.equal({ latitude: 44.4268, longitude: 26.1025 });
    expect(parse_coordinates("  44.4268 ,26.1025  ")).to.deep.equal({
      latitude: 44.4268,
      longitude: 26.1025,
    });
  });

  it("should read the south and the west", () => {
    expect(parse_coordinates("-33.8688, -70.6693")).to.deep.equal({
      latitude: -33.8688,
      longitude: -70.6693,
    });
  });

  it("should read the equator and the prime meridian as places", () => {
    // Zero is a perfectly good coordinate — the equator — and not a missing answer.
    expect(parse_coordinates("0, 0")).to.deep.equal({ latitude: 0, longitude: 0 });
  });

  it("should refuse anything that is not a pair", () => {
    expect(parse_coordinates("")).to.be.null;
    expect(parse_coordinates("44.4268")).to.be.null;
    expect(parse_coordinates("44.4268, 26.1025, 3")).to.be.null;
    expect(parse_coordinates("Office")).to.be.null;
    expect(parse_coordinates("44.4268, east")).to.be.null;
  });

  it("should refuse degrees and minutes rather than half read them", () => {
    // Half reading it would put the pin in another country and say nothing: 44°25'36.5" quietly
    // becoming 44.425365 is worse than refusing.
    expect(parse_coordinates(`44°25'36.5"N, 26°6'9"E`)).to.be.null;
  });

  it("should refuse a pair that is out of range, which catches a mistyped digit", () => {
    expect(parse_coordinates("91, 26.1025")).to.be.null;
    expect(parse_coordinates("44.4268, 181")).to.be.null;
  });

  it("should show the pair to five decimals, which is about a metre", () => {
    expect(format_coordinates({ latitude: 44.4268, longitude: 26.1025 })).to.equal(
      "44.42680, 26.10250"
    );
  });

  it("should link to the point on a map", () => {
    expect(map_url({ latitude: 44.4268, longitude: 26.1025 })).to.equal(
      "https://www.google.com/maps?q=44.4268,26.1025"
    );
  });
});
