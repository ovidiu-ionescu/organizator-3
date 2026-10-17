/**
 * @prettier
 *
 * What the memo app's menu holds.
 *
 * The dialog and the two entries every page shares live in app-menu.ts; the one thing that is only
 * the memo app's — taking every memo onto this device — is registered from here, because it reaches
 * into the memo database and the server calls, and the calendar page has no business carrying those.
 *
 * The two screens beside this one are reached without leaving the document, which is what
 * events.navigate is for: it saves what is open and lets the router draw the page.
 */
import konsole from "./console_log.js";
import * as events from "./events.js";
import * as server_comm from "./server_comm.js";
import {go_to_login} from "./http.js";
import {log_out, set_app_entries} from "./app-menu.js";
import type {MenuEntry} from "./app-menu.js";

/// The memo app's entries, as a value rather than only as a registration: a test puts them back
/// after trying entries of its own.
export const memo_menu_entries = (): MenuEntry[] => [
  // First, and the only one with a picture: what this app holds is memos, and the calendar is the
  // other place the reader goes — the same icon the editor's own date button wears.
  {
    label: "Calendar",
    icon: "/images/ic_today_48px.svg",
    run: (_progress, close) => (close(), window.location.assign("/calendar")),
  },
  {
    label: "Cache all memos on this device",
    /// A run over a few hundred memos is not instant, and silence would look like a tap that did
    /// nothing: the dialog's progress line says how far it has got.
    run: async progress => {
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
        // The error's own sentence rather than the whole object: "HTTP Error 404: Failed to list
        // the memos" says what happened, "HttpError: …" only says which class it is.
        progress.textContent = `Could not cache the memos: ${e instanceof Error ? e.message : e}`;
      }
    },
  },
  // What used to be the two links in the corner of the list, which were hard to reach on a phone
  // and made the list page carry chrome the other pages did not have.
  {label: "Admin", run: (_progress, close) => (close(), events.navigate("/memo/$$$admin"))},
  {label: "Journal", run: (_progress, close) => (close(), events.navigate("/journal"))},
  {label: "Log out", run: (_progress, close) => (close(), void log_out())},
];

set_app_entries(memo_menu_entries);
