/**
 * @prettier
 *
 * Asking before doing something that cannot be taken back.
 */

export interface Confirmation {
  /// What is about to happen.
  question: string;
  /// What it costs, in as many lines as it takes.
  detail: string;
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
 * memo's title is whatever the reader typed into it.
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
    detail.textContent = confirmation.detail;

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
