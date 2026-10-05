/**
 * @prettier
 *
 * Handles all indexedDB interaction
 */

import {
  Memo,
  ServerMemo,
  MemoTitle,
  ServerMemoReply,
  CacheMemo,
  AccessTime,
  UpdateMemoLogic,
  GenericReject,
  IdName,
} from "./memo_interfaces.js";

import * as events from "./events.js";
import * as memo_processing from "./memo_processing.js";
import {wasm_ready} from "./wasm.js";
import konsole from "./console_log.js";

export const DBName = "MemoDatabase";

/// This page's connection, kept rather than opened afresh for every read and write. A connection
/// also has to be held on to if it is ever to be closed: a delete waits for every open connection
/// before it runs, so a page that opens one per call and closes none leaves its own delete
/// waiting forever — and every later open queues behind that delete, which is how the memo list
/// ends up unable to read anything at all.
let connection: Promise<IDBDatabase> | undefined;

export const get_db = (): Promise<IDBDatabase> => {
  if (!connection) {
    // A failure is not kept: the browser can refuse to open the database once — storage busy, or
    // the profile locked for a moment — and holding on to that rejection would leave every later
    // read and write failing against a page that had one bad moment.
    connection = open_db().catch((e) => {
      connection = undefined;
      throw e;
    });
  }
  return connection;
};

const open_db = () => {
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

      // Another tab deleting or upgrading the database waits for this connection to close. Let
      // it through rather than blocking it; the next call opens whatever it left behind.
      db.onversionchange = () => {
        konsole.log("Another tab is changing the database, closing this connection");
        db.close();
        connection = undefined;
      };

      resolve(db);
    };
  });
};

/**
 * Delete the whole local database, which is what the debug command that drops the cache asks for.
 *
 * This page's own connection is closed first. A delete waits for every open connection, so
 * without that it would be waiting on the connection it is being asked to delete — and, worse,
 * every read after it would queue behind a delete that never runs. That is a page that can no
 * longer read a memo, which is what "stuck on Loading..." was.
 */
export const drop_database = async (): Promise<void> => {
  const opening = connection;
  connection = undefined;
  if (opening) {
    // It may still be coming up; wait for it so that there is something to close. One that never
    // opened is nothing to close, and nothing to wait for.
    const db = await opening.catch(() => undefined);
    db?.close();
  }

  await new Promise<void>((resolve, reject) => {
    const request = window.indexedDB.deleteDatabase(DBName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete ${DBName}`));
    // Another tab still has the database open and only it can let go. Waiting cannot help, and
    // the wait would block this page's own reads, so report it instead.
    request.onblocked = () =>
      reject(
        new Error(
          "Another tab or window is still using the database. This page cannot read anything " +
            "until it lets go: close the other tab, then reload this one."
        )
      );
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

/**
 * A request that is expected to answer, and the two ways it can fail instead.
 *
 * `onsuccess` was the only handler these used to carry, so a request that failed left its promise
 * unsettled for ever: the caller waited for an answer that was never coming, and a save that had
 * failed looked exactly like a save still in progress — no red button, no message, edits that
 * reached nowhere. A request can fail on its own (the database refuses it) or be aborted when its
 * transaction goes away (another request in it failed, or another tab closed the database).
 */
const answer = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("The database refused the request"));
    // The abort event is fired at the request as well as at its transaction, but lib.dom only
    // declares a handler for it on the transaction, so it is listened for by name.
    request.addEventListener("abort", () =>
      reject(request.error ?? new Error("The database abandoned the request"))
    );
  });

const update_access_time = async (transaction: IDBTransaction, id: number) => {
  const access_store = transaction.objectStore("memo_access");
  await answer(access_store.put({ id, last_access: +new Date() }));
  return true;
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
  // Nothing there is an ordinary answer, not a failure: the request succeeded and had no row.
  return answer<CacheMemo | undefined>(memo_store.get(id));
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
  const written = answer(memo_store.put(JSON.parse(JSON.stringify(db_memo))));
  return written.then(() => db_memo);
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
 * The local half of a cached memo, marked with whether it still holds changes the server has not
 * seen.
 *
 * A cached memo keeps both halves — what the server had when it was last fetched, and what is
 * here now — so this is read off the record rather than guessed at, or asked of the server.
 */
const with_dirty = (cache_memo: CacheMemo): Memo => {
  cache_memo.local.dirty = memo_processing.should_save_memo_to_server(cache_memo);
  return cache_memo.local;
};

/**
 * Reads a memo from local database, updates access time
 * @param id
 */
export const read_memo = async (id: number) => {
  const transaction = await get_memo_write_transaction();
  await update_access_time(transaction, id);
  const cache_memo = await raw_read_memo(transaction, id);
  return cache_memo ? with_dirty(cache_memo) : null;
};

/**
 * Caches a memo that was just fetched from the server
 * @param server_memo_reply
 * @return memo to be used locally
 */
export const save_memo_after_fetching_from_server = async (
    server_memo_reply: ServerMemoReply
): Promise<Memo> => {
  // sanitize the input first
  const server_memo = memo_processing.server2local(server_memo_reply);
  konsole.log("Save memo after fetching from server", server_memo);
  // only needed for merge, should we wait here?
  await wasm_ready();
  const transaction = await get_memo_write_transaction();
  const cached_memo = await raw_read_memo(transaction, server_memo.id);
  // collect the conditions we need processing
  const is_cache_present = !! cached_memo;
  const has_server_memogroup_changed = cached_memo?.server?.memogroup?.id !== server_memo.memogroup?.id;
  const has_local_memogroup_changed = cached_memo?.local?.memogroup?.id !== cached_memo?.server?.memogroup?.id;
  const has_server_text_changed = cached_memo?.server?.text !== server_memo.text;
  const has_local_text_changed = !(cached_memo?.local?.text && memo_processing.canonical_memo_text(cached_memo?.local?.text) === memo_processing.canonical_memo_text(server_memo.text));
  const has_server_access_level_changed = cached_memo?.server?.readonly !== server_memo.readonly;

  const has_local_changes = has_local_memogroup_changed || has_local_text_changed;
  const has_server_changes = has_server_memogroup_changed || has_server_text_changed;

  if(!is_cache_present) {
    const cache_memo = memo_processing.make_synced_cache_memo(server_memo);
    await raw_write_memo(transaction, cache_memo);
    return with_dirty(cache_memo);
  }
  if(!cached_memo.server) {
    const msg = `Server memo should be in cache but only local is present ${server_memo_reply.memo.id}`;
    console.error(msg);
    throw msg;
  }
  // from now on we no longer check for is_cache_present, we can't reach if it is not

  // if no change on server, nothing to see, carry on
  if(!has_server_changes && !has_server_access_level_changed) {
    return with_dirty(cached_memo);
  }
  debugger
  // server says memo turned readonly, drop changes
  // ATTENTION: we might be dropping data
  if(server_memo.readonly && has_server_access_level_changed) {
    const cache_memo = memo_processing.make_synced_cache_memo(server_memo);
    await raw_write_memo(transaction, cache_memo);
    return with_dirty(cache_memo);
  }
  if(!server_memo.readonly && has_server_access_level_changed && !has_server_changes)  {
    // we were readonly before now we allow changes. Just move to writeable
    cached_memo.local.readonly = false
    cached_memo.server.readonly = false
    await raw_write_memo(transaction, cached_memo);
    return with_dirty(cached_memo);
  }
  // from now on, server says writable
  // we don't have local changes but server has changed
  if(!has_local_changes && has_server_changes) {
    const cache_memo = memo_processing.make_synced_cache_memo(server_memo);
    await raw_write_memo(transaction, cache_memo);
    return with_dirty(cache_memo);
  }
  debugger

  if(has_server_text_changed) {
    cached_memo.local.text = memo_processing.merge_memo_text(
        cached_memo!.server!.text,
        cached_memo.local.text,
        server_memo.text
    );
  }
  cached_memo.local.readonly = false
  cached_memo.server.readonly = false

  if (has_server_memogroup_changed  && !has_local_memogroup_changed) {
    cached_memo.local.memogroup = server_memo.memogroup;
  }
  await raw_write_memo(transaction, cached_memo);
  return with_dirty(cached_memo);
};


export const save_memo_after_fetching_from_server_old = async (
  server_memo_reply: ServerMemoReply
): Promise<Memo> => {
  // sanitize the input first
  const server_memo = memo_processing.server2local(server_memo_reply);
  konsole.log("Save memo after fetching from server", server_memo);

  // Before the transaction is opened, never inside it. A memo written away from here is merged
  // the moment it is fetched, and the merge is wasm; but an IndexedDB transaction commits as
  // soon as it is left waiting on something that is not itself, so a merge that waited for the
  // module midway would come back to a transaction that had already finished.
  await wasm_ready();

  const transaction = await get_memo_write_transaction();
  const cached_memo = await raw_read_memo(transaction, server_memo.id);

  // FIXME this is really bad when caching the whole data
  //await update_access_time(transaction, server_memo.id);

  if (cached_memo) {
    // if the server memo is not newer than the memo last fetched then skip the server one and return local
    if (!memo_processing.first_more_recent(server_memo, cached_memo.server)) {
      konsole.log(`server memo ${server_memo.id} timestamp ${server_memo.timestamp} is not more recent than cached memo ancestor ${cached_memo.server?.timestamp}`);
      // The reply says who may write this memo, and that is not part of the text: a grant or a
      // revocation arrives with the same savetime as before, so this branch is the only one that
      // ever sees it. Taking only `owned` from it — and only into memory — left a reader who had
      // just been given write access still locked out, and a change they made anyway queued
      // nowhere, because the dirtiness of a record is measured against its server half.
      cached_memo.local.readonly = server_memo.readonly;
      cached_memo.local.owned = server_memo.owned;
      if (cached_memo.server) {
        cached_memo.server.readonly = server_memo.readonly;
        cached_memo.server.owned = server_memo.owned;
      }
      await raw_write_memo(transaction, cached_memo);
      return with_dirty(cached_memo);
    } else {
      if (!cached_memo.server) {
        // A record with no server half: a memo written here that was never sent, whose cached
        // ancestor is gone — the cache was dropped while the editor held it, or it was cleared
        // elsewhere. There is nothing to merge against, and merging against nothing calls any two
        // texts a conflict and writes the markers out, which then get saved over the server's
        // copy. What is here exists nowhere else, so it is kept and left to be sent; the version
        // the server holds goes to memo_history when the save replaces it.
        konsole.log(
          `memo ${cached_memo.id} has no ancestor to merge with, keeping the text written ` +
          `here and leaving it to be saved`
        );
        // The group is the one thing that can be taken from the reply without guessing. A local
        // copy that names no group is not a copy that says "no group" — it is one that never knew
        // — and saving it as it stands sends no group_id, which memo_write reads as "put it in no
        // group": the memo leaves the group it was in. What the reply says about the *text* is
        // left alone, because with no common ancestor that would be a guess between two versions.
        if (!cached_memo.local.memogroup && server_memo.memogroup) {
          konsole.log(
            `memo ${cached_memo.id} was in group ${server_memo.memogroup.id} on the server; ` +
            `the copy here never had one, so it takes the server's`
          );
          cached_memo.local.memogroup = server_memo.memogroup;
        }
        // And the reply is recorded as what the server holds. Leaving the record without it —
        // which is what this used to do — made every later fetch of that memo a fetch of nothing:
        // the copy was compared against no ancestor at all, so it read as unsent for ever and was
        // ready to be pushed over whatever the server really had. With the reply recorded the two
        // halves can be compared, and only a memo that really differs is left to send.
        cached_memo.server = server_memo;
        await raw_write_memo(transaction, cached_memo);
        return with_dirty(cached_memo);
      }
      if (memo_processing.first_more_recent(cached_memo.local, cached_memo.server)) {
        // this makes no sense. You want to merge if the server was modified. How do you know?
        // it should be different from server instance you based your changes.
        konsole.log(`both local and remote have been modified, we need to merge`);

        // The group the reply carries is the one the memo is in now. The local copy only
        // disagrees when this device moved it — a change of its own, which is kept — and
        // otherwise its group is simply the one from before a move made elsewhere. Keeping that
        // one would mark the record dirty and move the memo back on the next save.
        // Moved here means the local copy names a group the ancestor did not have. A local copy
        // that names *no* group is not one that says "no group" — it is one that never knew, and
        // a memo saved from it leaves the group it is really in.
        const moved_here =
          !!cached_memo.local.memogroup &&
          cached_memo.local.memogroup?.id !== cached_memo.server.memogroup?.id;
        const text = memo_processing.merge_memo_text(
          cached_memo.server.text,
          cached_memo.local.text,
          server_memo.text
        );
        cached_memo.local.text = text;
        cached_memo.local.timestamp = (+ new Date);
        if (!moved_here) {
          cached_memo.local.memogroup = server_memo.memogroup;
        }
        cached_memo.server = server_memo;
        await raw_write_memo(transaction, cached_memo);
        return with_dirty(cached_memo);
      } else {
        konsole.log(`local memo has not been modified, remote will replace it`);
        const cache_memo = memo_processing.make_synced_cache_memo(server_memo);
        await raw_write_memo(transaction, cache_memo);
        return with_dirty(cache_memo);
      }
    }
  } else {
    const cache_memo = memo_processing.make_synced_cache_memo(server_memo);
    await raw_write_memo(transaction, cache_memo);
    return with_dirty(cache_memo);
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
    return with_dirty(new_db_memo);
  } else {
    if (memo_processing.equal(memo, db_memo.local)) {
      // no change, don't bother to write — the cache still knows where this memo stands
      return with_dirty(db_memo);
    } else {
      const new_db_memo: CacheMemo = await write_memo_with_timestamp(
        transaction,
        memo_processing.make_cache_memo(memo, db_memo)
      );
      return with_dirty(new_db_memo);
    }
  }
};

/**
 * Returns the last access time for all memos in the local cache
 */
export const access_times = async () => {
  const db = await get_db();
  const transaction = db.transaction(["memo_access"], "readonly");
  return answer<Array<AccessTime>>(transaction.objectStore("memo_access").getAll());
};

/**
 * Every memo held in the local database, each with the full text of the memo in `local.text`.
 */
export const cached_memos = async (): Promise<Array<CacheMemo>> => {
  const transaction = await get_memo_write_transaction();
  const memo_store = transaction.objectStore("memo");
  return answer<Array<CacheMemo>>(memo_store.getAll());
};

/**
 * List all memos that have not been saved
 */
export const unsaved_memos = async () => {
  const cached = await cached_memos();
  const unsaved_memos = cached.filter(
    memo_processing.should_save_memo_to_server
  );
  konsole.log("unsaved memos:", unsaved_memos.map((m) => m.id).join(" "));
  return unsaved_memos;
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
  // One transaction, so either both go or neither does — and the announcement below is made
  // only when they did.
  return Promise.all([answer(memo_store.delete(id)), answer(access_store.delete(id))]).then(() => {
    if (new_id) {
      konsole.log(`Memo id changed from ${id} to ${new_id}`);
      events.memo_change_id(id, new_id);
    } else {
      konsole.log(`announce memo ${id} has been deleted`);
      events.memo_deleted(id);
    }
  });
};

/**
 * The server refused a save because it already holds exactly this memo (409, from memo_write's
 * 2F006 when a write would change nothing).
 *
 * Nothing was written and nothing changed, and the refusal is the server saying that what was
 * sent is what it has. So the record is in step: the local copy *is* the server's copy. Without
 * this the memo is called unsaved for ever — the record it comes from, or the text, never quite
 * matches — and is sent again on every save.
 */
export const mark_memo_in_step = async (id: number): Promise<Memo | undefined> => {
  const transaction = await get_memo_write_transaction();
  const cache_memo = await raw_read_memo(transaction, id);
  if (!cache_memo) {
    return undefined;
  }
  // A copy, not the same object: the two halves are compared by value, and an alias would make
  // every later change to one of them a change to both.
  cache_memo.server = { ...cache_memo.local };
  await raw_write_memo(transaction, cache_memo);
  return with_dirty(cache_memo);
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
  // The server accepted a write for this memo, which is proof the requester may write it:
  // memo_write.sql only lets the owner, or a non-owner holding level 2 on the group, through at
  // all. So this holds whether or not the reply carries an access level, which matters because
  // marking a memo the reader has just saved as read-only locks them out of their own edit. The
  // reply does carry one now (SQL/Updates/003); this is what keeps an un-migrated database, or
  // an older server, from doing exactly that.
  memo.readonly = false;
  const transaction = await get_memo_write_transaction();
  // It came back from the server a moment ago, so both halves of the record are this memo.
  await raw_write_memo(transaction, memo_processing.make_synced_cache_memo(memo));
  // not sure if access time should be this one, it could be just a batch save
  await update_access_time(transaction, memo.id);
  // It went to the server a moment ago, so there is nothing outstanding for it.
  memo.dirty = false;
  return memo;
};

/**
 * If id_limit is 0 it fetches just new memos
 */
const get_memo_titles = async (
  id_limit: number
): Promise<Array<MemoTitle>> => {
  const transaction = await get_memo_read_transaction();
  const memo_store = transaction.objectStore("memo");

  return new Promise((resolve, reject) => {
    const result: MemoTitle[] = [];
    const request = memo_store.openCursor();
    // A cursor is walked rather than awaited, so this one keeps its own three handlers — but it
    // is still a request that can fail or be aborted, and the caller has to hear about that
    // rather than waiting for a list that is never coming.
    request.onsuccess = (event) => {
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
    request.onerror = () =>
      reject(request.error ?? new Error("The database refused to list the memos"));
    request.addEventListener("abort", () =>
      reject(request.error ?? new Error("The database abandoned the listing of memos"))
    );
  });
};

export const get_new_memos = () => get_memo_titles(0);
export const get_all_memos = () => get_memo_titles(Infinity);

const store_put = async (id: string, value: any, store_name: string) => {
  const db = await get_db();
  const transaction = db.transaction([store_name], "readwrite");
  const memo_store = transaction.objectStore(store_name);
  const payload = { id, value };
  return answer(memo_store.put(payload)).then(() => value);
};

const store_get = async (key: string, store_name: string) => {
  const db = await get_db();
  const transaction = db.transaction([store_name], "readonly");
  const request = transaction.objectStore(store_name).get(key);
  return new Promise<any>((resolve, reject) => {
    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.value);
      }
      resolve(null);
    };
    request.onerror = () =>
      reject(request.error ?? new Error(`The database refused to read ${key}`));
    request.addEventListener("abort", () =>
      reject(request.error ?? new Error(`The database abandoned reading ${key}`))
    );
  });
};

export const general_store_put = async (key: string, value: any) =>
  store_put(key, value, "general_store");
export const general_store_get = async (key: string) =>
  store_get(key, "general_store");
