// https://muffinresearch.co.uk/removing-leading-whitespace-in-es6-template-strings/
export function alignedText(strings: TemplateStringsArray, ...values: string[]) {
  // Interweave the strings with the
  // substitution vars first.
  let output = '';
  for (let i = 0; i < values.length; i++) {
    output += strings[i] + values[i];
  }
  output += strings[values.length];

  // Split on newlines.
  let lines = output.split(/(?:\r\n|\n|\r)/);

  let indent = 0;
  if(lines.length > 1 && !lines[0]) {
    lines.shift();
    // https://stackoverflow.com/questions/25823914/javascript-count-spaces-before-first-character-of-a-string
    indent = lines[0].search(/\S|$/);
  }
  const align_regex = new RegExp(`^\\s{0,${indent}}`, 'gm');

  // Rip out the leading whitespace.
  return lines.map(line => line.replace(align_regex, '')).join('\n');
}

/// Combining diacritical marks, U+0300 to U+036F. Decomposing an accented letter with NFD
/// leaves the letter and one of these side by side: "é" becomes "e" followed by U+0301.
const COMBINING_MARKS_START = 0x300;
const COMBINING_MARKS_END = 0x36f;

/**
 * Fold the accents out of a string before comparing it with another.
 *
 * The server matches with `unaccent(...) @@ to_tsquery(...)`, so a search for "cafe" finds a
 * memo that says "café". Comparing raw text in the local search would answer the same query
 * with a different, shorter list, and the reader has no way to tell which search they got.
 * This does what `unaccent` does for accented Latin letters, though not every mapping it
 * carries.
 */
export function fold(text: string): string {
  const marks = [...text.normalize("NFD")].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < COMBINING_MARKS_START || code > COMBINING_MARKS_END;
  });
  return marks.join("").toLowerCase();
}

/**
 * Turn a failed response into something the editor can display.
 *
 * Only 200 and 401 were branched on, so every other status fell through and left the page
 * showing whatever it had put up while loading: a memo that was deleted or belongs to somebody
 * else (404), a refusal from the ACL (403) and a fault on the server (5xx) all looked the same
 * — "# Loading..." forever. 401 is not handled here, it redirects to the login page instead.
 */
export function failure_message(status: number, what: string): string {
  switch (status) {
    case 403:
      return `# No access to ${what}`;
    case 404:
      return `# No ${what} on server`;
    case 400:
      return `# The server refused the request for ${what}`;
    default:
      return `# Failed to load ${what}, server status ${status}`;
  }
}

// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
export async function digestMessage(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);                           // encode as (utf-8) Uint8Array
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);           // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer));                     // convert buffer to byte array
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
  return hashHex;
}
