/**
 * @prettier
 *
 * Handles the interaction with the server
 */
import konsole from "./console_log.js";
import * as db from "./memo_db.js";
import {
  ExplicitPermissions,
  FileStoreDiagnostics,
  IdName,
  Memo,
  MemoGroups,
  MemoStats,
  MemoTitleListDTO,
  PermissionDetailLine,
  ServerMemoReply,
  Undef,
  UserGroups,
  UserGroupsPerUser,
} from "./memo_interfaces.js";
import * as events from "./events.js";
import * as memo_processing from "./memo_processing.js";
import {MemoEditor} from "./memo-editor.js";
import {wasm_ready} from "./wasm.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(`HTTP Error ${status}: ${message}`);
    this.name = 'HttpError';
  }
}
export class UnauthenticatedError extends HttpError {
  constructor(message: string = `No session, need to log in`) {
    super(401, message);
    this.name = 'UnauthenticatedError';
  }
}
/**
 * The code communicating with the server
 */

/**
 * Save a memo on the server.
 *
 * @param {Memo} memo body of the memo
 */
export const save_to_server = async (memo: Memo): Promise<ServerMemoReply> => {
  konsole.log(`Saving to server memo ${memo.id}, size ${memo.text.length}, memo_group ${memo?.memogroup?.id}`);
  const memogroup = memo.memogroup ? `group_id=${memo.memogroup.id}&` : "";
  const memoId = memo.id < 0 ? "" : `memo_id=${memo.id}&`;
  const text = `text=${encodeURIComponent(memo.text)}&`;
  const body = `${memogroup}${memoId}${text}`;

  const response = await fetch("/organizator/memo/", {
    credentials: "include",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      "x-organizator-client-version": "3",
    },
    body: body,
    method: "POST",
    mode: "cors",
  });

  switch (response.status) {
    case 200: // OK
      return await response.json();
    case 401: // Not authenticated
      konsole.error(`Unauthenticated when trying to save memo ${memoId}`);
      throw new UnauthenticatedError();
    case 409: // Conflict: the server holds exactly this memo already
      // memo_write refuses a write that would change nothing, so this is not a save that went
      // wrong — there was nothing to save. Said in those words, because "the save failed" sends
      // the reader looking for a problem that is not there.
      konsole.log(`Memo ${memoId} is already on the server exactly as it is here`);
      throw new HttpError(
        409,
        `The memo is identical to the one on the server, so there was nothing to save`
      );
    default:
      konsole.log(`Save to server failed for memo ${memoId} with status ${response.status}`);
      throw new HttpError(response.status, `Save to server failed for memo ${memoId}`);
  }
};

/// What went wrong, for a reader rather than a log. Not everything thrown here is an Error:
/// read_memo throws a plain object with a message on it.
const describe_failure = (e: unknown): string => {
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
};

/// How many failures the report spells out before it stops listing them.
const REPORTED_FAILURES = 5;

export const save_all = async () => {
  const unsaved_memos = await db.unsaved_memos();
  if (!unsaved_memos.length) {
    // Nothing is waiting to go to the server, so this run has nothing to say about where the
    // memos are. Reporting success here used to repaint a red button — the colour that means the
    // memo is in this device's database nowhere at all — with a claim that everything was saved.
    konsole.log("save_all: nothing is waiting to be saved");
    return;
  }
  events.save_all_status(events.SaveAllStatus.Dirty);

  const failures: string[] = [];
  // Memos the server turned out to be holding already. Not failures — nothing was left unsaved —
  // but worth a line each, because a record only gets into that state by having lost track.
  const already_there: string[] = [];
  let session_gone = false;
  let local_failure = false;

  // Save to the server and get the server instance, one memo at a time.
  for (const memo of unsaved_memos) {
    // A memo that will not save is no reason to leave the others unsaved: a refusal, a memo that
    // has gone, or a fault says nothing about the next one, and stopping here would leave the
    // rest dirty for no reason. The exception is a session that has gone — then none of them can
    // save, and asking each one in turn would only produce the same failure a few more times.
    // Everything is inside the try, including reading the server's copy: that read could throw
    // out of the loop before, which is what made one bad memo abandon the run.
    if (session_gone) {
      failures.push(`memo ${memo.id}: not attempted, the session had expired`);
      continue;
    }

    const id = memo.id;
    try {
      if (memo.id > -1) {
        // this is an existing memo, might have changed on the server since we got it
        const server_memo_reply = await read_memo(id);
        const server_memo = server_memo_reply.memo;
        if (!server_memo && !memo.local.text) {
          konsole.log(
            `The memo ${memo.id} is not present on the server and has no local content, delete it`
          );
          await db.delete_memo(memo.id);
          continue;
        }
        if (
          server_memo &&
          server_memo.savetime &&
          memo.server &&
          memo.server.timestamp &&
          server_memo.savetime > memo.server.timestamp
        ) {
          konsole.log(
            `compute a merge, the server memo has been modified since last save`,
            memo.id
          );
          const remote_memo = memo_processing.server2local(server_memo_reply);
          await wasm_ready();
          memo.local.text = memo_processing.merge_memo_text(
            memo.server.text,
            memo.local.text,
            remote_memo.text
          );

          // if this is loaded in the current editor we need to swap in the new text
          const editor = <MemoEditor>document.getElementById("editor");
          if (editor.memoId === memo.id) {
            konsole.log(
              `Load into the editor the merged result for memo ${memo.id}`
            );
            await editor.set_memo(memo.local, true);
          }
        }
      } else {
        if (!memo.local.text) {
          konsole.log(`New memo ${memo.id} has no content, delete it`);
          await db.delete_memo(memo.id);
          continue;
        }
      }

      const server_memo = await save_to_server(memo.local);
      await db.save_memo_after_saving_to_server(id, server_memo);
    } catch (e) {
      if (e instanceof UnauthenticatedError) {
        session_gone = true;
      }
      if (e instanceof HttpError && e.status === 409) {
        // The server already holds exactly this memo, so there was nothing to save. The record
        // is told so: it is in step, and calling it unsaved for ever is what made a memo that was
        // already on the server look dirty and be re-sent on every save.
        await db.mark_memo_in_step(id);
        already_there.push(`memo ${memo.id}: identical to the one on the server — nothing to save`);
        continue;
      }
      // A server that refused or a session that went leaves the memo where it was and it can be
      // tried again. Anything else came out of this device's own database, and that is what the
      // button is red for.
      if (!(e instanceof HttpError)) {
        local_failure = true;
      }
      konsole.error(`save_all: memo ${memo.id} was not saved`, e);
      failures.push(`memo ${memo.id}: ${describe_failure(e)}`);
    }
  }

  const saved = unsaved_memos.length - failures.length;
  konsole.log(`save_all: ${saved} of ${unsaved_memos.length} memos saved`);

  if (!failures.length) {
    // Everything is on the server, including the ones that turned out to be there already.
    events.save_all_status(events.SaveAllStatus.Success);
  } else if (local_failure) {
    // The button says where the memos are, not how the run went. Orange means "not on the server
    // yet", which is exactly where a run that could not sync leaves them: it was orange before
    // the run and it stays orange. Red is for memos that are not on this device either — the one
    // state a reader cannot recover from by trying again.
    events.save_all_status(events.SaveAllStatus.Failed);
  }

  if (!failures.length && !already_there.length) {
    return;
  }

  // Say what happened rather than only colouring the button: which memos were left behind, and
  // why, is the part a reader can act on.
  const listed = failures.slice(0, REPORTED_FAILURES);
  const rest = failures.length - listed.length;
  events.save_all_report(
    [
      failures.length
        ? `${saved} of ${unsaved_memos.length} memos saved; ${failures.length} did not.`
        : `All ${unsaved_memos.length} memos are on the server.`,
      ...listed,
      ...already_there.slice(0, REPORTED_FAILURES),
      ...(rest > 0 ? [`and ${rest} more, see the journal`] : []),
    ].join("\n")
  );
};

const get_options: RequestInit = {
  credentials: "include",
  headers: {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    "X-Requested-With": "XMLHttpRequest",
    "x-organizator-client-version": "3",
  },
  method: "GET",
  mode: "cors",
};

const post_options: RequestInit = {
  credentials: "include",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Requested-With": "XMLHttpRequest",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    "x-organizator-client-version": "3",
  },
  method: "POST",
  mode: "cors",
};

export const read_memo = async (id: number): Promise<ServerMemoReply> => {
  konsole.log(`Fetching from server, memo`, id);
  const server_response = await fetch(
    `/organizator/memo/${id}?request.preventCache=${+new Date()}`,
    get_options
  );
  if (server_response.status === 200) {
    const json: ServerMemoReply = await server_response.json();
    if (!json.memo) {
      konsole.log(`Memo ${id} not found on server`);
    }
    return json;
  } else {
    konsole.error(
      "Failed to fetch from server, memo",
      id,
      server_response.status
    );
    // Thrown as the same kinds a failed save throws, so a caller can tell "the server would not"
    // from "this device could not", and so a session that has gone is recognised during a read
    // as well as during a write.
    if (server_response.status === 401) {
      throw new UnauthenticatedError(`No session while reading memo ${id}`);
    }
    throw new HttpError(server_response.status, `Failed to fetch memo ${id}`);
  }
};

/**
 * The memo titles the server holds for the reader.
 */
export const read_memo_titles = async (): Promise<MemoTitleListDTO> => {
  konsole.log(`Fetching the memo titles from the server`);
  const server_response = await fetch(
    `/organizator/memo/?request.preventCache=${+new Date()}`,
    get_options
  );
  if (server_response.status === 200) {
    return await server_response.json();
  }
  konsole.error("Failed to fetch memo titles, server status", server_response.status);
  if (server_response.status === 401) {
    throw new UnauthenticatedError(`No session while listing the memos`);
  }
  throw new HttpError(server_response.status, `Failed to list the memos`);
};

/**
 * The memo titles the reader has that match a full text search.
 */
export const search_memos = async (criteria: string): Promise<MemoTitleListDTO> => {
  konsole.log(`Searching the memos for 「${criteria}」`);
  const server_response = await fetch(
    `/organizator/memo/search?request.preventCache=${+new Date()}`,
    {
      ...post_options,
      body: `search=${encodeURIComponent(criteria)}`,
    }
  );
  if (server_response.status === 200) {
    return await server_response.json();
  }
  konsole.error("Failed to search the memos, server status", server_response.status);
  if (server_response.status === 401) {
    throw new UnauthenticatedError(`No session while searching the memos`);
  }
  throw new HttpError(server_response.status, `Failed to search the memos`);
};

/// What caching the whole library came to.
export interface CacheAllResult {
  cached: number;
  total: number;
  failures: string[];
}

/// How many memos are fetched at once. Each one is a request of its own, and a browser will only
/// open about six connections to a host, so asking for more than that queues here rather than
/// getting anything more done.
export const SIMULTANEOUS_FETCHES = 6;

/**
 * Fetch every memo the server has and write it into the local database, so the data is here
 * whether or not the server is.
 *
 * Each memo goes through save_memo_after_fetching_from_server, which is the strategy the rest of
 * the app uses: a memo that has changed on both sides is merged rather than one version being
 * dropped. That is the point of taking the whole library — anything edited here while offline
 * survives the trip back to the server.
 *
 * Several memos are in flight at once. One at a time cost a full round trip, a transaction on the
 * server and a transaction here for every memo, and with a library of any size that is the whole
 * of the time it takes; a memo depends on no other, so there is nothing to serialise.
 *
 * One memo failing does not abandon the rest, for the same reason a save-all does not: a refusal
 * or a fault for one says nothing about the next. A session that has gone does stop it, because
 * then none of them can be fetched.
 */
export const cache_all_memos = async (
  on_progress?: (done: number, total: number) => void
): Promise<CacheAllResult> => {
  const { memos } = await read_memo_titles();
  const failures: string[] = [];
  let done = 0;
  let next = 0;
  let session_gone: UnauthenticatedError | undefined;

  const fetch_memos = async (): Promise<void> => {
    while (!session_gone) {
      const index = next++;
      if (index >= memos.length) {
        return;
      }
      const memo = memos[index];

      try {
        const server_memo_reply = await read_memo(memo.id);
        await db.save_memo_after_fetching_from_server(server_memo_reply);
      } catch (e) {
        if (e instanceof UnauthenticatedError) {
          // Nothing more can be fetched, and the caller sends the reader to log in. The memos
          // already in flight or waiting here are left; they would only fail the same way.
          session_gone = e;
          return;
        }
        konsole.error(`cache_all_memos: memo ${memo.id} could not be cached`, e);
        failures.push(`memo ${memo.id}: ${describe_failure(e)}`);
      }
      done++;
      on_progress?.(done, memos.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SIMULTANEOUS_FETCHES, memos.length) }, fetch_memos)
  );

  if (session_gone) {
    throw session_gone;
  }

  konsole.log(`cache_all_memos: ${memos.length - failures.length} of ${memos.length} memos cached`);
  return { cached: memos.length - failures.length, total: memos.length, failures };
};

export const read_memo_groups = async (): Promise<IdName[]> => {
  try {
    const server_response = await fetch(
      `/organizator/memogroup/?request.preventCache=${+new Date()}`,
      get_options
    );
    if (server_response.status === 200) {
      const json = await server_response.json();
      const memogroups = json.memogroups;
      db.general_store_put("memogroups", memogroups);
      return memogroups;
    } else {
      konsole.error(
        "Failed to fetch memogroups, server status",
        server_response.status
      );
    }
  } catch (e) {
    konsole.log("Failed to fetch memogroups, error", e);
  }
  const stored_memogroups = await db.general_store_get("memogroups");
  if (stored_memogroups) {
    konsole.log("Serve memogroups cached in general store");
    return stored_memogroups;
  }
  throw {
    message: `Failed to fetch memogroups`,
  };
};

// FIXME: there is no difference between no permissions found and error fetching permissions
export const get_explicit_permission = async (memogroup_id: number): Promise<Undef<PermissionDetailLine[]>> => {
  try {
    const server_response = await fetch(
      `/organizator/explicit_permissions/${memogroup_id}?request.preventCache=${+new Date()}`,
      get_options
    );
    if (server_response.status === 200) {
      const explicit_permissions: ExplicitPermissions = await server_response.json();
      return explicit_permissions.permissions;
    }
  } catch (e) {
    konsole.log("Failed to fetch explicit permissions, error", e);
  }
}

export const upload_file = async (file_input: HTMLInputElement, memogroup_id: string): Promise<[Undef<string>, Undef<string>]> => {
  const formData = new FormData();
  const file = file_input.files?.[0]
  if (!file) {
    konsole.error(`nothing to upload`);
    return [undefined, undefined];
  }
  konsole.log(`uploading ${file.name}`);
  if (memogroup_id) {
    formData.append('memo_group_id', `${memogroup_id}`);
  }
  formData.append('myFile', file);
  formData.append('end_parameter', '2');

  const server_response = await fetch('/organizator/upload', {
    method: 'PUT',
    body: formData
  });

  if (server_response.status === 200) {
    const json = await server_response.json();
    const filename = json.file.filename;
    konsole.log(`Uploaded ${file.name} to server, received new id ${filename ? filename : JSON.stringify(json)}`);
    // remove the selected file
    // file_input.value = "";
    // if(file_input.files.length > 0) {
    //   konsole.error(`Failed to empty the file list`);
    // }

    return [filename, json.file.original_filename];
  } else {
    konsole.error(`Failed to upload file, server status: ${server_response.status}`);
    return [undefined, undefined];
  }
}

const get_generic = async <T>(url: string, context: string): Promise<T> => {
  let contextErrorMessage = `Failed to fetch ${context}`;
  try {
    const server_response = await fetch(
      `${url}?request.preventCache=${+new Date()}`,
      get_options
    );
    if (server_response.status === 200) {
      const json: T = await server_response.json();
      konsole.log(`Fetched ${context} from server`, json);
      // The only sucessful exit
      return json;
    } else {
      konsole.error(
        `${contextErrorMessage}, server status`,
        server_response.status
      );
      if (server_response.status >= 400) {
          contextErrorMessage = `${contextErrorMessage}, server status ${server_response.status}`;
      }
    }
  } catch (e) {
    konsole.error(`${contextErrorMessage}, error`, e);
  }
  throw {
    message: contextErrorMessage,
  };
}

export const get_filestore_diagnostics = async (): Promise<FileStoreDiagnostics> => 
  get_generic(
    "/organizator/admin/files",
    "filestore diagnostics",
  );

export const get_memo_stats = async (): Promise<MemoStats> => 
  get_generic(
    "/organizator/admin/memo_stats",
    "memo stats",
  );

export const get_all_user_groups = async (): Promise<UserGroupsPerUser[]> =>
  get_generic(
    "/organizator/admin/all_user_groups",
    "all user groups",
  );

export const get_user_groups = async (): Promise<UserGroups> =>
  get_generic(
    "/organizator/usergroups",
    "user groups",
  );
  
export const get_memo_groups = async (): Promise<MemoGroups> =>
  get_generic(
    "/organizator/memogroups",
    "memo groups",
  );