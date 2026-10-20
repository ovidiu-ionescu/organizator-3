// @ts-ignore
import {merge, diff as diff_wasm} from "../pkg/organizator_wasm.js";
/**
 * @prettier
 *
 * Handles various memo transformations
 */

import konsole from "./console_log.js";

/**
 * Common operations on memos
 */
import {
  AccessTime,
  CacheMemo,
  Memo,
  MemoStatus,
  MemoTitle,
  MemoTitleDTO,
  Nullable,
  ServerMemoReply,
  Undef,
} from "./memo_interfaces.js";

function XOR(a: any, b: any) {
  return (a || b) && !(a && b);
}

/**
 * Extracts the title from the memo text 
 * @param memo
 */
export const extract_title = (memo: Memo): string => {
  if(!memo) {
    return 'null memo';
  }
  if(!memo.text) {
    konsole.log("A degenerate memo", memo.id);
    return 'No title found';
  }
  return memo.text.split(/[\n\r]/)[0];
}

const MEMO_PROTOTYPE = {
  toString(this:Memo) {
    return `「memo ${this.id}: ${extract_title(this)}」`;
  }
}

export const make_server_memo_title = (
  cache_memo: CacheMemo
): MemoTitle => {
  const memo_group = cache_memo.local.memogroup;
  const group_id = memo_group && memo_group.id;
  const userId = cache_memo.local.user?.id;
  const text = cache_memo.local.text;
  let title = extract_title(cache_memo.local);
  let status: MemoStatus;
  if (cache_memo.id < 0) {
    status = MemoStatus.New
  } else {
    if(should_save_memo_to_server(cache_memo)) {
      status = MemoStatus.Dirty
    } else {
      status = MemoStatus.Cached
    }
  }
  return {
    group_id,
    id: cache_memo.id,
    title,
    userId,
    status: status
  };
};

/**
 * Change the structure returned by the server into the one used by the client
 * @param {ServerMemoReply} server_memo_reply
 */
export const server2local = (server_memo_reply: ServerMemoReply): Memo => {
  // rename savetime to timestamp for consistency

  const server_memo = server_memo_reply.memo;
  const text: string = `${server_memo.title}${server_memo.memotext}`
    .split("\r")
    .join("");
  const memo = Object.create(MEMO_PROTOTYPE);
  memo.id = server_memo.id;
  memo.text = text;
  memo.memogroup = server_memo.memogroup;
  memo.timestamp = server_memo.savetime || undefined;
  memo.user = server_memo.user;
  // A memo that arrives without an access level is one we were not told we may write, so treat
  // it as readable but not editable. The write path is the exception, and it knows better than
  // this function does — see save_memo_after_saving_to_server.
  memo.readonly = server_memo.access_level == null || server_memo.access_level < 2;

  // Who owns it, which is a different question from what the requester may do with it: a memo
  // shared at level 2 is writable by somebody who is not its owner, and only the owner may move
  // it to another group. The reply answers it by naming both sides.
  memo.owned = server_memo_reply.requester?.id === server_memo.user?.id;

  konsole.log(`Converted server result to local Memo: ${memo}`);
  return memo;
};

/**
 * Checks if two memos are equal
 * @param {Memo} memo1
 * @param {Memo} memo2
 */
export const equal = (memo1: Memo, memo2: Memo): boolean => {
  if (!memo1 || !memo2) {
    konsole.log(`equal: One of the memos is false`);
    return false;
  }
  if (memo1.text !== memo2.text) {
    konsole.log(
      `equal: Text content different between memo ${memo1.id} and ${memo2.id}`
    );
    return false;
  }

  if (memo1.id !== memo2.id) {
    konsole.log(
      `equal: Id is different between memo ${memo1.id} and ${memo2.id}`
    );
    return false;
  }

  if (XOR(memo1.memogroup, memo2.memogroup)) {
    return false;
  }

  if (
    memo1.memogroup &&
    memo2.memogroup &&
    memo1.memogroup.id != memo2.memogroup.id
  ) {
    return false;
  }

  // TODO: ownership could also change!
  return true;
};

/**
 * Checks if a memo has secret information in clear by looking for
 * Japanese quotes
 *
 * @param {Memo} memo
 */
export const memo_has_clear_secrets = (memo: Memo): boolean => {
  return memo.text.indexOf("\u300c") > -1;
};

/**
 * Determines if the first argument is a memo more recent than the second one
 */
export const first_more_recent = (first: Memo, second: Undef<Memo>): boolean => {
  if (!second?.timestamp) {
    return true;
  }
  if (!first.timestamp) {
    return false;
  }
  return first.timestamp > second.timestamp;
};

/**
 * A cache record for a memo that is being written here.
 *
 * A memo's positive id comes from the server: it is assigned when the memo is first saved, and
 * that reply is recorded as both halves at once (save_memo_after_saving_to_server). A positive
 * id with no cached server copy is therefore not a memo that has never been fetched — it is a
 * cache that has lost the record. There is no honest server half to build for it: claiming the
 * server holds this text can skip a save, and claiming there is no ancestor leaves the memo
 * looking unsent for ever. It is refused rather than guessed at.
 */
export const make_cache_memo = (
  memo: Memo,
  cache_memo?: CacheMemo
): CacheMemo => {
  if (memo.id < 0) {
    // new memo, not on the server yet
    return {
      id: memo.id,
      local: memo,
    };
  }

  if (!cache_memo?.server) {
    const msg = `memo ${memo.id} has a server id but the cache holds no server copy of it`;
    konsole.error(msg);
    throw new Error(msg);
  }

  // we update the local part in the cache
  return {
    id: memo.id,
    local: memo,
    server: cache_memo.server,
  };
};

/**
 * A record for a memo whose two halves agree: just fetched from the server, or just written to
 * it.
 *
 * Two fields holding equal values, never one object held twice. The local half is the one that
 * gets edited, and a memo edited through a shared object leaves the record looking as though the
 * server already had the change — which is how an edit stops being queued for saving.
 */
export const make_synced_cache_memo = (memo: Memo): CacheMemo => ({
  id: memo.id,
  local: memo,
  server: { ...memo },
});

const headerStartRegex = /^#+\s+/;

/**
 * Sort the title list putting the most recently accessed records on top
 * @param titles
 * @param access_times
 */
export const make_title_list = (
  titles: MemoTitle[],
  access_times: AccessTime[]
): MemoTitle[] => {
  const access_times_map: Record<number, number> = access_times.reduce(
    (a, t) => {
      a[t.id] = t.last_access;
      return a;
    },
    {}
  );
  if (!titles) {
    return [];
  }
  return titles
    .map((memo) => ({ ...memo, title: memo.title.split("\r").join("") }))
    .map((memo) => ({
      ...memo,
      title: memo.title.replace(headerStartRegex, ""),
    }))
    .map((memo) => ({
      ...memo,
      last_access: access_times_map[memo.id] || memo.id,
    }))
    .sort((a, b) => b.last_access - a.last_access);
};

// Clicking anywhere from the minus to the end square bracket toggles the checkbox
export const toggle_checkbox = (text: string, index: number): string | null => {
  const regex = /- \[([x ])]/g;
  let m: Nullable<RegExpExecArray>;
  while ((m = regex.exec(text))) {
    if (index >= m.index && index < m.index + m[0].length) {
      return (
        text.slice(0, m.index) +
        `- [${m[1] === " " ? "x" : " "}]` +
        text.slice(m.index + m[0].length)
      );
    }
  }
  return null;
};

/**
 * turns undefined into zero
 */
const to_zero = (u?: number) => {
  if(!u) return 0;
  return u;
}

/**
 * The memo text as this application stores it, which is the form the server gives back.
 *
 * Two differences creep in between what the reader typed and what comes back from the server:
 * carriage returns are stripped when a reply is read (see server2local), and the server trims
 * the start of the text when it writes it (split_and_trim). A client that kept its own form
 * therefore held a text the server would never hand back — one character longer, for a memo
 * pasted with Windows line endings — and every comparison of the two said the memo had been
 * edited, for ever, on a memo nobody had touched.
 *
 * Comparing in this form is also what predicts the next save: whatever this returns is what the
 * server will have after the memo is written.
 */
export const canonical_memo_text = (text: string): string =>
  text.replaceAll('\r', '').trimStart();

/**
 * Merge three versions of a memo: what both sides started from, what is here, what is there.
 */
export const merge_memo_text = (base: string, ours: string, theirs: string): string => {
  const merged = merge(base, ours, theirs);
  if(merged !== ours) {
    konsole.log(`we got changes from the server in the merge`);
  }
  return merged;
};

export const diff = (old: string, nou: string): string => {
  return diff_wasm(old, nou);
}

export const should_save_memo_to_server = (cache_memo: CacheMemo): boolean => {
  // no server correspondent, must be a new memo, save it
  if(!cache_memo.server) {
    return true;
  }
  // if the timestamp has not changed, do not save
  //const timestamp_changed = to_zero(cache_memo.local.timestamp) > to_zero(cache_memo.server.timestamp);
  //if(!timestamp_changed) return false;
  const text_differs =
    canonical_memo_text(cache_memo.server.text) !==
    canonical_memo_text(cache_memo.local.text);
  const group_differs =
    cache_memo.server.memogroup?.id !== cache_memo.local.memogroup?.id;
  const dirty = text_differs || group_differs;

  if (dirty) {
    // Which field the two halves disagree about, once per memo per page: a memo that was never
    // edited being called dirty is a record that has lost track of what the server holds, and
    // the answer to "lost track of what, exactly" is in these numbers.
    report_once(cache_memo.server.id, () =>
      konsole.error(
        `memo ${cache_memo.server?.id} is dirty` +
          `${cache_memo.server?.readonly ? " and readonly" : ""}: ` +
          `text ${cache_memo.server?.text.length} vs ${cache_memo.local.text.length} chars` +
          `${text_differs ? " (differs)" : ""}, ` +
          `group ${cache_memo.server?.memogroup?.id ?? "none"} vs ${cache_memo.local.memogroup?.id ?? "none"}` +
          `${group_differs ? " (differs)" : ""}, ` +
          `readonly ${cache_memo.server?.readonly} vs ${cache_memo.local.readonly}, ` +
          `savetime ${cache_memo.server?.timestamp ?? "none"} vs ${cache_memo.local.timestamp ?? "none"}`
      )
    );
  }

  if(dirty && cache_memo.server.readonly) {
    // A memo this device may not write cannot have been edited here, so a disagreement about it
    // is the record's fault and not the reader's: it is reported rather than queued.
    return false;
  }
  return dirty;
}

/// Memos already reported by `report_once`, so the console says it once and not on every redraw.
const reported = new Set<number>();

const report_once = (id: number, report: () => void) => {
  if (reported.has(id)) {
    return;
  }
  reported.add(id);
  report();
};

/**
 * Make a list of memo titles from cached memos. Useful to show what is in cache
 * and what is not saved
 * @param cache_memos 
 */
export const cache_memos_to_server_titles = (cache_memos: CacheMemo[]): MemoTitle[] =>
  cache_memos.map(make_server_memo_title);

export const memo_title_dto_to_memo_title = (dto: MemoTitleDTO, requester_id: number): MemoTitle =>
    ({
    id: dto.id,
    title: dto.title,
    group_id: undefined,
    userId: dto.user_id,
    status: dto.user_id === requester_id ? MemoStatus.Server : MemoStatus.Shared,
  })