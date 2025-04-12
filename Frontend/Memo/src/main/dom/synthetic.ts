/**
 * @prettier
 *
 * Implements rendering various synthetic memos, usually for diagnose and statistics
 */
import * as server_comm from "./server_comm.js";
import { alignedText } from "./util.js"

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

    |User|User Id|Total|Shared|
    |:---|---:|---:|---:|
    ${stats.data.map((entry) =>
    `|${entry.username}|${entry.user_id}|${entry.total}|${entry.shared}|`
    ).join('\n')}

    ## Total Memo Count: ${String(stats.total)}
    `;
}
 
export const create_synthetic_memo = async (id: string): Promise<string> => {
  try {
    switch (id) {
      case "$$$filestore": return await create_filestore_diagnostics();
      case "$$$memo_stats": return await create_memo_stats();
    }
  } catch (e) {
    return e.message;
  }
}
