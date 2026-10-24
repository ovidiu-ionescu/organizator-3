/**
 * @prettier
 *
 * Asking before doing something that cannot be taken back.
 */

/**
 * One piece of a confirmation's detail.
 *
 * `data` marks what the reader supplied — a memo's title, an entry's words and times — so that it
 * can be shown in a colour of its own and read apart from the explanation around it. `tone` pairs
 * that colour with a picture of the same data; it names the role, not the colour, so both are
 * declared together in the style below. `visual` is a picture to put where this piece sits.
 */
export interface DetailPart {
  text: string;
  data?: boolean;
  tone?: "primary" | "conflict";
  visual?: SVGElement;
}

export interface Confirmation {
  /// What is about to happen.
  question: string;
  /// What it costs, in as many lines as it takes. A single string is all explanation; the parts
  /// form lets the data in it be marked and a picture be put among the lines.
  detail: string | readonly DetailPart[];
  /// What the button that goes ahead says, in the imperative.
  confirm_label: string;
}

/**
 * Ask the reader, and answer whether to go ahead.
 *
 * In the page rather than in the browser's own box, so that the question can be shaped like the
 * rest of the app and can carry the list of what would be lost.
 *
 * The question and the detail are set as text, never as markup: the detail names memos, and a
 * memo's title is whatever the reader typed into it. The parts of a structured detail are spans
 * whose text is set the same way.
 */
export const ask_confirmation = async (confirmation: Confirmation): Promise<boolean> => {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.style.cssText = `
      padding: 24px; border: none; border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2); max-width: 420px;
      font-family: system-ui, -apple-system, sans-serif;
      background-color: #383838; color: white;
    `;

    const style = document.createElement("style");
    style.textContent = `
      dialog::backdrop { background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(2px); }
      #confirm_question { font-size: 1.1rem; }
      #confirm_detail { margin-top: 12px; white-space: pre-line; color: #f1c40f; }
      /* The picture is supplementary and the detail carries the same data in words. It fills the
         dialog below the word that introduces it and keeps the shape its viewBox gives it. */
      .confirm-visual { display: block; width: 100%; height: auto; margin: 10px 0; }
      /* What the reader supplied, and the bars that draw the same data, share a colour per role:
         the entry being written is blue, the ones it overlaps red. Weight as well as colour, so
         the distinction does not rest on colour alone. */
      #confirm_detail .confirm-data-primary,
      .confirm-visual .confirm-bar-primary { color: #7fd1ff; }
      #confirm_detail .confirm-data-conflict,
      .confirm-visual .confirm-bar-conflict { color: #ff8a80; }
      #confirm_detail .confirm-data { font-weight: 600; }
      .confirm-visual .confirm-bar { fill: currentColor; }
      .btn-group { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
      .btn { background: none; border: 1px solid #888; border-radius: 6px; padding: 6px 12px;
             color: white; font-size: 1rem; cursor: pointer; }
      #confirm_go { border-color: #e74c3c; color: #e74c3c; }
    `;
    document.head.appendChild(style);

    const form = document.createElement("form");
    form.method = "dialog";
    form.autocomplete = "off";

    const question = document.createElement("div");
    question.id = "confirm_question";
    question.textContent = confirmation.question;

    const detail = document.createElement("div");
    detail.id = "confirm_detail";
    if (typeof confirmation.detail === "string") {
      detail.textContent = confirmation.detail;
    } else {
      for (const part of confirmation.detail) {
        if (part.data) {
          const data = document.createElement("span");
          // No tone is the data's usual colour; a tone names the role a picture shares.
          data.className = `confirm-data confirm-data-${part.tone ?? "primary"}`;
          data.textContent = part.text;
          detail.append(data);
        } else {
          // A newline in the explanation is a line break in the box, as it was when the whole
          // detail was one string: the container's `pre-line` keeps both.
          detail.append(part.text);
        }
        if (part.visual !== undefined) detail.append(part.visual);
      }
    }

    const buttons = document.createElement("div");
    buttons.className = "btn-group";

    const cancel = document.createElement("button");
    cancel.type = "submit";
    cancel.value = "cancel";
    cancel.className = "btn";
    cancel.textContent = "Cancel";

    const go_ahead = document.createElement("button");
    go_ahead.type = "submit";
    go_ahead.value = "go";
    go_ahead.id = "confirm_go";
    go_ahead.className = "btn";
    go_ahead.textContent = confirmation.confirm_label;

    buttons.append(cancel, go_ahead);
    form.append(question, detail, buttons);
    dialog.appendChild(form);
    document.body.appendChild(dialog);

    // Closing without pressing anything — Escape, say — leaves the return value empty, which is
    // not the value that goes ahead, so the answer is no unless the button said otherwise.
    dialog.addEventListener("close", () => {
      const answer = dialog.returnValue === "go";
      dialog.remove();
      style.remove();
      resolve(answer);
    });

    dialog.showModal();
  });
};
