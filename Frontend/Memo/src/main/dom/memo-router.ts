/**
 * @prettier
 *
 * Implements the router for the OPA
 */

import {
  Memo,
  ServerMemo,
  CacheMemo,
  PasswordThen,
  ServerMemoTitle,
  ServerMemoList,
} from "./memo_interfaces.js";
import { MemoEditor } from "./memo-editor.js";
import * as db from "./memo_db.js";
import * as memo_processing from "./memo_processing.js";
import konsole from "./console_log.js";
import * as server_comm from "./server_comm.js";
import * as events from "./events.js";
import { create_synthetic_memo } from "./synthetic.js";

const local_prefixes = ["/memo/", "/journal"];
const routerInterceptor = (evt) => {
  // konsole.log('Router interceptor, got event', evt);
  // check if we are trying to navigate via a href
  const target = evt.target;
  // console.log(target);
  if (target.nodeName.toLowerCase() === "a") {
    // is it local ?
    const match = local_prefixes.find((pref) =>
      target.pathname.startsWith(pref)
    );
    if (match) {
      konsole.log(new Date().toIsoString(), `history pushstate ${target.href}`);
      history.pushState(null, null, target.href);
      konsole.log("<hr>");
      evt.preventDefault();
      evt.stopPropagation();

      load_route();
    }
  }
};

export const navigate = (evt: CustomEvent) => {
  const dest = evt.detail;
  konsole.log(new Date().toIsoString(), "Received event to navigate to", dest);
  history.pushState(null, null, `${dest}`);
  konsole.log("<hr>");
  load_route();
};

let AFTER_LOGIN = true;

export const load_route = () => {
  konsole.log(`route loader`, document.location.pathname);

  // check if we got here from login
  if (document.referrer) {
    const url = new URL(document.referrer);
    if (url.pathname === "/login.html" && AFTER_LOGIN) {
      konsole.log("Coming from login, save everything");
      AFTER_LOGIN = false;
      server_comm.save_all();
    }
  }

  if (window.location.pathname.match(/\/memo\/(-?\d+)/)) {
    activatePage("singleMemo");
    loadMemo();
    return;
  }
  const synthetic_match = window.location.pathname.match(/\/memo\/(\${3}.+)/);
  if (synthetic_match) {
    const id = synthetic_match[1];
    activatePage("singleMemo");
    display_synthetic_memo(id);
    return;
  }
  if (window.location.pathname.match(/\/memo\/new/)) {
    activatePage("singleMemo");
    const editor = <MemoEditor>document.getElementById("editor");
    editor.new_memo();

    return;
  }
  if (window.location.pathname === "/memo/") {
    activatePage("memoTitles");
    loadMemoTitles();
    return;
  }
  if (window.location.pathname === "/memo/search") {
    activatePage("memoTitles");
    searchMemos();
  }

  if (window.location.pathname === "/journal") {
    activatePage("journal");
  }
};

/**
 * Makes the name element visible and hides all others
 * @param {string} name
 */
const activatePage = (name: string) => {
  konsole.log("Activate page", name);
  [...document.querySelectorAll("[page]")].forEach((art: HTMLElement) => {
    art.style.display = art.id === name ? "" : "none";
  });

  // tell the page to activate
  const active: any = document.getElementById(name);
  if (active && active.activate) {
    active.activate();
  }
};

document.addEventListener("click", routerInterceptor);
window.addEventListener("popstate", () => {
  load_route();
});
document.addEventListener(events.NAVIGATE, navigate);

const options: RequestInit = {
  credentials: "include",
  headers: {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    "X-Requested-With": "XMLHttpRequest",
    "x-organizator-client-version": "3",
  },
  referrer: "https://ionescu.net/organizator/2/memo.html",
  method: "GET",
  mode: "cors",
};

const postOptions: RequestInit = {
  credentials: "include",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-Requested-With": "XMLHttpRequest",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
  },
  referrer: "https://ionescu.net/organizator/2/memo.html",
  method: "POST",
  mode: "cors",
};

/**
 * Fetches the memo in the url from local storage and server
 */
async function loadMemo() {
  set_status_in_editor(`# Loading...`);

  const path = window.location.pathname;
  //console.log(path);
  const m = path.match(/\/memo\/(-?\d+)/);
  const id = m[1];
  konsole.log("check local storage for memo", id);
  const memo = await db.read_memo(parseInt(id));
  konsole.log(`Fetched memo from local storage ${id}`, memo);
  if (memo) {
    set_memo_in_editor(memo);
  } else {
    konsole.log("Failed to get memo from local storage", id);
  }

  if (parseInt(id) < 0) {
    konsole.log("Memo ${id} is new, not fetching from server");
    return;
  }
  const response = await fetch(
    `/organizator/memo/${id}?request.preventCache=${+new Date()}`,
    options
  );
  if (response.status === 401) {
    // more info at https://www.w3schools.com/howto/howto_js_redirect_webpage.asp
    window.location.replace(`/login.html?r=${encodeURIComponent(window.location.href)}`);
    return;
  } else if (response.status === 200) {
    const json = await response.json();
    if (!json.memo) {
      konsole.log(`memo ${id} does not exist on server`);
      set_status_in_editor(`# No memo ${id} on server`);
    } else {
      const memo = await db.save_memo_after_fetching_from_server(json);
      set_memo_in_editor(memo);
    }
  }

  /*
console.log(response);
const reader = response.body.getReader();
const chunk = await reader.read();
console.log(chunk);
const text = new TextDecoder("utf-8").decode(chunk.value);
console.log(text);
*/
}

async function display_synthetic_memo(id: string) {
  set_status_in_editor(`# Loading...`);
  set_status_in_editor(await create_synthetic_memo(id));
  //const memo = {text: `# This is a synthetic memo\nSynthetic body`} as Memo;
  //set_memo_in_editor(memo);
}

async function set_memo_in_editor(memo: Memo) {
  const editor = <MemoEditor>document.getElementById("editor");
  editor.set_memo(memo);
}

function set_status_in_editor(text: string) {
  const editor = <MemoEditor>document.getElementById("editor");
  editor.show_status(text);
}

/**
 * Fetches all memo titles from the server
 * @param {*} force_reload if false just keep the current list
 */
async function loadMemoTitles(force_reload?: boolean) {
  if (!force_reload) {
    const dest = document.getElementById("memoTitlesList");
    if (dest.firstChild) {
      return;
    }
  }
  try {
    const response = await fetch(
      `/organizator/memo/?request.preventCache=${+new Date()}`,
      options
    );
    if (response.status === 401) {
      // more info at https://www.w3schools.com/howto/howto_js_redirect_webpage.asp
      window.location.replace(`/login.html?r=${encodeURIComponent(window.location.href)}`);
      return;
    } else if (response.status === 200) {
      const responseJson = await response.json();
      const new_memos = await db.get_new_memos();
      responseJson.memos = [...new_memos, ...responseJson.memos];
      await db.general_store_put("user", responseJson.user);
      displayMemoTitles(responseJson, false, false);
      //console.log(responseJson);
      return;
    } else {
      konsole.error(
        "Failed to fetch memo list, server status",
        response.status
      );
    }
  } catch (e) {
    konsole.error("Failed to fetch memo list", e);
  }
  konsole.log("Get all memos from indexedDB");
  displayMemoTitles(
    {
      memo: await db.general_store_get("user"),
      memos: await db.get_all_memos(),
    },
    false,
    false
  );
}

const headerStartRegex = /^#+\s+/;

const make_memotitle_link_id = (id: number): string => `memo_title_link_${id}`;

/**
 * Renders the list of memo titles in the DOM
 * @param {ServerMemoList} responseJson
 * @param auto_open if the list has only one element then open it in the editor immediately
 */
const displayMemoTitles = async (
  responseJson: ServerMemoList,
  auto_open: boolean,
  extra_info: boolean
) => {
  const dest = document.getElementById("memoTitlesList");
  dest.innerText = "";

  memo_processing
    .make_title_list(responseJson.memos, await db.access_times())
    .map((memo) => {
      const a = document.createElement("a");
      a.style.display = "block";
      a.href = `/memo/${memo.id}`;
      if (extra_info) {
        a.innerText = `${memo.title} #${memo.id} u:${memo.userId || ''} g:${memo.group_id || ''}`;
      } else {
        a.innerText = memo.title;
      }
      a.id = make_memotitle_link_id(memo.id);
      return a;
    })
    .forEach((memo) => {
      dest.appendChild(memo);
    });

  if (dest.childElementCount === 1 && auto_open) {
    dest.firstElementChild.dispatchEvent(
      new CustomEvent("click", { bubbles: true })
    );
  }
};

document.addEventListener(events.MEMO_DELETED, (evt: CustomEvent) => {
  // if the memo was deleted then remove it from the list
  const memo_link_id = make_memotitle_link_id(evt.detail);
  const link = document.getElementById(memo_link_id);
  if (link) {
    konsole.log(
      `Got ${events.MEMO_DELETED} event, remove link ${memo_link_id}`
    );
    link.parentNode.removeChild(link);
  }
});

/**
 * Do a search on the server. If no criteria is present just fetch all titles
 */
export async function searchMemos() {
  const criteria = (<HTMLInputElement>document.getElementById("searchCriteria")).value;
  if (!criteria) {
    konsole.log("No criteria supplied, just fetch everything");
    return loadMemoTitles(true);
  }

  switch (criteria) {
    case "$$$drop local cache":
      window.indexedDB.deleteDatabase(db.DBName);
      return;

    case "$$$show dirty memos":
      displayMemoTitles({ memo: null, memos: memo_processing.cache_memos_to_server_titles(await db.unsaved_memos()) }, false, true);
      return;

    case "$$$show new memos":
      displayMemoTitles({ memo: null, memos: await db.get_new_memos() }, false, true);
      return;

    case "$$$show cached memos":
      displayMemoTitles({ memo: null, memos: await db.get_all_memos() }, false, true);
      return;
  }

  const p1 = criteria.match(/^\$\$\$drop memo (-?\d+)$/);
  if (p1) {
    db.delete_memo(parseInt(p1[1]));
    displayMemoTitles({ memo: null, memos: memo_processing.cache_memos_to_server_titles(await db.unsaved_memos()) }, false, true);
    return;
  }

  const response = await fetch(
    `/organizator/memo/search?request.preventCache=${+new Date()}`,
    {
      ...postOptions,
      body: `search=${encodeURIComponent(criteria)}`,
    }
  );
  const responseJson = await response.json();
  displayMemoTitles(responseJson, true, false);
  //console.log(responseJson);
}
