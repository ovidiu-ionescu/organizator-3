import { fetch_me, go_to_login } from "./auth";
import { CallSession } from "./call";
import type { Me } from "./call";
import { el } from "./dom";
import { show_lobby } from "./lobby";
import { room_id_from_input } from "./room";

/**
 * What the page does before it is a call: ask the identity service who is here, then show the
 * lobby. Everything after that belongs to a CallSession, which hands the page back here when the
 * call is left.
 */
export async function start(root: HTMLElement): Promise<void> {
  root.replaceChildren(el("p", "boot", "Checking your session…"));

  const me = await fetch_me();
  switch (me.kind) {
    case "unauthenticated":
      go_to_login();
      return;
    case "error":
      show_boot_error(root, me.message);
      return;
    case "ok": {
      const display: Me = { name: me.name };
      const requested = room_id_from_input(
        new URLSearchParams(window.location.search).get("room") ?? "",
      );
      show_lobby_for(root, display, requested, null);
      return;
    }
  }
}

function show_lobby_for(
  root: HTMLElement,
  me: Me,
  requested_room: string | null,
  notice: string | null,
): void {
  show_lobby(root, {
    me,
    requested_room,
    notice,
    on_join: (room_id) => {
      const session = new CallSession({
        root,
        me,
        room_id,
        on_left: (left_notice) => show_lobby_for(root, me, null, left_notice),
      });
      void session.start();
    },
  });
}

function show_boot_error(root: HTMLElement, message: string): void {
  const element = el("div", "boot-error");
  element.setAttribute("role", "alert");
  const retry = el("button", "button primary", "Try again");
  retry.type = "button";
  retry.addEventListener("click", () => void start(root));
  element.append(
    el("h1", "", "The video call did not start"),
    el("p", "", message),
    retry,
  );
  root.replaceChildren(element);
}
