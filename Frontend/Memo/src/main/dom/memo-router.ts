/**
 * @prettier
 *
 * Implements the router for the OPA
 */

import {CacheMemo, Memo, MemoStatus, MemoTitle, MemoTitleListDTO,} from "./memo_interfaces.js";
import {MemoEditor} from "./memo-editor.js";
import * as db from "./memo_db.js";
import * as memo_processing from "./memo_processing.js";
import {memo_title_dto_to_memo_title} from "./memo_processing.js";
import konsole from "./console_log.js";
import * as server_comm from "./server_comm.js";
import {create_synthetic_memo} from "./synthetic.js";
import {raspandac} from "./events.js";
import {failure_message, fold} from "./util.js";
import {ask_confirmation} from "./confirm.js";

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
      history.pushState(null, "", target.href);
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
  history.pushState(null, "", `${dest}`);
  konsole.log("<hr>");
  load_route();
};

let AFTER_LOGIN = true;

export const load_route = () => {
  konsole.log(`route loader`, `「${document.location.pathname}」`);

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
  // With and without the trailing slash: nginx redirects the bare one, but the service worker
  // answers it from the precache when there is no server to redirect (its clean-URL handling
  // finds /memo.html for it), and the app has to know what to do with what it is handed.
  if (window.location.pathname === "/memo/" || window.location.pathname === "/memo") {
    activatePage("memoTitles");
    loadMemoTitles();
    return;
  }
  if (window.location.pathname === "/memo/search") {
    activatePage("memoTitles");
    searchMemos();
    return;
  }
  if (window.location.pathname === "/journal") {
    activatePage("journal");
    return;
  }

  konsole.error('load_route found no match to activate')
};

/**
 * Makes the name element visible and hides all others
 * @param {string} name
 */
const activatePage = (name: string) => {
  konsole.log("Activate page", name);
  [...document.querySelectorAll("[page]")].forEach((art: Element) => {
    (art as HTMLElement).style.display = art.id === name ? "" : "none";
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
raspandac.on("navigate", navigate);

/**
 * Fetches the memo in the url from local storage and server
 */
async function loadMemo() {
  set_status_in_editor(`# Loading...`);

  const path = window.location.pathname;
  //console.log(path);
  const m = path.match(/\/memo\/(-?\d+)/);
  if(!m) {
    konsole.log("No memo id in the path");
    return;
  }
  const id = m[1];
  konsole.log("check local storage for memo", id);
  let local_memo: Memo | null = null;
  try {
    local_memo = await db.read_memo(parseInt(id));
  } catch (e) {
    // This device's copy could not be read at all. The memo may still be on the server, so the
    // fetch below is still tried; what is not done is leaving the page on "Loading..." because a
    // rejected promise went nowhere.
    konsole.error(`Could not read memo ${id} from this device`, e);
    set_status_in_editor(`# Could not read this device's copy of memo ${id}`);
  }
  konsole.log(`Fetched memo from local storage ${id}`, local_memo);
  if (local_memo) {
    await set_memo_in_editor(local_memo, true);
  } else {
    konsole.log("Failed to get memo from local storage", id);
    if (parseInt(id) < 0) {
      // A new memo that is not on this device. Its id came from somewhere else — another device,
      // or a list drawn before this device's copy was dropped — and there is nowhere to fetch it
      // from, so say so rather than leaving the page on "# Loading..." for ever.
      set_status_in_editor(`# No memo ${id} on this device`);
      return;
    }
  }

  if (parseInt(id) < 0) {
    konsole.log("Memo ${id} is new, not fetching from server");
    return;
  }
  try {
    const reply = await server_comm.read_memo(parseInt(id));
    if (!reply.memo) {
      konsole.log(`memo ${id} does not exist on server`);
      set_status_in_editor(`# No memo ${id} on server`);
    } else {
      const memo = await db.save_memo_after_fetching_from_server(reply);
      await set_memo_in_editor(memo, false);
    }
  } catch (e) {
    if (e instanceof server_comm.UnauthenticatedError) {
      // more info at https://www.w3schools.com/howto/howto_js_redirect_webpage.asp
      window.location.replace(`/login.html?r=${encodeURIComponent(window.location.href)}`);
      return;
    }
    const message = e instanceof server_comm.HttpError
      ? failure_message(e.status, `memo ${id}`)
      : `# Could not reach the server for memo ${id}`;
    konsole.error(message, e);
    // A cached copy already on screen stays there: it is what the user came for, and the memo
    // is perfectly usable from the cache. Replacing it with the error would take the screen
    // away to report a server problem.
    if (!local_memo) {
      set_status_in_editor(message);
    }
  }
}

async function display_synthetic_memo(id: string) {
  set_status_in_editor(`# Loading...`);
  set_status_in_editor(await create_synthetic_memo(id) ?? "# No synthetic content created");
  //const memo = {text: `# This is a synthetic memo\nSynthetic body`} as Memo;
  //set_memo_in_editor(memo);
}

async function set_memo_in_editor(memo: Memo, from_local: boolean) {
  const editor = <MemoEditor>document.getElementById("editor");
  await editor.set_memo(memo, from_local);
}

function set_status_in_editor(text: string) {
  const editor = <MemoEditor>document.getElementById("editor");
  editor.show_status(text);
}

/// Which list the titles page is currently showing. A search is answered by the server only
/// while the list on screen came from the server; once we have fallen back to the local
/// database, the server is the thing that just failed us and the cached memos are all we have.
let list_is_local = false;

/// The list as the server gave it, kept so that coming back to the page can redraw the markers
/// without asking the server again. The local statuses are overlaid at render time and never
/// stored here: a memo that has since been saved has to be able to go back to what the server
/// said about it.
let titles_from_server: MemoTitle[] = [];

/// The hits of the search the list on screen is showing, if it is showing one. The hits
/// themselves, not the criteria they came from: a reader working through a search opens one memo
/// after another and comes back to the list between them, and a list that is asked for again each
/// time moves under them — memos drop in and out as they are edited, and the one they were about
/// to open is somewhere else.
let search_hits: MemoTitle[] | undefined = undefined;

/**
 * Mark the memos this device knows are not on the server yet: new ones, and ones edited here
 * since they were last fetched.
 *
 * The server's own list cannot know either — it has never seen the change — which is why the
 * markers it produces are overlaid with these. Only these: a memo that is in step keeps whatever
 * the server said about it, so a memo living on the server still reads as one.
 */
const with_local_statuses = async (titles: MemoTitle[]): Promise<MemoTitle[]> => {
  const unsynced = new Map<number, MemoStatus>();
  for (const memo of await db.get_all_memos()) {
    if (memo.status === MemoStatus.New || memo.status === MemoStatus.Dirty) {
      unsynced.set(memo.id, memo.status);
    }
  }
  return titles.map((title) => {
    const status = unsynced.get(title.id);
    return status ? { ...title, status } : title;
  });
};

/**
 * Headline the title list with where it came from, and why, when that needs explaining.
 *
 * The list can be long enough that a standing banner costs more room than the message is worth,
 * so the detail sits behind a `<summary>` the reader can fold away. It opens itself when the
 * message changes to something worth reading, and never re-opens one the reader has closed.
 */
const show_list_info = (summary: string, message: string = "") => {
  const info = document.getElementById("titles_info") as HTMLDetailsElement | null;
  const summary_el = document.getElementById("titles_info_summary");
  const message_el = document.getElementById("titles_info_message");
  if (!info || !summary_el || !message_el) {
    konsole.error("The titles page has no titles_info elements to write the status into");
    return;
  }
  summary_el.innerText = summary;
  // The load-path messages are written the way the editor wants them, as markdown for it to
  // render. Here they are shown as they are, so a leading heading marker is just noise.
  const text = message.replace(/^#\s+/, "");
  if (message_el.innerText !== text) {
    message_el.innerText = text;
    info.open = text !== "";
  }
};

/**
 * How to name a number of memos in a sentence without saying "1 memos".
 */
const describe_memos = (memos: CacheMemo[]): string =>
  memos.length === 1 ? "the memo written here" : `${memos.length} memos written here`;

/// How many of the memos in a warning are named before the rest are counted.
const NAMED_IN_WARNING = 8;

/**
 * The memos as the reader knows them: a memo's title is the first line of its text, and a memo
 * that has never been saved has no other name.
 */
const titles_of = (memos: CacheMemo[]): string[] => {
  const named = memos
    .slice(0, NAMED_IN_WARNING)
    .map((memo) => `• ${(memo.local?.text ?? "").split("\n")[0] || "(empty memo)"}`);
  const rest = memos.length - named.length;
  return rest > 0 ? [...named, `• and ${rest} more`] : named;
};

/**
 * Offer, or stop offering, to fetch the whole library into this device.
 *
 * The offer belongs to the server's list. It means "take everything the server has, so this
 * device still works without it", which is a sensible thing to ask for while the server is the
 * one answering and a pointless one when the list on screen is the local fallback: the server
 * has just failed us, so there is nothing to fetch from, and what it would fetch is already
 * here. It is also withdrawn once a run finishes, since the run either left the library here or
 * said why it could not.
 */
const show_cache_all = (offer: boolean) => {
  const button = document.getElementById("cache_all");
  if (button) {
    button.hidden = !offer;
  }
};

/**
 * Full-text search over the memos cached on this device.
 *
 * With no server to ask, the cached copies are all there is. Their bodies are in the database,
 * so the match runs over the whole of `local.text` rather than over the title line the list
 * displays. Unlike the server this is a plain substring match: no stemming, no word boundaries,
 * so a search finds a fragment anywhere in a memo where the server would only match whole
 * lexemes.
 */
const search_local_memos = async (criteria: string): Promise<MemoTitle[]> => {
  const needle = fold(criteria.trim());
  const matching = (await db.cached_memos()).filter((cache_memo) =>
    // A record without text is not worth failing the whole search over.
    fold(cache_memo.local?.text ?? "").includes(needle)
  );
  konsole.log(`Local search for 「${criteria}」 matched ${matching.length} memos`);
  return memo_processing.cache_memos_to_server_titles(matching);
};

/**
 * Put the list back as the page has it.
 *
 * Coming back to the list from a memo used to put the whole list there, whatever had been asked
 * for. But the criteria is still in the search box, and a reader who searched and then opened one
 * of the hits comes back to those hits, not to everything: the list has to be the one the box
 * describes. So the hits are drawn again — the same ones, in the same order, because the reader
 * is working through them and a list that changes under them is a list they have to search
 * again. Only when there is no search does the page fall back to the whole list, from the server
 * or from this device.
 */
const redraw_titles = async () => {
  if (search_hits !== undefined) {
    displayMemoTitles(await with_local_statuses(search_hits), false, false);
  } else if (list_is_local) {
    displayMemoTitles(await db.get_all_memos(), false, false);
  } else {
    // The server's list is a snapshot of when it was fetched, and memos have been written here
    // since: those belong in it, and the ones that were only ever here — never sent, and gone
    // now that the cache has been dropped — do not.
    const written_here = await db.get_new_memos();
    const still_on_the_server = titles_from_server.filter((title) => title.id > 0);
    displayMemoTitles(await with_local_statuses([...written_here, ...still_on_the_server]), false, false);
  }
};

/// The redraw in flight, if there is one.
let redraw_in_flight: Promise<void> = Promise.resolve();

/**
 * Redraw the list, after any redraw already under way.
 *
 * Two can be asked for at once — the reader arriving at the list, and a memo being written to
 * this device a moment later — and each of them reads the database and then draws, with a pause
 * in between. Left alone, the one that started first can be the one that finishes last and puts
 * back what it read before the save, which is how a memo edited and left behind went on looking
 * untouched. Chained, the last asked for is the last drawn.
 */
const redraw_soon = (): Promise<void> => {
  const next = redraw_in_flight.then(redraw_titles, redraw_titles);
  // A redraw that fails is reported, and does not stop the next one from being attempted.
  redraw_in_flight = next.catch((e) => konsole.error("Failed to draw the list of memos", e));
  return redraw_in_flight;
};

/**
 * Fetches all memo titles from the server
 * @param {*} force_reload if false just keep the current list
 */
async function loadMemoTitles(force_reload?: boolean) {
  if (!force_reload) {
    const dest = document.getElementById("memoTitlesList");
    if (dest?.firstChild) {
      // The list is already on screen. Keeping it is the point — there is no reason to ask the
      // server for the same titles again — but the memos may have been edited since it was
      // drawn, and the markers are how that shows. Redraw them from what this device knows:
      // over the server's list where there is one, or from the local database where that is
      // what the list came from.
      await redraw_soon();
      return;
    }
  }
  try {
    const responseJson: MemoTitleListDTO = await server_comm.read_memo_titles();
    const new_memos = await db.get_new_memos();
    await db.general_store_put("user", responseJson.requester);
    titles_from_server = [...new_memos, ...responseJson.memos.map(mt => memo_title_dto_to_memo_title(mt, responseJson.requester.id))];
    list_is_local = false;
    // The whole list is what is about to be drawn, whatever was searched for before.
    search_hits = undefined;
    show_list_info("Memos from the server");
    show_cache_all(true);
    // The server's answer says nothing about the memos edited here since they were fetched;
    // the cache does, and its markers win.
    displayMemoTitles(await with_local_statuses(titles_from_server), false, false);
    //console.log(responseJson);
    return;
  } catch (e) {
    if (e instanceof server_comm.UnauthenticatedError) {
      // more info at https://www.w3schools.com/howto/howto_js_redirect_webpage.asp
      window.location.replace(`/login.html?r=${encodeURIComponent(window.location.href)}`);
      return;
    }
    if (e instanceof server_comm.HttpError) {
      konsole.error("Failed to fetch memo list, server status", e.status);
      show_list_info(
        "Local memos",
        `# The server answered ${e.status} for the memo list. These are the memos cached on this device, and searching them searches those.`
      );
    } else {
      konsole.error("Failed to fetch memo list", e);
      show_list_info(
        "Local memos",
        `# Could not reach the server for the memo list. These are the memos cached on this device, and searching them searches those.`
      );
    }
  }
  list_is_local = true;
  search_hits = undefined;
  show_cache_all(false);
  konsole.log("Get all memos from indexedDB");
  displayMemoTitles(await db.get_all_memos(), false, false);
}

const headerStartRegex = /^#+\s+/;

const make_memotitle_link_id = (id: number): string => `memo_title_link_${id}`;

/**
 * Renders the list of memo titles in the DOM
 * @param {MemoTitle[]} memoTitles
 * @param auto_open if the list has only one element then open it in the editor immediately
 * @param extra_info if true show also the id, user id, group id
 */
const displayMemoTitles = async (
  memoTitles: MemoTitle[],
  auto_open: boolean,
  extra_info: boolean
) => {
  const dest = document.getElementById("memoTitlesList");
  dest!.innerText = "";

  // The access times only decide the order of the list; failing to read them is no reason to
  // leave the list empty, which is what an uncaught failure here would do — the line above has
  // already cleared it.
  const access_times = await db.access_times().catch((e) => {
    konsole.error("Could not read the access times, listing the memos without them", e);
    return [];
  });
  memo_processing
    .make_title_list(memoTitles, access_times)
    .map((memoTitle) => {
      const a = document.createElement("a");
      a.style.display = "inline-block";
      a.href = `/memo/${memoTitle.id}`;
      if (extra_info) {
        a.innerText = `${memoTitle.title} #${memoTitle.id} u:${memoTitle.userId || ''} g:${memoTitle.group_id || ''}`;
      } else {
        a.innerText = memoTitle.title;
      }
      a.id = make_memotitle_link_id(memoTitle.id);
      const li = document.createElement("li");
      li.appendChild(a);
      const STATUS = 'data-status'
      if(memoTitle.status) {
        li.setAttribute(STATUS, memoTitle.status);
      }
      return li;
    })
    .forEach((memo) => {
      dest!.appendChild(memo);
    });

  if (dest!.childElementCount === 1 && auto_open) {
    // we have li -> a
    dest!.firstElementChild!.firstElementChild!.dispatchEvent(
      new CustomEvent("click", { bubbles: true })
    );
  }
};

/**
 * Fetch every memo the server has into this device, so the app works with the server down.
 *
 * Meant for the titles page, which is where somebody stands before going somewhere without a
 * connection. Each memo is merged the way a save merges, so nothing edited here is lost to it,
 * and one that will not come is reported rather than abandoning the rest.
 */
const cache_everything = async () => {
  const button = document.getElementById("cache_all");
  if (!button || button.getAttribute("aria-busy") === "true") {
    return;
  }
  const label = button.innerText;
  button.setAttribute("aria-busy", "true");

  try {
    const result = await server_comm.cache_all_memos((done, total) => {
      button.innerText = `Caching ${done}/${total}`;
    });
    konsole.log(`Cached ${result.cached} of ${result.total} memos`);
    if (result.failures.length) {
      show_list_info(
        "Cached what the server had",
        `${result.cached} of ${result.total} memos are now on this device.\n` +
          result.failures.slice(0, 5).join("\n")
      );
    } else {
      show_list_info(
        "Cached the memos from the server",
        `All ${result.total} memos are now on this device.`
      );
    }
    // The run is over and the status no longer says the list came from the server. What it left
    // behind is here either way, so the offer goes with it — unless some of it did not come, when
    // asking again is exactly what the reader wants to do. It comes back with the next list the
    // server answers in any case.
    show_cache_all(result.failures.length > 0);
  } catch (e) {
    if (e instanceof server_comm.UnauthenticatedError) {
      window.location.replace(`/login.html?r=${encodeURIComponent(window.location.href)}`);
      return;
    }
    konsole.error("Failed to cache the memos", e);
    show_list_info("Could not cache the memos", `${e}`);
    show_cache_all(false);
  } finally {
    button.removeAttribute("aria-busy");
    button.innerText = label;
  }
};

document.getElementById("cache_all")?.addEventListener("click", (event) => {
  event.preventDefault();
  cache_everything();
});

raspandac.on("memoSavedLocally", (event: CustomEvent<number>) => {
  // A memo written to this device is now dirty, and the markers in the list are drawn from the
  // cache — so the list has to be drawn again to show it. Waiting for the next time the reader
  // comes back is not enough: the save is written after they have already got there, because it
  // has to read the memo and digest it first, so the pencil only appeared the second time.
  konsole.log(`Memo ${event.detail} was written locally, redraw the markers`);
  redraw_soon();
});

raspandac.on("saveAllReport", (event: CustomEvent<string>) => {
  konsole.log(`Save-all report: ${event.detail}`);
  show_list_info("Last save to the server", event.detail);
});

raspandac.on("memoDeleted", (evt: CustomEvent) => {
  // if the memo was deleted then remove it from the list
  const memo_link_id = make_memotitle_link_id(evt.detail);
  const link = document.getElementById(memo_link_id);
  if (link) {
    konsole.log(
      `Got "memoDeleted" event, remove link ${memo_link_id}`
    );
    link.parentNode?.removeChild(link);
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

  // Whatever this turns out to be — a search, or one of the commands below — the list that is on
  // screen now is not the result of a search that was run before it.
  search_hits = undefined;

  switch (criteria) {
    case "$$$drop local cache": {
      // A memo written here is only here: the server has never seen it, or has an older copy of
      // it, so dropping the cache is the end of it. That may be exactly what is wanted, but it is
      // not something to find out afterwards, so it is asked about first.
      const unsaved = await db.unsaved_memos();
      if (unsaved.length) {
        const go_ahead = await ask_confirmation({
          question: `Drop the local cache and delete ${describe_memos(unsaved)}?`,
          detail:
            `${titles_of(unsaved).join("\n")}\n\n` +
            `${unsaved.length === 1 ? "It exists" : "They exist"} only here: the server has ` +
            `${unsaved.length === 1 ? "an older copy or none" : "older copies or none"}. ` +
            `Deleting the cache deletes what is written here for good.`,
          confirm_label: unsaved.length === 1 ? "Delete it" : "Delete them",
        });
        if (!go_ahead) {
          konsole.log("The cache was left alone");
          show_list_info("Nothing was dropped", "The memos written here are still on this device.");
          return;
        }
      }

      try {
        await db.drop_database();
        show_list_info(
          "Local cache dropped",
          "Every memo cached on this device has been deleted. What is left is the server's list, and opening a memo fetches it again."
        );
        // Draw the list again, because the markers in it came from the cache — that is the only
        // place a memo edited or written here is known about — and it is the cache that has just
        // gone. What is left to draw from is whatever the list was built from, which redraw_titles
        // knows: the whole list, or the hits of the search still in the box.
        await redraw_soon();
      } catch (e) {
        konsole.error("Could not drop the local cache", e);
        show_list_info("Could not drop the local cache", e instanceof Error ? e.message : String(e));
      }
      return;
    }

    case "$$$show dirty memos":
      displayMemoTitles(memo_processing.cache_memos_to_server_titles(await db.unsaved_memos()), false, true);
      return;

    case "$$$show new memos":
      displayMemoTitles(await db.get_new_memos(), false, true);
      return;

    case "$$$show cached memos":
      displayMemoTitles(await db.get_all_memos(), false, true);
      return;
  }

  const p1 = criteria.match(/^\$\$\$drop memo (-?\d+)$/);
  if (p1) {
    const id = parseInt(p1[1]);
    // A memo the server already has costs nothing to delete here: it comes back with the next
    // fetch. One it has never seen, or one edited since it was fetched, is only here, so it is
    // asked about first for the same reason the cache is.
    const unsaved = (await db.unsaved_memos()).find((memo) => memo.id === id);
    if (unsaved) {
      const go_ahead = await ask_confirmation({
        question: `Delete ${describe_memos([unsaved])}?`,
        detail:
          `${titles_of([unsaved]).join("\n")}\n\n` +
          `It exists only here: the server has an older copy or none. ` +
          `Deleting it here deletes what is written for good.`,
        confirm_label: "Delete it",
      });
      if (!go_ahead) {
        konsole.log(`memo ${id} was left alone`);
        show_list_info("Nothing was dropped", `Memo ${id} is still on this device.`);
        return;
      }
    }

    await db.delete_memo(id);
    displayMemoTitles(memo_processing.cache_memos_to_server_titles(await db.unsaved_memos()), false, true);
    return;
  }

  // The list on screen came from the local database, so the server has already failed us once
  // and there is nothing to ask it for. A search that quietly went to the server here would
  // return its own, different list — or nothing at all — under a "Local memos" heading.
  if (list_is_local) {
    const hits = await search_local_memos(criteria);
    search_hits = hits;
    displayMemoTitles(hits, true, false);
    return;
  }

  try {
    const responseJson: MemoTitleListDTO = await server_comm.search_memos(criteria);
    const hits = responseJson.memos.map(mt => memo_title_dto_to_memo_title(mt, responseJson.requester.id))
    search_hits = hits;
    displayMemoTitles(hits, true, false);
    //console.log(responseJson);
  } catch (e) {
    if (e instanceof server_comm.UnauthenticatedError) {
      // more info at https://www.w3schools.com/howto/howto_js_redirect_webpage.asp
      window.location.replace(`/login.html?r=${encodeURIComponent(window.location.href)}`);
      return;
    }
    // The previous list is still on screen and the search did not touch it, so leaving this
    // unsaid would let a failed search pass for a search that matched what is already listed.
    const message = e instanceof server_comm.HttpError
      ? `# Search failed, server status ${e.status}`
      : `# Search failed, could not reach the server`;
    konsole.error(message, e);
    show_list_info("Memos from the server", message);
  }
}
