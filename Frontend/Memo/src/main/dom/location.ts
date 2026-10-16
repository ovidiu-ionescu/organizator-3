/**
 * @prettier
 *
 * Where the reader is, as a link that opens there in Google Maps.
 *
 * The browser's own geolocation, which asks the reader for permission the first time and answers
 * with an error rather than a position when they refuse. The messages below are written to be shown
 * to the reader as they are — the caller puts them in the status line — because the reasons the
 * browser gives are the ones worth repeating: refused, unavailable, or too slow.
 */

export interface Position {
  /// What the link says on screen. The coordinates rather than a word, so that a memo with two of
  /// these does not say the same thing twice.
  label: string;
  /// The documented form of a Maps URL (developers.google.com/maps/documentation/urls), rather
  /// than one of the shapes that happen to work today.
  url: string;
}

/// Five decimals is about a metre, which is more than the answer is worth and short enough to read.
const DECIMALS = 5;

/// How long to wait for an answer before giving up on one, in milliseconds. Without it the browser
/// may leave the reader waiting on a fix that never comes.
const PATIENCE = 10000;

/// A fix from the last minute is good enough for "where this was written", and reusing one is
/// instant where asking again may take seconds.
const RECENT_ENOUGH = 60000;

export const current_position = (): Promise<Position> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      // An old browser, or a page the browser does not consider secure: geolocation is only
      // offered over https.
      reject(new Error("This browser will not say where you are."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (found) => {
        const latitude = found.coords.latitude.toFixed(DECIMALS);
        const longitude = found.coords.longitude.toFixed(DECIMALS);
        resolve({
          label: `${latitude}, ${longitude}`,
          url: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
        });
      },
      (failure) => {
        switch (failure.code) {
          case failure.PERMISSION_DENIED:
            reject(new Error("The browser was not allowed to say where you are."));
            return;
          case failure.POSITION_UNAVAILABLE:
            reject(new Error("The browser could not work out where you are."));
            return;
          case failure.TIMEOUT:
            reject(new Error("Working out where you are took too long."));
            return;
          default:
            reject(new Error(`The browser could not say where you are: ${failure.message}`));
        }
      },
      { timeout: PATIENCE, maximumAge: RECENT_ENOUGH }
    );
  });
