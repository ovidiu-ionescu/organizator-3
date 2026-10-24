/**
 * @prettier
 *
 * The menu behind the three dots: the few things that are about the app rather than about what is on
 * screen — the pages beside this one, and signing out.
 *
 * Which entries it holds is the page's to say, because what is beside a page depends on the page:
 * the memo app moves between its own screens without leaving the document, and the calendar is a
 * document of its own. A page registers its list with set_app_entries; the default is the two
 * screens besides it and signing out.
 *
 * A dialog rather than a drop-down, which is what the app already uses to ask something
 * (confirm.ts) and what a thumb can reach on a phone.
 */
import konsole from "./console_log.js";
import {go_to_login} from "./http.js";

export interface MenuEntry {
  label: string;
  /// An SVG to put before the label, inlined the way the rest of the app does it. Optional: an
  /// entry is a word, and a list of words with one picture in it is a list where the picture means
  /// something.
  icon?: string;
  /**
   * What the entry does when it is chosen. `progress` is the dialog's own line, for anything that
   * takes a while; `close` puts the dialog away first, for anything that leaves the page.
   *
   * An entry that answers with a promise is taken to be doing something, and the rest of the
   * entries are taken away while it does: a second tap on "cache all memos" would set a second run
   * going over the same library.
   */
  run: (progress: HTMLElement, close: () => void) => void | Promise<void>;
}

/// Sign out on the server, then out of the app. Everything on this device stays on it — the memos
/// cached here are still here, and anything waiting to be saved goes to the server when the reader
/// signs back in.
export const log_out = async (): Promise<void> => {
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

const go_to = (where: string) => {
  window.location.assign(where);
};

/// What the menu holds when the page has not said. Enough to be useful on any page, and nothing
/// that belongs to one of them.
const default_entries = (): MenuEntry[] => [
  {label: "Memos", run: (_progress, close) => (close(), go_to("/memo/"))},
  {label: "Calendar", run: (_progress, close) => (close(), go_to("/calendar"))},
  {label: "Memo Maintenance", run: (_progress, close) => (close(), go_to("/memo/$$$admin"))},
  {
    label: "User administration",
    icon: "/images/ic_people_48px.svg",
    run: (_progress, close) => (close(), go_to("/user-admin/")),
  },
  {label: "Journal", run: (_progress, close) => (close(), go_to("/journal"))},
  {label: "Log out", run: (_progress, close) => (close(), void log_out())},
];

let entries_for_page: () => MenuEntry[] = default_entries;

/// The entries this page's menu holds. Registered once by the page, before the menu is opened.
export const set_app_entries = (entries: () => MenuEntry[]): void => {
  entries_for_page = entries;
};

const entry_button = (
  entry: MenuEntry,
  progress: HTMLElement,
  close: () => void,
  entries: HTMLElement
): HTMLButtonElement => {
  const button = document.createElement("button");
  // Not a submit: the buttons that close the dialog are the ones in .btn-group, and an entry that
  // closed it would take the run with it.
  button.type = "button";
  button.className = "menu-entry";
  if (entry.icon !== undefined) {
    // Built from markup rather than createElement plus setAttribute: this element reads its src in
    // its own constructor, which has already run by the time an attribute is set afterwards — it
    // would find no src, log, and leave the button without its picture.
    const holder = document.createElement("span");
    holder.innerHTML = `<img-inline-svg src="${entry.icon}"></img-inline-svg>`;
    // No title: the button says the word, and a title here would be the same word a second time.
    button.append(holder.firstElementChild!);
  }
  button.append(entry.label);
  button.addEventListener("click", () => {
    if (entry.run(progress, close) instanceof Promise) entries.remove();
  });
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
                  cursor: pointer; display: flex; align-items: center; gap: 10px; }
    .menu-entry img-inline-svg { width: 22px; height: 22px; flex: 0 0 auto; display: block; }
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

  const close = () => dialog.close();

  entries.append(...entries_for_page().map(entry => entry_button(entry, progress, close, entries)));

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
