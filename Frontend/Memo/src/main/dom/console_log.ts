/**
 * @prettier
 *
 * Keep the last few log messages in an array. Useful for debugging on mobile
 */

/// How many lines the journal keeps.
const CAP = 1000;

/// Where the buffer is trimmed down to CAP again. Trimming happens in one pass when the buffer
/// runs a quarter over, rather than shifting one line off the front for every message once it is
/// full: `shift` moves every entry that is left, which with a buffer this size is a copy of the
/// whole log on every log call. The array therefore runs a little over CAP between trims, and the
/// journal shows those lines — they are the most recent ones.
const TRIM_AT = CAP + Math.max(64, Math.floor(CAP / 4));

const journal: string[] = [];

const add = (...args: (string | number)[]) => {
  journal.push(args.join(" "));
  if (journal.length > TRIM_AT) {
    journal.splice(0, journal.length - CAP);
  }
};

const konsole = {
  log: (...args: any) => {
    console.log(...args);
    add(...args);
  },
  error: (...args: any) => {
    console.error(...args);
    add(...args);
  },
  journal: () => journal,
};
const default_export = konsole;
export default default_export;
