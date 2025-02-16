/**
 * @prettier
 *
 * Handles all indexedDB interaction
 */

import {
  Memo,
  ServerMemo,
  ServerMemoTitle,
  ServerMemoReply,
  CacheMemo,
  AccessTime,
  UpdateMemoLogic,
  GenericReject,
  IdName,
} from "./memo_interfaces.js";

import * as events from "./events.js";
import * as memo_processing from "./memo_processing.js";
import { merge } from "./diff_match_patch_uncompressed.js";
import konsole from "./console_log.js";

export const DBName = "MemoDatabase";

export const get_db = () => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DBName, 2);

    request.onerror = (event) => {
      konsole.error(`Failed to open database ${(<any>event.target).errorCode}`);
      reject("Why didn't you allow my web app to use IndexedDB?!");
    };

    request.onblocked = (event) => {
      konsole.log("Failed to open the database, blocked");
    };

    prepare_db_if_needed(request);

    request.onsuccess = (event) => {
      const db: IDBDatabase = (event.target as IDBRequest).result;

      db.onerror = (event) => {
        // Generic error handler for all errors targeted at this database's
        // requests!
        const msg = "Database error: " + (<any>event.target).errorCode;
        konsole.error(msg);
        events.updateStatus(msg);
      };

      resolve(db);
    };
  });
};

const prepare_db_if_needed = (request: IDBOpenDBRequest) => {
  // This event is only implemented in recent browsers
  request.onupgradeneeded = (event) => {
    // Save the IDBDatabase interface
    konsole.log("Request onupgradeneeded", event);
    const db = (event.target as IDBOpenDBRequest).result;

    let old_version = event.oldVersion ? event.oldVersion : 0;
    if (old_version < 1) {
      konsole.log("Create an objectStore for this database");
      const memo_store = db.createObjectStore("memo", { keyPath: "id" });
      const access_store = db.createObjectStore("memo_access", {
        keyPath: "id",
      });
      access_store.createIndex("last", "last_access");
    }
    if (old_version < 2) {
      const general_store = db.createObjectStore("general_store", {
        keyPath: "id",
      });
    }
  };
};

const update_access_time = async (transaction: IDBTransaction, id: number) => {
  const access_store = transaction.objectStore("memo_access");
  return new Promise((resolve) => {
    access_store.put({
      id: id,
      last_access: +new Date(),
    }).onsuccess = () => resolve(true);
  });
};

export const get_memo_write_transaction = async () => {
  const db = await get_db();
  return db.transaction(["memo", "memo_access"], "readwrite");
};

const get_memo_read_transaction = async () => {
  const db = await get_db();
  return db.transaction(["memo"], "readonly");
};

/**
 * Read a CacheMemo entry from the local database
 *
 * @param transaction
 * @param id
 */
const raw_read_memo = (transaction: IDBTransaction, id: number) => {
  const memo_store = transaction.objectStore("memo");
  const request = memo_store.get(id);
  return new Promise<CacheMemo>((resolve) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
};

/**
 * Write a CacheMemo to the local database
 * @param transaction
 * @param db_memo
 */
export const raw_write_memo = (
  transaction: IDBTransaction,
  db_memo: CacheMemo
): Promise<CacheMemo> => {
  konsole.log("writing memo to local storage", db_memo.id);
  const memo_store = transaction.objectStore("memo");
  const request = memo_store.put(JSON.parse(JSON.stringify(db_memo)));
  return new Promise((resolve) => {
    request.onsuccess = () => {
      resolve(db_memo);
    };
  });
};

const write_memo_with_timestamp = (
  transaction: IDBTransaction,
  db_memo: CacheMemo
) => {
  db_memo.local.timestamp = +new Date();
  konsole.log(
    `adding timestamp ${db_memo.local.timestamp} to memo ${db_memo.id} before writing`
  );
  return raw_write_memo(transaction, db_memo);
};

/**
 * Reads a memo from local database, updates access time
 * @param id
 */
export const read_memo = async (id: number) => {
  const transaction = await get_memo_write_transaction();
  await update_access_time(transaction, id);
  const cache_memo = await raw_read_memo(transaction, id);
  return cache_memo ? cache_memo.local : null;
};

export const save_memo_after_fetching_from_server = async (
  server_memo_reply: ServerMemoReply
): Promise<Memo> => {
  // sanitize the input first
  const server_memo = memo_processing.server2local(server_memo_reply);
  konsole.log("Save memo after fetching from server", server_memo);
  const transaction = await get_memo_write_transaction();

  await update_access_time(transaction, server_memo.id);

  const existing_db_memo = await raw_read_memo(transaction, server_memo.id);
  if (existing_db_memo) {
    // if the server memo is not newer than the memo last fetched then skip the server one and return local
    if (!memo_processing.first_more_recent(server_memo, existing_db_memo.server)) {
      konsole.log(`server memo ${server_memo.id} timestamp ${server_memo.timestamp} is not more recent than cached memo ancestor ${existing_db_memo.server.timestamp}`);
      return existing_db_memo.local;
    } else {
      if (memo_processing.first_more_recent(existing_db_memo.local, existing_db_memo.server)) {
        konsole.log(`both local and remote have been modified, we need to merge`);

        const text = merge(existing_db_memo.server.text, existing_db_memo.local.text, server_memo.text);
        existing_db_memo.local.text = text;
        existing_db_memo.local.timestamp = (+ new Date);
        existing_db_memo.server = server_memo;
        await raw_write_memo(transaction, existing_db_memo);
        return existing_db_memo.local;
      } else {
        konsole.log(`local memo has not been modified, remote will replace it`);
        await raw_write_memo(transaction, memo_processing.make_cache_memo(server_memo));
        return server_memo;
      }
    }
  } else {
    await raw_write_memo(transaction, memo_processing.make_cache_memo(server_memo));
    return server_memo;
  }
};

/**
 * Updates the local cache if the memo has changed
 * @param memo
 */
export const save_local_only = async (memo: Memo): Promise<Memo> => {
  const transaction = await get_memo_write_transaction();
  const db_memo = await raw_read_memo(transaction, memo.id);

  await update_access_time(transaction, memo.id);

  if (!db_memo) {
    // no entry in cache, new memo
    const new_db_memo: CacheMemo = await write_memo_with_timestamp(
      transaction,
      memo_processing.make_cache_memo(memo)
    );
    return new_db_memo.local;
  } else {
    if (memo_processing.equal(memo, db_memo.local)) {
      // no change, don't bother to write
      return memo;
    } else {
      const new_db_memo: CacheMemo = await write_memo_with_timestamp(
        transaction,
        memo_processing.make_cache_memo(memo, db_memo)
      );
      return new_db_memo.local;
    }
  }
};

/**
 * Returns the last access time for all memos in the local cache
 */
export const access_times = async () => {
  const db = await get_db();
  const transaction = db.transaction(["memo_access"], "readonly");
  return new Promise<Array<AccessTime>>((resolve) => {
    transaction.objectStore("memo_access").getAll().onsuccess = (event) => {
      resolve((event.target as IDBRequest).result);
    };
  });
};

/**
 * List all memos that have not been saved
 */
export const unsaved_memos = async () => {
  const transaction = await get_memo_write_transaction();
  const memo_store = transaction.objectStore("memo");
  const request = memo_store.getAll();
  return new Promise<Array<CacheMemo>>((resolve) => {
    request.onsuccess = (event) => {
      const cached_memos: Array<CacheMemo> = (<IDBRequest>event.target).result;
      // konsole.log(JSON.stringify(cached_memos, null, 2));
      const unsaved_memos = cached_memos.filter(
        memo_processing.should_save_memo_to_server
      );
      konsole.log("unsaved memos:", unsaved_memos.map((m) => m.id).join(" "));
      resolve(unsaved_memos);
    };
  });
};

/**
 * Deletes a memo and the associated structures
 * @param id old memo id
 * @param new_id new memo id, if it has been renamed, for e.g by saving to server
 */
export const delete_memo = async (id: number, new_id?: number) => {
  konsole.log("Deleting memo", id);
  const transaction = await get_memo_write_transaction();
  const memo_store = transaction.objectStore("memo");
  const access_store = transaction.objectStore("memo_access");
  return Promise.all([
    new Promise((resolve) => {
      memo_store.delete(id).onsuccess = () => resolve(true);
    }),
    new Promise((resolve) => {
      access_store.delete(id).onsuccess = () => resolve(true);
    }),
  ]).then(() => {
    if (new_id) {
      konsole.log(`Memo id changed from ${id} to ${new_id}`);
      events.memo_change_id(id, new_id);
    } else {
      konsole.log(`announce memo ${id} has been deleted`);
      events.memo_deleted(id);
    }
  });
};

export const save_memo_after_saving_to_server = async (
  old_id: number,
  server_memo_reply: ServerMemoReply
) => {
  const server_memo = server_memo_reply.memo;
  if (!server_memo) {
    konsole.log(
      `No memo came back from the server for ${old_id}, removing from local storage`
    );
    await delete_memo(old_id);
    return;
  }
  if (server_memo && old_id < 0) {
    // announce everybody this memo has a new id, especially the editor
    konsole.log(
      `Memo ${old_id} has been assigned ${server_memo.id} by the server`
    );
    await delete_memo(old_id, server_memo.id);
  }
  const memo = memo_processing.server2local(server_memo_reply);
  const transaction = await get_memo_write_transaction();
  await raw_write_memo(transaction, memo_processing.make_cache_memo(memo));
  // not sure if access time should be this one, it could be just a batch save
  await update_access_time(transaction, memo.id);
  return memo;
};

/**
 * Creates a list of new memos, id < 0
 */
const get_memo_titles = async (
  id_limit: number
): Promise<Array<ServerMemoTitle>> => {
  const transaction = await get_memo_read_transaction();
  const memo_store = transaction.objectStore("memo");

  return new Promise((resolve) => {
    const result = [];
    memo_store.openCursor().onsuccess = (event) => {
      const cursor: IDBCursorWithValue = (event.target as IDBRequest).result;
      if (cursor) {
        const cache_memo: CacheMemo = cursor.value;
        if (cache_memo.id > id_limit) {
          return resolve(result);
        }
        result.push(memo_processing.make_server_memo_title(cache_memo));
        cursor.continue();
      } else {
        return resolve(result);
      }
    };
  });
};

export const get_new_memos = () => get_memo_titles(0);
export const get_all_memos = () => get_memo_titles(Infinity);

const store_put = async (id: string, value: any, store_name: string) => {
  const db = await get_db();
  const transaction = db.transaction([store_name], "readwrite");
  const memo_store = transaction.objectStore(store_name);
  const payload = { id, value };
  const request = memo_store.put(payload);
  return new Promise<CacheMemo>((resolve) => {
    request.onsuccess = () => {
      resolve(value);
    };
  });
};

const store_get = async (key: string, store_name: string) => {
  const db = await get_db();
  const transaction = db.transaction([store_name], "readonly");
  const request = transaction.objectStore(store_name).get(key);
  return new Promise<any>((resolve) => {
    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.value);
      }
      resolve(null);
    };
  });
};

export const general_store_put = async (key: string, value: any) =>
  store_put(key, value, "general_store");
export const general_store_get = async (key: string) =>
  store_get(key, "general_store");
