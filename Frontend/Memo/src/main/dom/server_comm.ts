/**
 * @prettier
 *
 * Handles the interaction with the server
 */
import konsole from "./console_log.js";
import * as db from "./memo_db.js";
import {
  Memo,
  MemoStats,
  ServerMemo,
  CacheMemo,
  PasswordThen,
  IdName,
  ServerMemoTitle,
  ServerMemoReply,
  PermissionDetailLine,
  ExplicitPermissions,
  FileStoreDiagnostics,
  UserGroupsPerUser,
} from "./memo_interfaces.js";
import * as events from "./events.js";
import { merge } from "./diff_match_patch_uncompressed.js";
import * as memo_processing from "./memo_processing.js";
import { MemoEditor } from "./memo-editor.js";

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

  if (response.status === 200) {
    const responseJson = await response.json();
    return responseJson;
  } else {
    konsole.log(
      `Save to server failed for memo ${memoId} with status ${response.status}`
    );
    throw new Error(`Save failed with status ${response.status}`);
  }
};

export const save_all = async () => {
  const unsaved_memos = await db.unsaved_memos();
  if (unsaved_memos.length) {
    events.save_all_status(events.SaveAllStatus.Processing);
  }
  // konsole.log({unsaved_memos});
  // save to server and get the server instance
  for (let memo: CacheMemo; (memo = unsaved_memos.pop());) {
    const id = memo.id;
    if (memo.id > -1) {
      // this is an existing memo, might have changed on the server since we got it
      const server_memo_reply = await read_memo(id);
      const server_memo = server_memo_reply.memo;
      if (!server_memo && !memo.local.text) {
        konsole.log(
          `The memo ${memo.id} is not present on the server and has no local content, delete it`
        );
        db.delete_memo(memo.id);
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
        const text = merge(memo.server.text, memo.local.text, remote_memo.text);
        memo.local.text = text;

        // if this is loaded in the current editor we need to swap in the new text
        const editor = <MemoEditor>document.getElementById("editor");
        if (editor.memoId === memo.id) {
          konsole.log(
            `Load into the editor the merged result for memo ${memo.id}`
          );
          editor.set_memo(memo.local);
        }
        // events.save_all_status(events.SaveAllStatus.Failed);
        // throw `Time conflict saving memo ${memo.id}`;
      }
    } else {
      if (!memo.local.text) {
        konsole.log(`New memo ${memo.id} has no content, delete it`);
        db.delete_memo(memo.id);
        continue;
      }
    }

    const server_memo = await save_to_server(memo.local);
    db.save_memo_after_saving_to_server(id, server_memo);
  }

  // .map(async memo => ({
  //   id:          memo.id,
  //   server_memo: await server_comm.save_to_server(memo.local)
  // }))
  // remove the old memo and save the new one into local cache
  // .forEach(async m => {
  //   const memo = await m;
  //   if(memo.id < 0) {
  //     db.delete_memo(id);
  //   }
  //   db.saveMemoAfterSavingToServer(memo.server_memo);
  // });

  events.save_all_status(events.SaveAllStatus.Success);
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
    throw {
      errorCode: server_response.status,
      message: `Failed to fetch memo ${id}`,
    };
  }
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
export const get_explicit_permission = async (memogroup_id: number): Promise<PermissionDetailLine[]> => {
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

export const upload_file = async (file_input: HTMLInputElement, memogroup_id: string): Promise<[String, String]> => {
  const formData = new FormData();
  const file = file_input.files[0];
  if (!file) {
    konsole.error(`nothing to upload`);
    return;
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
    return;
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