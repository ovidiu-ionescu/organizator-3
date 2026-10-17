/**
 * @prettier
 *
 * How a barcode is drawn: a white plate with black bars on it, in the face that draws those bars, at
 * the size the memo app has always used.
 *
 * Shared because two pages now show the same notes — the editor and the calendar — and a barcode
 * that came out at a different size or in a different face on one of them would be a barcode that
 * scanned on one of them.
 *
 * `scope` is what the rules hang off: "#presentation " inside the editor's shadow root, where they
 * have to stay in front of the theme rule that sets a colour and a font on everything in the memo;
 * and the notes element's own class on the calendar page, which is light DOM and needs them
 * confined to it.
 *
 * Only the plate, the faces and the sizes are here. How the plate sits in the line, and what
 * happens when it is wider than the screen, is the caller's business: the editor centres it and
 * leaves it at that, and the calendar page — which reads notes in a narrow column on a phone — lays
 * it out with barcode_layout_css below.
 */
export const presentation_css = (scope: string): string => `
      /* A barcode is read by a scanner: white behind black bars, in the font that draws those bars,
         whatever the reader chose to read in. The plate is a border rather than padding so that a
         scanner has the quiet zone it expects at each end, and the colours are spelled out rather
         than taken from a theme on purpose — bars drawn in a dark theme's colours are not a barcode
         any more. */
      ${scope}div[data-gen="barcode128"] span, ${scope}div[data-gen="barcode39"] span, ${scope}div[data-gen="barcode13"] span {
        border-width: 10px 40px 10px 40px;
        border-style: solid;
        border-color: white;
        color: black;
        background-color: white;
        margin: 10px;
        display: inline-block;
      }
      ${scope}div[data-gen="barcode128"] span {
        font-family: "Libre Barcode 128 Text", system-ui;
        font-size: 65px;
      }
      ${scope}div[data-gen="barcode39"] span {
        font-family: "Libre Barcode 39 Text", system-ui;
        font-size: 65px;
      }
      ${scope}div[data-gen="barcode13"] span {
        font-family: "Libre Barcode EAN13 Text", system-ui;
        font-size: 200px;
      }`;

/**
 * How a barcode sits in the column it is read in, where that column can be narrower than the plate.
 *
 * A barcode that wraps is not a barcode — the bars have to be one symbol for a scanner to read them
 * — so the plate never breaks inside itself, and where it is wider than the column it can be scrolled
 * to. On a phone there is no room to put a plate of that size on the line at all, and a barcode is
 * the one part of a note that has to be looked at square on rather than read, so there it is centred
 * with whatever does not fit clipped off both ends: what shows is the middle of the symbol, and what
 * the clipping eats first is the quiet zone, which is white space a scanner needs only a little of.
 */
export const barcode_layout_css = (scope: string): string => `
      ${scope}div[data-gen="barcode13"],
      ${scope}div[data-gen="barcode128"],
      ${scope}div[data-gen="barcode39"] {
        overflow-x: auto;
      }
      ${scope}div[data-gen="barcode13"] span,
      ${scope}div[data-gen="barcode128"] span,
      ${scope}div[data-gen="barcode39"] span {
        white-space: nowrap;
      }
      @media (max-width: 600px) {
        ${scope}div[data-gen="barcode13"],
        ${scope}div[data-gen="barcode128"],
        ${scope}div[data-gen="barcode39"] {
          display: flex;
          justify-content: center;
          overflow: hidden;
        }
      }`;

/**
 * How the markdown of a note reads: a quote is a bar down its left-hand side — in a colour of its
 * own, since the theme's border colour is an edge and this line is the whole of the quote — a list is
 * indented,
 * and a checklist's boxes do not run into the words beside them.
 *
 * Kept out of presentation_css, which the memo app draws with as well: how a *memo* reads is a
 * decision about the memo app, and this is the calendar's notes. Named separately so the two can be
 * brought together deliberately rather than by accident.
 */
export const markdown_notes_css = (scope: string): string => `
      ${scope}blockquote {
        /* The line down the side is what makes a quote a quote. The browser's own answer is to
           indent it by 40px and leave it at that, which reads as a paragraph that started late. */
        margin: 0.4rem 0;
        padding-left: 0.6rem;
        border-left: 3px solid var(--memo-quote-line, grey);
      }
      ${scope}ul, ${scope}ol {
        margin: 0.4rem 0;
        padding-left: 1.2rem;
      }
      ${scope}li {
        margin: 0.1rem 0;
      }
      ${scope}input[type="checkbox"] {
        margin-right: 0.4rem;
      }`;
