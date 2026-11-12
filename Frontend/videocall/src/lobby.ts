import { el } from "./dom";
import { icons } from "./icons";
import { new_room_id, room_id_from_input } from "./room";

export type LobbyOptions = {
  me: { name: string };
  /** A room id from the page's query string, when somebody followed an invitation. */
  requested_room: string | null;
  /** Something that happened in the call the reader has just left. */
  notice: string | null;
  on_join: (room_id: string) => void;
};

/**
 * The screen before a call: start one, or join one whose link somebody sent.
 *
 * Starting a call is joining a room nobody has created yet — rooms exist while people are in
 * them — so the button makes an id and goes straight in.
 */
export function show_lobby(root: HTMLElement, options: LobbyOptions): void {
  const element = el("div", "lobby");

  const card = el("section", "lobby-card");
  card.setAttribute("aria-labelledby", "lobby-heading");

  const mark = el("div", "lobby-mark");
  mark.innerHTML = icons.camera;
  mark.setAttribute("aria-hidden", "true");

  const heading = el("h1", "lobby-heading", "Organizator Video Call");
  heading.id = "lobby-heading";
  const signed_in = el("p", "lobby-signed-in", `Signed in as ${options.me.name}.`);

  const start_button = el("button", "button primary lobby-start", "Start a new call");
  start_button.type = "button";
  start_button.addEventListener("click", () => options.on_join(new_room_id()));

  const divider = el("div", "lobby-divider");
  divider.append(el("span", "", "or join a call"));

  const form = el("form", "join-form");
  const label = el("label", "join-label", "Room link or id");
  label.htmlFor = "room-input";
  const input = el("input", "join-input");
  input.id = "room-input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "123e4567-e89b-…";
  if (options.requested_room !== null) input.value = options.requested_room;

  const join_button = el("button", "button join-button", "Join call");
  join_button.type = "submit";

  const error = el("p", "join-error");
  error.hidden = true;
  error.setAttribute("role", "alert");

  form.append(label, input, join_button, error);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const room_id = room_id_from_input(input.value);
    if (room_id === null) {
      error.textContent = "That is not a room link or room id.";
      error.hidden = false;
      input.focus();
      return;
    }
    error.hidden = true;
    options.on_join(room_id);
  });

  const note = el(
    "p",
    "lobby-note",
    "Joining asks for your camera and microphone. You can join without them and still " +
      "watch and listen.",
  );

  card.append(mark, heading, signed_in);
  if (options.requested_room !== null) {
    card.append(el("p", "lobby-invite", "You were invited to this room."));
  }
  if (options.notice !== null) {
    card.append(el("p", "lobby-notice", options.notice));
  }
  card.append(start_button, divider, form, note);
  element.append(card);
  root.replaceChildren(element);

  if (options.requested_room !== null) {
    join_button.focus();
  } else {
    start_button.focus();
  }
}
