import { el, initial } from "../dom";
import { describe_quality } from "../quality";
import type { Quality } from "../quality";

/**
 * One participant's video. Light-DOM on purpose: the page's stylesheet styles the app, and a
 * shadow root would only be a second place to keep the same rules.
 *
 * The element owns the video element and its overlays, and everything changing during a call —
 * the stream, the name, whether the microphone or camera is on, the connection indicator — is a
 * property. The app sets them from the signaling messages; none of it is an attribute anyone
 * needs to read back.
 */
export class VideoTile extends HTMLElement {
  private readonly video: HTMLVideoElement;
  private readonly avatar: HTMLDivElement;
  private readonly name_label: HTMLSpanElement;
  private readonly quality_dot: HTMLSpanElement;
  private readonly muted_badge: HTMLSpanElement;
  private readonly screen_badge: HTMLSpanElement;

  constructor() {
    super();
    this.classList.add("video-tile");

    this.video = el("video", "video-tile-video");
    this.video.autoplay = true;
    this.video.playsInline = true;

    this.avatar = el("div", "video-tile-avatar");
    this.avatar.setAttribute("aria-hidden", "true");

    const bar = el("div", "video-tile-bar");
    this.name_label = el("span", "video-tile-name");
    this.quality_dot = el("span", "quality-dot quality-unknown");
    this.quality_dot.title = describe_quality("unknown");
    this.quality_dot.setAttribute("aria-label", describe_quality("unknown"));
    bar.append(this.name_label, this.quality_dot);

    this.muted_badge = el("span", "video-tile-muted", "Muted");
    this.muted_badge.hidden = true;

    this.screen_badge = el("span", "video-tile-screen", "Screen");
    this.screen_badge.hidden = true;

    this.append(this.video, this.avatar, bar, this.muted_badge, this.screen_badge);
  }

  set stream(value: MediaStream | null) {
    if (this.video.srcObject === value) return;
    this.video.srcObject = value;
    if (value !== null) void this.video.play().catch(() => undefined);
  }

  set label(value: string) {
    this.name_label.textContent = value;
    this.avatar.textContent = initial(value);
  }

  /** Only the local preview is muted; remote audio has to be heard. */
  set preview_muted(value: boolean) {
    this.video.muted = value;
  }

  set audio_on(value: boolean) {
    this.muted_badge.hidden = value;
    this.classList.toggle("audio-off", !value);
  }

  set video_on(value: boolean) {
    this.classList.toggle("video-off", !value);
  }

  /** The picture is a shared screen rather than a camera. */
  set screen(value: boolean) {
    this.screen_badge.hidden = !value;
  }

  set quality(value: Quality) {
    this.quality_dot.className = `quality-dot quality-${value}`;
    const description = describe_quality(value);
    this.quality_dot.title = description;
    this.quality_dot.setAttribute("aria-label", description);
  }

  /** The local preview has no connection of its own to measure. */
  set show_quality(value: boolean) {
    this.quality_dot.hidden = !value;
  }

  disconnectedCallback(): void {
    this.video.srcObject = null;
  }
}

if (customElements.get("vc-video-tile") === undefined) {
  customElements.define("vc-video-tile", VideoTile);
}
