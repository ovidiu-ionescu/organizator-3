/**
 * @prettier
 *
 * The service worker: registering it, and the one place what it has to say is shown.
 *
 * Imported by memo.html alone, so nothing under test reaches virtual:pwa-register — which has no
 * meaning outside a build (the dev server resolves it to a no-op) and vite.config.ts holds the
 * rest of the arrangement: what is precached, what the worker must never answer, and the promise
 * that a new version waits for the reader.
 */
/// <reference types="vite-plugin-pwa/client" />

import { registerSW } from "virtual:pwa-register";
import konsole from "./console_log.js";
import { raspandac, SaveAllStatus } from "./events.js";

/// The browser looks for a new worker when the page is navigated, and this page can stay open for
/// days. An hour is often enough to notice a deploy and rare enough to forget about.
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

/// How long to wait for the worker holding the new version to take the page over before saying
/// that it has not. Not a deadline for the browser — nothing is undone if it is slow — but a
/// click that produces nothing at all leaves the reader with nothing to do.
const UPDATE_TIMEOUT = 6000;

/// Set across the reload that an accepted update ends in, so that the page coming back can say
/// the update happened. Without it the only sign of a successful update is a page that looks
/// exactly like the one before it.
const UPDATED_FLAG = "memo_app_updated";

/// Set across the reload that an update falls back to when the worker would not take over, so
/// that the page coming back can finish the job. See the end of accept_update.
const FINISHING_FLAG = "memo_app_finishing_update";

/// How long the "it has been updated" line stays. The reader can also dismiss it.
const UPDATED_MESSAGE_TIMEOUT = 8000;

const bar = document.getElementById("pwa_bar");
const message = document.getElementById("pwa_bar_message");
const action = document.getElementById("pwa_bar_action");
const dismiss = document.getElementById("pwa_bar_dismiss");

/// Whether the editor is holding text that exists nowhere else. Not the same as "has unsaved
/// work": a memo that is merely waiting for the server has been written to this device, and a
/// reload would find it again. The two states that mean nowhere are an edit that has not been
/// written at all yet, and a write the local database refused.
let unsaved = false;
raspandac.on("saveAllStatus", (event) => {
  unsaved =
    event.detail === SaveAllStatus.Edited || event.detail === SaveAllStatus.Failed;
});

const hide = () => {
  if (bar) bar.hidden = true;
};

/// Show a line that takes itself away again, unless something else has been said in the bar in
/// the meantime — which would be news the reader has not read yet.
const show_briefly = (text: string) => {
  show(text);
  window.setTimeout(() => {
    if (message?.innerText === text) hide();
  }, UPDATED_MESSAGE_TIMEOUT);
};

const show = (text: string, offer?: { label: string; run: () => void }) => {
  if (!bar || !message || !action || !dismiss) {
    konsole.error("The page has no #pwa_bar to show the service worker's message in");
    return;
  }
  message.innerText = text;
  action.hidden = offer === undefined;
  action.innerText = offer?.label ?? "";
  action.onclick = (event) => {
    event.preventDefault();
    offer?.run();
  };
  dismiss.hidden = false;
  dismiss.onclick = (event) => {
    event.preventDefault();
    hide();
  };
  bar.hidden = false;
};

let accepting = false;

/// Called by the reader, never by the worker: this is the whole of "nothing reloads under
/// someone in the middle of a memo". The worker is already installed and waiting; it stays
/// waiting until this asks for it.
const accept_update = () => {
  if (accepting) return;
  if (unsaved) {
    show(
      "There is text in the editor that is not saved anywhere yet. Save it, then update — the " +
        "new version waits.",
      { label: "Update now", run: accept_update }
    );
    return;
  }
  accepting = true;
  // Said at once: from here the page is waiting on the browser, and a click that changed nothing
  // on screen would leave the reader clicking again.
  show("Updating the app…");
  // What reloads the page is the page changing hands, not the calls below: they only ask the
  // waiting worker to take over (SKIP_WAITING). The plugin's own reload waits on a `controlling`
  // event it only believes is an update when the page had a controller at the moment it
  // registered, which is not always
  // (https://github.com/vite-pwa/vite-plugin-pwa/issues/789). Listening here does not depend on
  // that judgement, and `clientsClaim` in vite.config.ts is what makes the controller change at
  // all. Registered before the message is sent, and once: the first change of controller is the
  // one that matters.
  navigator.serviceWorker?.addEventListener(
    "controllerchange",
    reload_into_the_new_version,
    { once: true }
  );
  // One message, the plugin's own: it is what asks the waiting worker to take over
  // (SKIP_WAITING). Sending a second one by hand, or the same one again a moment later, was
  // measured to leave Chromium with a worker that has called skipWaiting and does not activate —
  // where either message on its own works, in Chromium and in Firefox both.
  updateSW();
  // And if the worker does not take the page over, go anyway. Some browsers keep it waiting
  // until the page that was loaded from the old one is unloaded — measured in Chromium, where
  // the worker activates during the reload that follows and not before — so the reload is what
  // moves things along, and the page that comes back finishes the job (finish_an_update below).
  window.setTimeout(async () => {
    if (!accepting) return;
    const registration = await navigator.serviceWorker?.getRegistration();
    // No worker waiting any more: it did take over, and the reload is on its way.
    if (!registration?.waiting) return;
    try {
      sessionStorage.setItem(FINISHING_FLAG, "1");
    } catch {
      // Nothing to carry the flag across the reload; the page that comes back will simply be the
      // app as it was, and the offer to update will be made again.
    }
    window.location.reload();
  }, UPDATE_TIMEOUT);
};

const reload_into_the_new_version = () => {
  try {
    sessionStorage.setItem(UPDATED_FLAG, "1");
  } catch {
    // A private window, or storage the browser will not write. The reload happens either way.
  }
  window.location.reload();
};

/// The page that comes back from an accepted update says so, once. Everything else about a
/// successful update is invisible — the page is the same page.
try {
  if (sessionStorage.getItem(UPDATED_FLAG) === "1") {
    sessionStorage.removeItem(UPDATED_FLAG);
    show_briefly("The app has been updated to the newest version.");
  }
} catch {
  // Nothing to say without storage, and nothing lost: the update itself has happened.
}

/// The page that comes back from the reload an update falls back to.
///
/// It is the old version, served by the old worker: the worker that was waiting activates while
/// this page is being fetched, so the fetch itself goes to the old one. One more reload is what
/// shows the new version — and it is the last one, since by then the new worker is the one
/// answering.
const finish_an_update = async () => {
  let finishing = false;
  try {
    finishing = sessionStorage.getItem(FINISHING_FLAG) === "1";
    sessionStorage.removeItem(FINISHING_FLAG);
  } catch {
    return;
  }
  if (!finishing) return;
  const registration = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (registration?.waiting) {
    // A reload did not move it either. The worker is installed and waiting for the page to be
    // gone for good, which only the reader can arrange.
    show(
      "The new version did not start. Close the app (or this tab) and open it again — the new " +
        "version is installed and waits for it to be closed."
    );
    return;
  }
  try {
    sessionStorage.setItem(UPDATED_FLAG, "1");
  } catch {
    // As above: the reload happens either way.
  }
  window.location.reload();
};
finish_an_update();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () =>
    show("A newer version of the app is ready.", {
      label: "Update now",
      run: accept_update,
    }),
  onOfflineReady: () => show("The app can now be opened with the server unreachable."),
  onRegisteredSW: (_url, registration) => {
    // A rejection here is the ordinary case when the server is unreachable, and there is nothing
    // to say about it: the worker that is already installed is still working.
    if (registration) {
      window.setInterval(
        () => registration.update().catch(() => {}),
        UPDATE_CHECK_INTERVAL
      );
    }
  },
  onRegisterError: (error) => konsole.error("The service worker did not register", error),
});
