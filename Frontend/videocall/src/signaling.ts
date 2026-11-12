import { encode_client_message, parse_server_message } from "./protocol";
import type { ClientMessage, ServerMessage } from "./protocol";

export type SignalingHandlers = {
  on_message: (message: ServerMessage) => void;
  /** Whether the socket had opened before it closed, and why it closed. */
  on_close: (was_open: boolean, code: number, reason: string) => void;
};

/**
 * The WebSocket to the signaling service.
 *
 * One socket carries everything about a room: the participant list, the SDP offers and answers,
 * the ICE candidates, the chat. Media does not come through here — the service never sees it.
 *
 * Closing on purpose is not a connection loss, so it is not reported as one. Anything else is:
 * the caller decides whether to reconnect, and the page has the same room and the same cookie,
 * so reconnecting is just opening the socket again.
 */
export class Signaling {
  private socket: WebSocket | null = null;
  private opened = false;
  private closed_on_purpose = false;

  constructor(
    private readonly url: string,
    private readonly handlers: SignalingHandlers,
  ) {}

  connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.opened = false;
    this.closed_on_purpose = false;

    socket.onopen = () => {
      this.opened = true;
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const message = parse_server_message(event.data);
      if (message !== null) this.handlers.on_message(message);
    };

    socket.onclose = (event) => {
      this.socket = null;
      if (this.closed_on_purpose) {
        this.closed_on_purpose = false;
        return;
      }
      this.handlers.on_close(this.opened, event.code, event.reason);
    };
  }

  send(message: ClientMessage): boolean {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(encode_client_message(message));
    return true;
  }

  close(): void {
    this.closed_on_purpose = true;
    this.socket?.close(1000, "Leaving the call");
    this.socket = null;
  }
}
