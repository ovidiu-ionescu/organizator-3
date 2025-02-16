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
  const align_regex = new RegExp(`^\\s\{0,${indent}\}`, 'gm');

  // Rip out the leading whitespace.
  return lines.map(line => line.replace(align_regex, '')).join('\n');
}

// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
export async function digestMessage(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);                           // encode as (utf-8) Uint8Array
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);           // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer));                     // convert buffer to byte array
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
  return hashHex;
}
