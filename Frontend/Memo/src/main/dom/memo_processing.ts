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
  Memo,
  ServerMemo,
  ServerMemoReply,
  CacheMemo,
  ServerMemoTitle,
  AccessTime,
  IdName,
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
  return memo.text.split(/\n|\r/)[0];
}

const MEMO_PROTOTYPE = {
  toString() {
    return `「memo ${this.id}: ${extract_title(this)}」`;
  }
}

export const make_server_memo_title = (
  cache_memo: CacheMemo
): ServerMemoTitle => {
  const memo_group = cache_memo.local.memogroup;
  const group_id = memo_group && memo_group.id;
  const userId = cache_memo.local.user && cache_memo.local.user.id;
  const text = cache_memo.local.text;
  let title = extract_title(cache_memo.local);
  const result = {
    group_id,
    id: cache_memo.id,
    title,
    userId,
  };
  return result;
};

/**
 * Change the structure returned by the server into the one used by the client
 * @param {ServerMemo} server_memo
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
  memo.readonly = server_memo.user.id !== server_memo_reply.requester.id;

  konsole.log(`OI: ${memo}`);
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
export const first_more_recent = (first: Memo, second: Memo): boolean => {
  if (!first) {
    return false;
  }
  if (!second.timestamp) {
    return true;
  }
  return first.timestamp > second.timestamp;
};

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

  if (!cache_memo) {
    return {
      id: memo.id,
      local: memo,
      server: memo,
    };
  } else {
    // we update the local part in the cache
    return {
      id: memo.id,
      local: memo,
      server: cache_memo.server,
    };
  }
};

const headerStartRegex = /^#+\s+/;

/**
 * Sort the title list putting the most recently accessed records on top
 * @param titles
 * @param access_times
 */
export const make_title_list = (
  titles: ServerMemoTitle[],
  access_times: AccessTime[]
): ServerMemoTitle[] => {
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

export const toggle_checkbox = (text: string, index: number): string => {
  const regex = /- \[(x| )\]/g;
  let m: RegExpExecArray;
  while ((m = regex.exec(text))) {
    if (index >= m.index && index < m.index + m[0].length) {
      return (
        text.slice(0, m.index) +
        `- [${m[1] === " " ? "x" : " "}]` +
        text.slice(m.index + m[0].length)
      );
    }
  }
};

/**
 * turns undefined into zero
 */
const to_zero = (u?: number) => {
  if(!u) return 0;
  return u;
}

export const should_save_memo_to_server = (cache_memo: CacheMemo): boolean => {
  // no server correspondent, must be a new memo, save it
  if(!cache_memo.server) {
    return true;
  }
  if(to_zero(cache_memo.local.timestamp) > to_zero(cache_memo.server.timestamp)) return true;
  return false;
}

/**
 * Make a list of memo titles from cached memos. Useful to show what is in cache
 * and what is not saved
 * @param cache_memos 
 */
export const cache_memos_to_server_titles = (cache_memos: CacheMemo[]): ServerMemoTitle[] =>
  cache_memos.map(make_server_memo_title);
