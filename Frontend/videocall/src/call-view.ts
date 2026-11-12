import { ChatPanel } from "./components/chat-panel";
import { ParticipantList } from "./components/participant-list";
import { VideoTile } from "./components/video-tile";
import { el } from "./dom";
import { icons } from "./icons";

export type CallViewHandlers = {
  on_audio_toggle: () => void;
  on_video_toggle: () => void;
  on_camera_switch: () => void;
  on_screen_toggle: () => void;
  on_leave: () => void;
};

export type CallView = {
  element: HTMLElement;
  video_grid: HTMLDivElement;
  waiting: HTMLParagraphElement;
  roster: ParticipantList;
  chat: ChatPanel;
  local_tile: VideoTile;
  banner: HTMLDivElement;
  audio_button: HTMLButtonElement;
  audio_icon: HTMLSpanElement;
  audio_text: HTMLSpanElement;
  video_button: HTMLButtonElement;
  video_icon: HTMLSpanElement;
  video_text: HTMLSpanElement;
  switch_button: HTMLButtonElement;
  switch_icon: HTMLSpanElement;
  switch_text: HTMLSpanElement;
  screen_button: HTMLButtonElement;
  screen_icon: HTMLSpanElement;
  screen_text: HTMLSpanElement;
  leave_button: HTMLButtonElement;
  share_input: HTMLInputElement;
};

type ControlButton = {
  button: HTMLButtonElement;
  icon: HTMLSpanElement;
  text: HTMLSpanElement;
};

function control_button(icon: string, label: string, class_name: string): ControlButton {
  const button = el("button", `control ${class_name}`);
  button.type = "button";
  // The icon is the button's first child; the label is visible next to it and is also the
  // accessible name when the CSS hides the text on a narrow screen.
  const icon_span = el("span", "control-icon");
  icon_span.innerHTML = icon;
  const text = el("span", "control-text", label);
  button.append(icon_span, text);
  return { button, icon: icon_span, text };
}

/**
 * The call screen: video tiles, roster, chat, the mute/camera/leave controls and the link to
 * invite somebody into this room. It builds the shell once; the call session fills in the tiles,
 * the roster, the banner and the control states as messages arrive.
 */
export function create_call_view(
  display_name: string,
  room_id: string,
  share_link: string,
  handlers: CallViewHandlers,
): CallView {
  const element = el("div", "call");

  const header = el("header", "call-header");
  const title = el("div", "call-title");
  title.append(
    el("h1", "call-heading", "Video call"),
    el("span", "room-code", `Room ${room_id.slice(0, 8)}`),
  );
  title.lastElementChild?.setAttribute("title", room_id);

  const share = el("div", "share");
  const share_input = el("input", "share-input");
  share_input.type = "text";
  share_input.readOnly = true;
  share_input.value = share_link;
  share_input.setAttribute("aria-label", "Room link");
  const copy_button = el("button", "button share-copy");
  copy_button.type = "button";
  const copy_icon = el("span", "control-icon");
  copy_icon.innerHTML = icons.link;
  const copy_text = el("span", "", "Copy link");
  copy_button.append(copy_icon, copy_text);
  share.append(share_input, copy_button);
  header.append(title, share);

  const banner = el("div", "call-banner");
  banner.hidden = true;
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const stage = el("main", "call-stage");
  const video_area = el("section", "video-area");
  video_area.setAttribute("aria-label", "Participants' video");
  const video_grid = el("div", "video-grid");
  const local_tile = new VideoTile();
  local_tile.label = `${display_name} (you)`;
  local_tile.preview_muted = true;
  video_grid.append(local_tile);

  const waiting = el(
    "p",
    "waiting",
    "Waiting for others. Share the room link to invite them.",
  );
  waiting.hidden = true;
  video_area.append(video_grid, waiting);

  const side = el("aside", "side-panel");
  const roster_section = el("section", "roster");
  roster_section.append(el("h2", "side-heading", "Participants"));
  const roster = new ParticipantList();
  roster_section.append(roster);

  const chat = new ChatPanel();
  side.append(roster_section, chat);
  stage.append(video_area, side);

  const controls = el("footer", "controls");
  const audio = control_button(icons.mic, "Mute", "control-audio");
  const video = control_button(icons.camera, "Camera off", "control-video");
  const switch_camera = control_button(
    icons.switch_camera,
    "Switch camera",
    "control-switch-camera",
  );
  const screen = control_button(icons.screen, "Share screen", "control-screen");
  const leave = control_button(icons.leave, "Leave", "control-leave");
  switch_camera.button.hidden = true;
  leave.button.classList.add("danger");

  audio.button.addEventListener("click", handlers.on_audio_toggle);
  video.button.addEventListener("click", handlers.on_video_toggle);
  switch_camera.button.addEventListener("click", handlers.on_camera_switch);
  screen.button.addEventListener("click", handlers.on_screen_toggle);
  leave.button.addEventListener("click", handlers.on_leave);
  controls.append(
    audio.button,
    video.button,
    switch_camera.button,
    screen.button,
    leave.button,
  );
  controls.setAttribute("aria-label", "Call controls");

  element.append(header, banner, stage, controls);

  const view: CallView = {
    element,
    video_grid,
    waiting,
    roster,
    chat,
    local_tile,
    banner,
    audio_button: audio.button,
    audio_icon: audio.icon,
    audio_text: audio.text,
    video_button: video.button,
    video_icon: video.icon,
    video_text: video.text,
    switch_button: switch_camera.button,
    switch_icon: switch_camera.icon,
    switch_text: switch_camera.text,
    screen_button: screen.button,
    screen_icon: screen.icon,
    screen_text: screen.text,
    leave_button: leave.button,
    share_input,
  };

  copy_button.addEventListener("click", () => void copy_link(view, share_link, copy_text));

  return view;
}

async function copy_link(view: CallView, link: string, label: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(link);
    label.textContent = "Copied";
    window.setTimeout(() => {
      label.textContent = "Copy link";
    }, 2000);
  } catch {
    view.share_input.select();
    set_banner(view, "Copy the room link from the field above.", "info");
  }
}

export function set_banner(
  view: CallView,
  message: string | null,
  kind: "info" | "warning",
  action?: { label: string; on_click: () => void },
): void {
  view.banner.className = `call-banner banner-${kind}`;
  if (message === null) {
    view.banner.hidden = true;
    view.banner.replaceChildren();
    return;
  }

  const content: HTMLElement[] = [el("span", "banner-text", message)];
  if (action !== undefined) {
    const button = el("button", "button banner-button", action.label);
    button.type = "button";
    button.addEventListener("click", action.on_click);
    content.push(button);
  }
  view.banner.replaceChildren(...content);
  view.banner.hidden = false;
}

export type ControlState = {
  connected: boolean;
  audio_on: boolean;
  video_on: boolean;
  has_audio: boolean;
  has_video: boolean;
  sharing: boolean;
  can_share: boolean;
  can_switch_camera: boolean;
  switching_camera: boolean;
};

export function set_controls(view: CallView, state: ControlState): void {
  update_control(view.audio_button, view.audio_icon, view.audio_text, {
    icon: state.audio_on ? icons.mic : icons.mic_off,
    label: state.has_audio ? (state.audio_on ? "Mute" : "Unmute") : "No mic",
    aria: state.has_audio
      ? state.audio_on
        ? "Mute microphone"
        : "Unmute microphone"
      : "No microphone is available",
    disabled: !state.connected || !state.has_audio,
    off: !state.audio_on,
    pressed: !state.audio_on,
  });
  update_control(view.video_button, view.video_icon, view.video_text, {
    icon: state.video_on ? icons.camera : icons.camera_off,
    label: state.has_video ? (state.video_on ? "Camera off" : "Camera on") : "No camera",
    aria: state.has_video
      ? state.video_on
        ? "Turn the camera off"
        : "Turn the camera on"
      : "No camera is available",
    disabled: !state.connected || !state.has_video,
    off: !state.video_on,
    pressed: !state.video_on,
  });
  update_control(view.switch_button, view.switch_icon, view.switch_text, {
    icon: icons.switch_camera,
    label: state.switching_camera ? "Switching…" : "Switch camera",
    aria: "Switch to another camera",
    disabled: !state.connected || !state.can_switch_camera || state.switching_camera,
    off: false,
    pressed: false,
  });
  view.switch_button.hidden = !state.can_switch_camera;
  update_control(view.screen_button, view.screen_icon, view.screen_text, {
    icon: icons.screen,
    label: state.can_share
      ? state.sharing
        ? "Stop sharing"
        : "Share screen"
      : "No screen share",
    aria: state.can_share
      ? state.sharing
        ? "Stop sharing the screen"
        : "Share a window or the screen"
      : "Screen sharing is not available in this browser",
    disabled: !state.connected || !state.can_share,
    off: false,
    pressed: state.sharing,
  });
  view.screen_button.classList.toggle("active", state.sharing);
}

function update_control(
  button: HTMLButtonElement,
  icon: HTMLSpanElement,
  text: HTMLSpanElement,
  state: {
    icon: string;
    label: string;
    aria: string;
    disabled: boolean;
    off: boolean;
    pressed: boolean;
  },
): void {
  icon.innerHTML = state.icon;
  text.textContent = state.label;
  button.setAttribute("aria-label", state.aria);
  button.setAttribute("aria-pressed", String(state.pressed));
  button.disabled = state.disabled;
  button.classList.toggle("off", state.off);
}
