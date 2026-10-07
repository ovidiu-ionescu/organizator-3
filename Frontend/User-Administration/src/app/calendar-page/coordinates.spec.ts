import { formatCoordinates, mapUrl, parseCoordinates } from './coordinates';

/** What a visitor pastes, which is what this has to read. */
describe('parseCoordinates', () => {
  it('reads the pair Google Maps copies', () => {
    // Right-click a point, "copy coordinates": exactly this shape.
    expect(parseCoordinates('44.4268, 26.1025')).toEqual({ latitude: 44.4268, longitude: 26.1025 });
  });

  it('reads a pair without the space, and other whitespace', () => {
    expect(parseCoordinates('44.4268,26.1025')).toEqual({ latitude: 44.4268, longitude: 26.1025 });
    expect(parseCoordinates('  44.4268   26.1025  ')).toEqual({
      latitude: 44.4268,
      longitude: 26.1025,
    });
  });

  it('reads the south and the west', () => {
    expect(parseCoordinates('-33.8688, 151.2093')).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
    });
    expect(parseCoordinates('-33.8688, -70.6693')).toEqual({
      latitude: -33.8688,
      longitude: -70.6693,
    });
  });

  it('accepts the poles and the date line, which are real places', () => {
    expect(parseCoordinates('90, 180')).toEqual({ latitude: 90, longitude: 180 });
    expect(parseCoordinates('-90, -180')).toEqual({ latitude: -90, longitude: -180 });
  });

  it('refuses a pair that is out of range', () => {
    // A slipped digit rather than a place on earth.
    expect(parseCoordinates('444.4268, 26.1025')).toBeNull();
    expect(parseCoordinates('44.4268, 260.1025')).toBeNull();
  });

  it('refuses one number, three numbers, and words', () => {
    expect(parseCoordinates('44.4268')).toBeNull();
    expect(parseCoordinates('44.4268, 26.1025, 3')).toBeNull();
    expect(parseCoordinates('somewhere near the office')).toBeNull();
    expect(parseCoordinates('44.4268, north')).toBeNull();
  });

  it('refuses degrees and minutes rather than reading them wrongly', () => {
    // Reading this as 44.25365 would put the pin in the wrong country, quietly.
    expect(parseCoordinates(`44°25'36.5"N 26°06'09.0"E`)).toBeNull();
  });
});

describe('formatCoordinates', () => {
  it('writes five decimals, which is about a metre', () => {
    expect(formatCoordinates({ latitude: 44.4268, longitude: 26.1025 })).toBe('44.42680, 26.10250');
  });
});

describe('mapUrl', () => {
  it('points at Google Maps with no key in it', () => {
    expect(mapUrl({ latitude: 44.4268, longitude: 26.1025 })).toBe(
      'https://www.google.com/maps?q=44.4268,26.1025'
    );
  });
});
