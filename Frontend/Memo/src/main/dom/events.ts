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

export const SAVE_ALL_STATUS = "saveAllStatus";
export const SAVING_EVENT = "savingEvent";
export const MEMO_CHANGE_ID = "memoChangeId";
export const NAVIGATE = "navigate";
export const MEMO_DELETED = "memoDeleted";

/**
 * Emit an event containing a message
 * @param {string} type
 * @param {string} message
 */
export const sendMessageEvent = (type: string, message: string): void => {
  const msg = `${new Date()} - ${message}`;
  konsole.log(`Sending event: ${type}, detail: ${msg}`);
  const event = new CustomEvent(type, { detail: msg });
  document.dispatchEvent(event);
};

/**
 * Emit an event containing a message for the status field
 * @param message
 */
export const updateStatus = (message: string) => {
  sendMessageEvent(SAVING_EVENT, message);
};

export const save_all_status = (status: SaveAllStatus) => {
  document.dispatchEvent(new CustomEvent(SAVE_ALL_STATUS, { detail: status }));
};

export const memo_change_id = (old_id: number, new_id: number) => {
  document.dispatchEvent(
    new CustomEvent(MEMO_CHANGE_ID, {
      detail: {
        old_id,
        new_id,
      },
    })
  );
};

export const navigate = (dest: string) => {
  document.dispatchEvent(new CustomEvent(NAVIGATE, { detail: dest }));
};

export const memo_deleted = (id: number) => {
  document.dispatchEvent(new CustomEvent(MEMO_DELETED, { detail: id }));
};
