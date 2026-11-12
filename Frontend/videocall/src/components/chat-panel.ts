import { el } from "../dom";

export type ChatLine = {
  name: string;
  text: string;
  at: number;
  self: boolean;
};

const MAX_LINES = 500;
const MAX_CHARS = 2000;

/**
 * The room's chat. A line is only ever text: it is built with textContent, so a message that
 * looks like markup is shown as the characters the sender typed.
 *
 * The panel does not know how to send anything; it dispatches `chat-submit` with the trimmed
 * text and lets the call session decide whether the socket can carry it.
 */
export class ChatPanel extends HTMLElement {
  private readonly log: HTMLOListElement;
  private readonly input: HTMLInputElement;
  private readonly send_button: HTMLButtonElement;

  constructor() {
    super();
    this.classList.add("chat-panel");

    const heading = el("h2", "chat-heading", "Chat");
    this.log = el("ol", "chat-log");
    this.log.setAttribute("aria-live", "polite");
    this.log.setAttribute("aria-relevant", "additions");

    const form = el("form", "chat-form");
    this.input = el("input", "chat-input");
    this.input.type = "text";
    this.input.maxLength = MAX_CHARS;
    this.input.autocomplete = "off";
    this.input.placeholder = "Message the room";
    this.input.setAttribute("aria-label", "Chat message");

    this.send_button = el("button", "button chat-send", "Send");
    this.send_button.type = "submit";

    form.append(this.input, this.send_button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = this.input.value.trim();
      if (text === "") return;
      this.dispatchEvent(
        new CustomEvent<string>("chat-submit", { detail: text, bubbles: true }),
      );
      this.input.value = "";
      this.input.focus();
    });

    this.append(heading, this.log, form);
    this.set_connected(false);
  }

  set_connected(connected: boolean): void {
    this.input.disabled = !connected;
    this.send_button.disabled = !connected;
    this.input.placeholder = connected ? "Message the room" : "Waiting for the call…";
  }

  add_message(line: ChatLine): void {
    const item = el("li", "chat-line");
    if (line.self) item.classList.add("self");

    const meta = el("div", "chat-meta");
    meta.append(
      el("span", "chat-name", line.self ? "You" : line.name),
      el(
        "time",
        "chat-time",
        new Date(line.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      ),
    );

    item.append(meta, el("p", "chat-text", line.text));
    this.log.append(item);

    while (this.log.childElementCount > MAX_LINES) {
      this.log.firstElementChild?.remove();
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** Something the room should know that no participant typed, such as a missing camera. */
  add_system(text: string): void {
    this.log.append(el("li", "chat-system", text));
    while (this.log.childElementCount > MAX_LINES) {
      this.log.firstElementChild?.remove();
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  focus_input(): void {
    this.input.focus();
  }
}

if (customElements.get("vc-chat-panel") === undefined) {
  customElements.define("vc-chat-panel", ChatPanel);
}
