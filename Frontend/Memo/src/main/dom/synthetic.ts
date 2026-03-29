/**
 * @prettier
 *
 * Implements rendering various synthetic memos, usually for diagnose and statistics
 */
import * as server_comm from "./server_comm.js";
import { alignedText } from "./util.js"
import * as db from "./memo_db.js";
import { extract_title } from "./memo_processing.js";
import {Undef} from "./memo_interfaces";

const create_filestore_diagnostics = async () => {
  const diagnostics = await server_comm.get_filestore_diagnostics();
  return alignedText`
    # Filestore Diagnostics
    ## Database Only
    Database entries with no corresponding file on disk
     
    |Filename|Database Id|Time Uploaded|
    |:---|:---|:---|
    ${diagnostics.filestore.db_only.map((entry) =>
    `|${entry.filename}|${entry.id}|${new Date(entry.uploaded_on)}|`
  ).join('\n')}
    
    ## File System Only
    File system entries with no corresponding database entry
    ${diagnostics.filestore.dir_only.map((entry) => `- ${entry.filename}`).join('\n')}`;
}

const create_memo_stats = async () => {
  const stats = await server_comm.get_memo_stats();
  return alignedText`
    # Memo Statistics
    ## Grouped per User

    |User Id|User|Total|Shared|
    |---:|:---|---:|---:|
    ${stats.data.map((entry) =>
    `|${entry.user_id}|${entry.username}|${entry.total}|${entry.shared}|`
  ).join('\n')}

    ## Total Memo Count: ${String(stats.total)}
    `;
}

const create_dirty_memos = async () => {
  const memos = await db.unsaved_memos();
  return alignedText`
    # Dirty Memos
    ## Memos with unsaved changes

    |Id|Title|Last Modified|
    |:---|:---|:---|
    ${memos.map((memo) =>
    `|[${memo.id}](/memo/${memo.id})|${extract_title(memo.local)}|${memo.local.timestamp? new Date(memo.local.timestamp) : ""}|`
  ).join('\n')}
    `;
}

const create_new_memos = async () => {
  const memos = await db.get_new_memos();
  return alignedText`
    # New Memos
    ## Memos not yet uploaded

    |Id|Title|Last Modified|
    |:---|:---|:---|
    ${memos.map((memo) =>
    `|${memo.id}|${memo.title}|${new Date()}|`
  ).join('\n')}
    `;
}

const create_cached_memos = async () => {
  const memos = await db.get_all_memos();
  return alignedText`
    # Cached Memos
    ## Memos that are cached in the database
    |Id|Title|Last Modified|
    |:---|:---|:---|
    ${memos.map((memo) =>
    `|${memo.id}|${memo.title}|${new Date()}|`
  ).join('\n')}
    `;
}

const all_user_groups = async () => {
  const groups_per_users = await server_comm.get_all_user_groups();
  
  const result: string[] = [];
  result.push("# All User Groups");
  groups_per_users.map((groups_per_user) => {
    result.push(`- ${groups_per_user.owner.name}`)
    groups_per_user.groups.map((group) => {
      result.push(`  - ${group.name}`);
      group.users.map((user) => {
        result.push(`    - ${user.name}`);
      });
    });
  });
  return result.join('\n');
}

const create_user_groups = async () => {
  const usergroups = await server_comm.get_user_groups();
  
  const result: string[] = [];
  result.push(`# User Groups of User ${usergroups.requester.name}`);
  usergroups.usergroups.map((group) => {
    result.push(`- ${group.name}`)
    group.users.map((user) => {
      result.push(`  - ${user.name}`);
    });
  });
  return result.join('\n');
}

const create_memo_groups = async () => {
  const memogroups = await server_comm.get_memo_groups();
  const result: string[] = [];
  result.push(`# Memo Groups of User ${memogroups.requester.name}`);
  memogroups.memogroups.map((group) => {
    result.push(`- ${group.name}`);
    group.usergroups.map((usergroup) => {
      result.push(`  - ${usergroup.name} (access: ${usergroup.access})`);
      usergroup.users.map((user) => {
        result.push(`    - ${user.name}`);
      });
    });
  });
  return result.join('\n');
}

export const create_synthetic_memo = async (id: string): Promise<Undef<string>> => {
  try {
    switch (id) {
      case "$$$filestore": return await create_filestore_diagnostics();
      case "$$$memo_stats": return await create_memo_stats();
      case "$$$dirty_memos": return await create_dirty_memos();
      case "$$$new_memos": return await create_new_memos();
      case "$$$cached_memos": return await create_cached_memos();
      case "$$$all_user_groups": return await all_user_groups();
      case "$$$user_groups": return await create_user_groups();
      case "$$$memo_groups": return await create_memo_groups();
    }
  } catch (e: any) {
    return e.message;
  }
}
