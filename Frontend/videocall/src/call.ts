import { create_call_view, set_banner, set_controls } from "./call-view";
import type { CallView } from "./call-view";
import type { ParticipantView } from "./components/participant-list";
import { VideoTile } from "./components/video-tile";
import { fetch_me, go_to_login } from "./auth";
import { acquire_media, set_track_enabled, stop_stream, track_for } from "./media";
import type { ServerMessage } from "./protocol";
import type { Quality } from "./quality";
import { share_url } from "./room";
import { Signaling } from "./signaling";
import { PeerMesh } from "./webrtc";

export type Me = { name: string };

export type CallSessionOptions = {
  root: HTMLElement;
  me: Me;
  room_id: string;
  on_left: (notice: string | null) => void;
};

/** Which way a camera faces, when its label says. Android and iOS both put it in the label. */
function facing_from_label(label: string): "user" | "environment" | null {
  const text = label.toLowerCase();
  if (text.includes("back") || text.includes("rear") || text.includes("environment")) {
    return "environment";
  }
  if (text.includes("front") || text.includes("user")) return "user";
  return null;
}

/**
 * One call, from the click that joins it to the click that leaves.
 *
 * The session owns the three things that have to agree: the signaling socket (who is here and
 * what they are doing), the peer mesh (the media connections), and the view. Signaling messages
 * drive the other two; nothing in the view talks to the network directly.
 *
 * The call survives losing the signaling socket: the media connections are peer-to-peer and stay
 * up, and a reconnect re-joins the room and rebuilds the mesh, since the service gives a returning
 * participant a new id.
 */
export class CallSession {
  private readonly view: CallView;
  private readonly share_link: string;
  private readonly participants = new Map<string, ParticipantView>();
  private readonly remote_tiles = new Map<string, VideoTile>();
  private readonly remote_streams = new Map<string, MediaStream>();

  private signaling: Signaling | null = null;
  private mesh: PeerMesh | null = null;
  private local_stream: MediaStream | null = null;
  private screen_stream: MediaStream | null = null;
  private screen_track: MediaStreamTrack | null = null;
  private screen_starting = false;
  private camera_count = 0;
  private switching_camera = false;
  private self_id: string | null = null;
  private audio_on = false;
  private video_on = false;
  private screen_on = false;
  private connected = false;
  private leaving = false;

  private reconnect_timer: number | null = null;
  private reconnect_attempts = 0;
  private banner_timer: number | null = null;

  constructor(private readonly options: CallSessionOptions) {
    this.share_link = share_url(options.room_id, window.location.origin);
    this.view = create_call_view(options.me.name, options.room_id, this.share_link, {
      on_audio_toggle: () => this.toggle_audio(),
      on_video_toggle: () => this.toggle_video(),
      on_camera_switch: () => void this.switch_camera(),
      on_screen_toggle: () => this.toggle_screen_share(),
      on_leave: () => this.leave(),
    });
    navigator.mediaDevices?.addEventListener("devicechange", this.devices_changed);
    this.view.local_tile.show_quality = false;
    this.view.chat.addEventListener("chat-submit", (event) => {
      this.send_chat((event as CustomEvent<string>).detail);
    });
  }

  async start(): Promise<void> {
    this.options.root.replaceChildren(this.view.element);
    const url = new URL(window.location.href);
    url.searchParams.set("room", this.options.room_id);
    window.history.replaceState(null, "", url);

    this.show_banner("Requesting camera and microphone…", "info", { sticky: true });
    const media = await acquire_media();
    if (this.leaving) {
      stop_stream(media.stream);
      return;
    }

    this.local_stream = media.stream;
    this.audio_on = track_for(this.local_stream, "audio") !== null;
    this.video_on = track_for(this.local_stream, "video") !== null;
    void this.refresh_camera_count();
    this.view.local_tile.stream = this.local_stream;
    this.view.local_tile.audio_on = this.audio_on;
    this.view.local_tile.video_on = this.video_on;
    if (media.note !== null) this.view.chat.add_system(media.note);

    this.mesh = new PeerMesh(this.local_stream, {
      send: (message) => this.signaling?.send(message) ?? false,
      on_stream: (peer_id, stream) => {
        this.remote_streams.set(peer_id, stream);
        const tile = this.remote_tiles.get(peer_id);
        if (tile !== undefined) tile.stream = stream;
      },
      on_quality: (peer_id, quality) => this.set_quality(peer_id, quality),
      on_error: (message) => this.show_banner(message, "warning"),
    });

    this.set_controls_state();
    this.show_banner("Joining the room…", "info", { sticky: true });
    this.connect_signaling();
  }

  private socket_url(): string {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${window.location.host}/videocall/ws/${this.options.room_id}`;
  }

  private connect_signaling(): void {
    if (this.leaving) return;
    this.clear_reconnect_timer();

    // "Try now" can be pressed while an attempt is still connecting. That attempt's callbacks
    // are ignored once it is replaced, but its socket would go on holding a place in the room.
    const previous = this.signaling;
    this.signaling = null;
    previous?.close();

    const signaling = new Signaling(this.socket_url(), {
      on_message: (message) => {
        if (this.signaling === signaling && !this.leaving) this.handle_message(message);
      },
      on_close: (was_open, code, reason) => {
        if (this.signaling !== signaling || this.leaving) return;
        this.signaling = null;
        this.handle_close(was_open, code, reason);
      },
    });
    this.signaling = signaling;
    signaling.connect();
  }

  private handle_message(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.handle_welcome(message);
        break;
      case "peer-joined":
        this.handle_peer_joined(message.participant);
        break;
      case "peer-left":
        this.handle_peer_left(message.id);
        break;
      case "offer":
        void this.mesh?.handle_offer(message.from, message.sdp);
        break;
      case "answer":
        void this.mesh?.handle_answer(message.from, message.sdp);
        break;
      case "ice-candidate":
        this.mesh?.handle_candidate(message.from, message.candidate);
        break;
      case "chat":
        this.view.chat.add_message({
          name: message.name,
          text: message.text,
          at: message.at,
          self: message.from === this.self_id,
        });
        break;
      case "participant-state":
        this.handle_participant_state(
          message.id,
          message.audio,
          message.video,
          message.screen,
        );
        break;
      case "error":
        this.show_banner(message.message, "warning");
        break;
    }
  }

  private handle_welcome(message: Extract<ServerMessage, { type: "welcome" }>): void {
    this.self_id = message.self_id;
    this.connected = true;
    this.reconnect_attempts = 0;
    this.clear_reconnect_timer();

    for (const id of [...this.remote_tiles.keys()]) this.remove_remote_tile(id);
    this.remote_streams.clear();
    this.participants.clear();
    this.participants.set(message.self_id, {
      id: message.self_id,
      name: this.options.me.name,
      self: true,
      audio: this.audio_on,
      video: this.video_on || this.screen_on,
      screen: this.screen_on,
      quality: "unknown",
    });

    for (const participant of message.participants) {
      if (participant.id === message.self_id) continue;
      this.participants.set(participant.id, {
        id: participant.id,
        name: participant.name,
        self: false,
        audio: participant.audio,
        video: participant.video,
        screen: participant.screen,
        quality: "unknown",
      });
      this.ensure_remote_tile(participant.id);
    }

    this.render_participants();
    this.view.chat.set_connected(true);
    this.set_controls_state();
    this.show_banner(null, "info");

    // New relays come with every welcome; take them before any peer connection is made.
    this.mesh?.set_ice_servers(message.ice_servers);

    // The newcomer offers to everybody already in the room; see webrtc.ts.
    this.mesh?.reset();
    this.mesh?.set_self(message.self_id);
    for (const participant of message.participants) {
      if (participant.id === message.self_id) continue;
      void this.mesh?.offer_to(participant.id);
    }

    this.send_state();
  }

  private handle_peer_joined(participant: Extract<ServerMessage, { type: "peer-joined" }>["participant"]): void {
    if (participant.id === this.self_id) return;
    this.participants.set(participant.id, {
      id: participant.id,
      name: participant.name,
      self: false,
      audio: participant.audio,
      video: participant.video,
      screen: participant.screen,
      quality: "unknown",
    });
    this.ensure_remote_tile(participant.id);
    this.render_participants();
  }

  private handle_peer_left(peer_id: string): void {
    this.participants.delete(peer_id);
    this.mesh?.remove_peer(peer_id);
    this.remove_remote_tile(peer_id);
    this.render_participants();
  }

  private handle_participant_state(
    peer_id: string,
    audio: boolean,
    video: boolean,
    screen: boolean,
  ): void {
    if (peer_id === this.self_id) return;
    const participant = this.participants.get(peer_id);
    if (participant === undefined) return;
    participant.audio = audio;
    participant.video = video;
    participant.screen = screen;
    const tile = this.remote_tiles.get(peer_id);
    if (tile !== undefined) {
      tile.audio_on = audio;
      tile.video_on = video;
      tile.screen = screen;
    }
    this.render_participants();
  }

  private set_quality(peer_id: string, quality: Quality): void {
    const participant = this.participants.get(peer_id);
    if (participant === undefined) return;
    participant.quality = quality;
    const tile = this.remote_tiles.get(peer_id);
    if (tile !== undefined) tile.quality = quality;
    this.render_participants();
  }

  private toggle_audio(): void {
    if (!this.connected || track_for(this.local_stream, "audio") === null) return;
    this.audio_on = !this.audio_on;
    set_track_enabled(this.local_stream, "audio", this.audio_on);
    this.update_local_media();
    this.send_state();
  }

  private toggle_video(): void {
    if (!this.connected || track_for(this.local_stream, "video") === null) return;
    this.video_on = !this.video_on;
    set_track_enabled(this.local_stream, "video", this.video_on);
    this.update_local_media();
    this.send_state();
  }

  private readonly screen_ended = (): void => {
    this.stop_screen_share();
  };

  private readonly devices_changed = (): void => {
    void this.refresh_camera_count();
  };

  private async refresh_camera_count(): Promise<void> {
    if (navigator.mediaDevices?.enumerateDevices === undefined) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.camera_count = devices.filter((device) => device.kind === "videoinput").length;
    } catch {
      this.camera_count = 0;
    }
    this.set_controls_state();
  }

  /**
   * Move the call to the next video input. The new camera track replaces the old one in the
   * local stream and, unless a screen is being shared, on every peer connection. Switching while
   * sharing only changes the camera underneath, ready for when the share stops.
   */
  private async switch_camera(): Promise<void> {
    if (!this.connected || this.switching_camera) return;
    const stream = this.local_stream;
    const current = track_for(stream, "video");
    if (stream === null || current === null) return;
    if (navigator.mediaDevices?.enumerateDevices === undefined) return;

    let devices: MediaDeviceInfo[];
    try {
      devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "videoinput",
      );
    } catch {
      this.show_banner("Could not list the cameras.", "warning");
      return;
    }
    if (devices.length < 2) return;

    const current_id = current.getSettings().deviceId;
    const current_index = devices.findIndex((device) => device.deviceId === current_id);
    const ordered =
      current_index === -1
        ? devices
        : [...devices.slice(current_index + 1), ...devices.slice(0, current_index)];
    const next =
      ordered.find((device) => device.deviceId !== "" && device.deviceId !== current_id) ??
      ordered.find((device) => device.deviceId !== current_id);
    if (next === undefined) return;

    this.switching_camera = true;
    this.set_controls_state();

    const previous_id = current.getSettings().deviceId ?? "";
    const previous_facing = current.getSettings().facingMode;
    let last_error: unknown = null;

    const open = async (
      video: MediaTrackConstraints | true,
    ): Promise<MediaStreamTrack | null> => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: false, video });
        const track = media.getVideoTracks()[0];
        if (track === undefined) {
          stop_stream(media);
          last_error = new Error("The selected camera did not start.");
          return null;
        }
        return track;
      } catch (error) {
        last_error = error;
        return null;
      }
    };

    try {
      // Android keeps the camera for as long as the old track is live and refuses to start a
      // second one — "Could not start video source". Release it first, then give the device a
      // moment to hand the camera back.
      stream.removeTrack(current);
      current.stop();
      if (!this.screen_on) await this.mesh?.use_video_track(null);
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      if (this.leaving) return;

      let replacement: MediaStreamTrack | null = null;
      if (next.deviceId !== "") {
        replacement = await open({ deviceId: { exact: next.deviceId } });
      }
      if (replacement === null && next.deviceId !== "") {
        // The camera service can take a little longer than the first pause to let go; one retry
        // is enough for it, and a failure after that is a real one.
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        if (this.leaving) return;
        replacement = await open({ deviceId: { exact: next.deviceId } });
      }
      if (replacement === null) {
        const facing = facing_from_label(next.label);
        if (facing !== null) replacement = await open({ facingMode: { ideal: facing } });
      }
      if (replacement === null && next.deviceId === "") replacement = await open(true);
      if (this.leaving) {
        replacement?.stop();
        return;
      }

      if (replacement === null) {
        // The new camera could not start. Put the old one back rather than leaving the call
        // blind; only if that fails too does the call continue without a camera.
        let restored: MediaStreamTrack | null = null;
        if (previous_id !== "") {
          restored = await open({ deviceId: { exact: previous_id } });
        }
        if (restored === null && previous_facing !== undefined) {
          restored = await open({ facingMode: { ideal: previous_facing } });
        }
        if (restored === null && previous_id === "" && previous_facing === undefined) {
          restored = await open(true);
        }

        if (restored !== null) {
          replacement = restored;
          this.show_banner("Could not switch camera; kept the previous one.", "warning");
        } else {
          this.video_on = false;
          this.send_state();
          const reason =
            last_error instanceof Error ? last_error.message : "the camera did not start";
          this.show_banner(`Could not switch camera: ${reason}`, "warning");
        }
      }

      if (replacement !== null) {
        replacement.enabled = this.video_on;
        stream.addTrack(replacement);
        if (!this.screen_on) {
          await this.mesh?.use_video_track(replacement);
          // Re-opening the preview makes the video element pick up the track that replaced the
          // old one in the same MediaStream.
          this.view.local_tile.stream = null;
          this.view.local_tile.stream = stream;
        }
      }
      this.update_local_media();
    } finally {
      this.switching_camera = false;
      this.set_controls_state();
    }
  }

  private toggle_screen_share(): void {
    if (!this.connected) return;
    if (this.screen_on) {
      this.stop_screen_share();
      return;
    }
    if (this.screen_starting) return;
    if (navigator.mediaDevices?.getDisplayMedia === undefined) {
      this.show_banner("Screen sharing is not available in this browser.", "warning");
      return;
    }

    this.screen_starting = true;
    // Called directly from the click so the browser still sees the gesture that lets it open
    // its window/screen picker. Cancelling that picker is not an error worth a banner.
    void navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(
      (stream) => {
        this.screen_starting = false;
        this.begin_screen_share(stream);
      },
      (error: unknown) => {
        this.screen_starting = false;
        const cancelled =
          error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "AbortError");
        if (!cancelled) {
          const reason = error instanceof Error ? error.message : String(error);
          this.show_banner(`Could not start screen sharing: ${reason}`, "warning");
        }
      },
    );
  }

  private begin_screen_share(stream: MediaStream): void {
    if (this.leaving) {
      stop_stream(stream);
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (track === undefined) {
      stop_stream(stream);
      this.show_banner("The selected source has no video.", "warning");
      return;
    }

    this.screen_stream = stream;
    this.screen_track = track;
    this.screen_on = true;
    track.addEventListener("ended", this.screen_ended);
    void this.mesh?.use_video_track(track);

    this.view.local_tile.stream = stream;
    this.update_local_media();
    this.send_state();
  }

  private stop_screen_share(): void {
    if (!this.screen_on) return;
    this.screen_on = false;
    if (this.screen_track !== null) {
      this.screen_track.removeEventListener("ended", this.screen_ended);
      this.screen_track = null;
    }
    stop_stream(this.screen_stream);
    this.screen_stream = null;
    this.view.local_tile.stream = this.local_stream;

    if (this.leaving) return;

    void this.mesh?.use_video_track(track_for(this.local_stream, "video"));
    this.update_local_media();
    this.send_state();
  }

  private update_local_media(): void {
    const sending_video = this.video_on || this.screen_on;
    this.view.local_tile.audio_on = this.audio_on;
    this.view.local_tile.video_on = sending_video;
    this.view.local_tile.screen = this.screen_on;
    const self = this.self_id === null ? undefined : this.participants.get(this.self_id);
    if (self !== undefined) {
      self.audio = this.audio_on;
      self.video = sending_video;
      self.screen = this.screen_on;
    }
    this.render_participants();
    this.set_controls_state();
  }

  private send_state(): void {
    this.signaling?.send({
      type: "state",
      audio: this.audio_on,
      video: this.video_on || this.screen_on,
      screen: this.screen_on,
    });
  }

  private send_chat(text: string): void {
    if (text === "") return;
    if (this.signaling?.send({ type: "chat", text }) !== true) {
      this.show_banner("The chat is not connected yet.", "warning");
    }
  }

  private ensure_remote_tile(peer_id: string): void {
    let tile = this.remote_tiles.get(peer_id);
    if (tile !== undefined) return;

    const participant = this.participants.get(peer_id);
    tile = new VideoTile();
    tile.label = participant?.name ?? "Participant";
    tile.audio_on = participant?.audio ?? true;
    tile.video_on = participant?.video ?? true;
    tile.screen = participant?.screen ?? false;
    tile.quality = participant?.quality ?? "unknown";
    const stream = this.remote_streams.get(peer_id);
    if (stream !== undefined) tile.stream = stream;
    this.remote_tiles.set(peer_id, tile);
    this.view.video_grid.append(tile);
    this.update_waiting();
  }

  private remove_remote_tile(peer_id: string): void {
    const tile = this.remote_tiles.get(peer_id);
    if (tile !== undefined) {
      tile.remove();
      this.remote_tiles.delete(peer_id);
    }
    this.remote_streams.delete(peer_id);
    this.update_waiting();
  }

  private render_participants(): void {
    this.view.roster.participants = [...this.participants.values()];
  }

  private update_waiting(): void {
    const waiting = this.connected && this.remote_tiles.size === 0;
    this.view.waiting.hidden = !waiting;
  }

  private set_controls_state(): void {
    set_controls(this.view, {
      connected: this.connected,
      audio_on: this.audio_on,
      video_on: this.video_on,
      has_audio: track_for(this.local_stream, "audio") !== null,
      has_video: track_for(this.local_stream, "video") !== null,
      sharing: this.screen_on,
      can_share: navigator.mediaDevices?.getDisplayMedia !== undefined,
      can_switch_camera:
        this.camera_count > 1 && track_for(this.local_stream, "video") !== null,
      switching_camera: this.switching_camera,
    });
  }

  private handle_close(was_open: boolean, code: number, reason: string): void {
    this.connected = false;
    this.view.chat.set_connected(false);
    this.set_controls_state();
    this.update_waiting();

    // 1008 is the service refusing this session rather than losing it: the room is full is the
    // one case, and retrying would knock on the same closed door.
    if (code === 1008) {
      this.show_banner(reason === "" ? "The room refused the connection." : reason, "warning", {
        sticky: true,
        action: { label: "Leave", on_click: () => this.leave() },
      });
      return;
    }

    this.reconnect_attempts += 1;
    if (this.self_id === null || this.reconnect_attempts % 5 === 0) {
      void this.check_session();
    }

    const message =
      this.self_id === null && !was_open
        ? "Could not reach the call service. Retrying…"
        : "The connection to the call service was lost. Reconnecting…";
    this.show_banner(message, "warning", {
      sticky: true,
      action: { label: "Try now", on_click: () => this.connect_signaling() },
    });

    const delay = Math.min(1000 * this.reconnect_attempts, 8000);
    this.clear_reconnect_timer();
    this.reconnect_timer = window.setTimeout(() => {
      this.reconnect_timer = null;
      this.connect_signaling();
    }, delay);
  }

  private check_session(): void {
    void fetch_me().then((result) => {
      if (!this.leaving && result.kind === "unauthenticated") go_to_login();
    });
  }

  private clear_reconnect_timer(): void {
    if (this.reconnect_timer !== null) {
      window.clearTimeout(this.reconnect_timer);
      this.reconnect_timer = null;
    }
  }

  private show_banner(
    message: string | null,
    kind: "info" | "warning",
    options: {
      sticky?: boolean;
      action?: { label: string; on_click: () => void };
    } = {},
  ): void {
    if (this.banner_timer !== null) {
      window.clearTimeout(this.banner_timer);
      this.banner_timer = null;
    }

    const action =
      options.action === undefined
        ? undefined
        : {
            label: options.action.label,
            on_click: () => {
              set_banner(this.view, null, "info");
              options.action?.on_click();
            },
          };
    set_banner(this.view, message, kind, action);

    if (message !== null && options.sticky !== true) {
      this.banner_timer = window.setTimeout(() => {
        this.banner_timer = null;
        set_banner(this.view, null, "info");
      }, 6000);
    }
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.stop_screen_share();
    navigator.mediaDevices?.removeEventListener("devicechange", this.devices_changed);
    this.clear_reconnect_timer();
    if (this.banner_timer !== null) window.clearTimeout(this.banner_timer);
    this.signaling?.close();
    this.signaling = null;
    this.mesh?.close();
    this.mesh = null;
    stop_stream(this.local_stream);
    this.local_stream = null;

    this.view.element.remove();
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
    this.options.on_left("You left the call.");
  }
}
