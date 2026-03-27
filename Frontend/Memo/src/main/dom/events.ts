/**
 * @prettier
 *
 * Defines the events that the app will emit.
 * Includes some helper functions
 */

import konsole from "./console_log.js";

export enum SaveAllStatus {
  Dirty = "green",
  Processing = "orange",
  Failed = "red",
  Success = "",
}

export interface OrgEvents {
  "savingEvent": CustomEvent<string>;
  "saveAllStatus": CustomEvent<SaveAllStatus>;
  "memoChangeId": CustomEvent<{old_id: number, new_id: number}>
  "navigate": CustomEvent<string>;
  "memoDeleted": CustomEvent<number>;
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

export const memo_change_id = (old_id: number, new_id: number) =>
  raspandac.emit("memoChangeId", { old_id, new_id });

export const navigate = (dest: string) =>
  raspandac.emit("navigate", dest );

export const memo_deleted = (id: number) =>
  raspandac.emit("memoDeleted", id);
