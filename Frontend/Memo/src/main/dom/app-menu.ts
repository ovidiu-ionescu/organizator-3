/**
 * @prettier
 *
 * The menu behind the three dots: the few things that are about the app rather than about the memo
 * on screen — taking every memo onto this device, the two pages that are not memos, and signing
 * out.
 *
 * A dialog rather than a drop-down, which is what the app already uses to ask something
 * (confirm.ts) and what a thumb can reach on a phone. It is also where the caching run can say how
 * far it has got: the list page's own "Cache all" link reports into the list, which is not on
 * screen when the menu is used from a memo.
 */

import konsole from "./console_log.js";
import * as events from "./events.js";
import * as server_comm from "./server_comm.js";

/// The page the reader is sent to when the session is gone. Same shape as everywhere else: back
/// here once they have signed in again.
const go_to_login = () =>
  window.location.replace(`/login.html?r=${encodeURIComponent(window.location.href)}`);

/// Sign out on the server, then out of the app. Everything on this device stays on it — the memos
/// cached here are still here, and anything waiting to be saved goes to the server when the reader
/// signs back in.
const log_out = async () => {
  try {
    const response = await fetch("/organizator/logout", { credentials: "include", method: "GET" });
    if (!response.ok) {
      // The cookie is cleared by the server's own Set-Cookie, and only the server can do it: the
      // session cookie is HttpOnly. An answer that is not ok means it is still there, and the
      // reader going to the login page believing they have signed out is worth a line in the
      // journal at least.
      konsole.error(`Signing out was refused: the server answered ${response.status}`);
    }
  } catch (e) {
    konsole.error("Could not reach the server to sign out", e);
  }
  go_to_login();
};

const entry_button = (label: string, run: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  // Not a submit: the buttons that close the dialog are the ones in .btn-group, and an entry that
  // closed it would take the run with it.
  button.type = "button";
  button.className = "menu-entry";
  button.textContent = label;
  button.addEventListener("click", run);
  return button;
};

export const open_app_menu = () => {
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
    #menu_entries { display: flex; flex-direction: column; gap: 10px; min-width: 240px; }
    .menu-entry { background: none; border: 1px solid #888; border-radius: 6px; padding: 12px;
                  color: white; font-family: inherit; font-size: 1rem; text-align: left;
                  cursor: pointer; }
    .menu-entry:hover { border-color: white; }
    #menu_progress { margin-top: 4px; min-height: 1.2rem; color: #f1c40f; white-space: pre-line; }
    .btn-group { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
    .btn { background: none; border: 1px solid #888; border-radius: 6px; padding: 6px 12px;
           color: white; font-size: 1rem; cursor: pointer; }
  `;
  document.head.appendChild(style);

  const form = document.createElement("form");
  form.method = "dialog";
  form.autocomplete = "off";

  const entries = document.createElement("div");
  entries.id = "menu_entries";

  const progress = document.createElement("div");
  progress.id = "menu_progress";

  const buttons = document.createElement("div");
  buttons.className = "btn-group";

  const close_button = document.createElement("button");
  close_button.type = "submit";
  close_button.value = "close";
  close_button.className = "btn";
  close_button.textContent = "Close";
  buttons.appendChild(close_button);

  /// Take every memo the server has onto this device, saying how far it has got — a run over a
  /// few hundred memos is not instant, and silence would look like a tap that did nothing.
  const cache_everything = async () => {
    entries.remove();
    try {
      const result = await server_comm.cache_all_memos((done, total) => {
        progress.textContent = `Caching ${done} of ${total}…`;
      });
      progress.textContent = result.failures.length
        ? `${result.cached} of ${result.total} memos are now on this device.\n` +
          result.failures.slice(0, 5).join("\n")
        : `All ${result.total} memos are now on this device.`;
    } catch (e) {
      if (e instanceof server_comm.UnauthenticatedError) {
        go_to_login();
        return;
      }
      konsole.error("Failed to cache the memos", e);
      // The error's own sentence rather than the whole object: "HTTP Error 404: Failed to list the
      // memos" says what happened, "HttpError: …" only says which class it is.
      progress.textContent = `Could not cache the memos: ${e instanceof Error ? e.message : e}`;
    }
  };

  /// Go somewhere else in the app, with the dialog out of the way first. `events.navigate` is how
  /// the journal button in the editor moves too: it saves what is open, tells the router, and the
  /// router draws the page.
  const go_to = (where: string) => {
    dialog.close();
    events.navigate(where);
  };

  entries.append(
    entry_button("Cache all memos on this device", () => {
      cache_everything();
    }),
    // What used to be the two links in the corner of the list, which were hard to reach on a phone
    // and made the list page carry chrome the other pages did not have.
    entry_button("Admin", () => go_to("/memo/$$$admin")),
    entry_button("Journal", () => go_to("/journal")),
    entry_button("Log out", () => {
      dialog.close();
      log_out();
    })
  );

  form.append(entries, progress, buttons);
  dialog.appendChild(form);
  document.body.appendChild(dialog);

  dialog.addEventListener("close", () => {
    dialog.remove();
    style.remove();
  });

  dialog.showModal();
};

document.getElementById("app_menu")?.addEventListener("click", (event) => {
  event.preventDefault();
  open_app_menu();
});
