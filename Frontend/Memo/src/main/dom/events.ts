/**
 * @prettier
 *
 * Defines the events that the app will emit.
 * Includes some helper functions
 */

import konsole from "./console_log.js";

/// What the save button says about where the memo is. The value is the CSS colour it is given,
/// and the states are stops on one journey: edited in the editor, written to this device,
/// written to the server.
export enum SaveAllStatus {
  /// Nothing to report, which is where a memo starts: the empty value clears the inline colour
  /// and leaves the button in the template's white.
  Neutral = "",
  /// Edited in the editor and not written anywhere yet. The most fragile state there is — close
  /// the page now and the change is gone — which is why it does not share the colour of a memo
  /// that is merely waiting to be synced.
  Edited = "yellow",
  /// Written to this device's database, not on the server yet, whether a save is under way or
  /// still to come.
  Dirty = "orange",
  /// The last save reached the server.
  Success = "green",
  /// This device's database refused the memo, so it is not on the server either and there is
  /// nothing left to retry from.
  Failed = "red",
}

export interface OrgEvents {
  "savingEvent": CustomEvent<string>;
  "saveAllStatus": CustomEvent<SaveAllStatus>;
  /// What a save-all run ended up doing, for whoever is on screen to show: which memos were not
  /// saved and why. Separate from savingEvent, which is a line of progress and clears the memo
  /// the editor is holding.
  "saveAllReport": CustomEvent<string>;
  "memoChangeId": CustomEvent<{old_id: number, new_id: number}>
  "navigate": CustomEvent<string>;
  "memoDeleted": CustomEvent<number>;
  /// A memo has been written to this device. The list of titles is drawn from what the database
  /// said when it was last drawn, so it has to hear about this rather than find out later.
  "memoSavedLocally": CustomEvent<number>;
}
// export const SAVE_ALL_STATUS = "saveAllStatus";
// export const SAVING_EVENT = "savingEvent";
// export const MEMO_CHANGE_ID = "memoChangeId";
// export const NAVIGATE = "navigate";
// export const MEMO_DELETED = "memoDeleted";

class Raspandac extends EventTarget {
  emit<K extends keyof OrgEvents, T>(name: K, detail: T) {
    this.dispatchEvent(new CustomEvent(name, {detail}));
  }
  on<K extends keyof OrgEvents>(type: K, callback: (event: OrgEvents[K]) => void, options?: boolean | AddEventListenerOptions) {
    super.addEventListener(type, callback as EventListener, options);
  }
}

export const raspandac = new Raspandac();

export const updateStatus = (message: string) =>
  raspandac.emit("savingEvent", message);

export const save_all_status = (status: SaveAllStatus) =>
  raspandac.emit("saveAllStatus", status);

export const save_all_report = (report: string) =>
  raspandac.emit("saveAllReport", report);

export const memo_change_id = (old_id: number, new_id: number) =>
  raspandac.emit("memoChangeId", { old_id, new_id });

export const navigate = (dest: string) =>
  raspandac.emit("navigate", dest );

export const memo_deleted = (id: number) =>
  raspandac.emit("memoDeleted", id);

export const memo_saved_locally = (id: number) =>
  raspandac.emit("memoSavedLocally", id);
