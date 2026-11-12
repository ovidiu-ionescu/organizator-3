import type { ClientIceCandidate, ClientMessage } from "./protocol";
import { classify_quality } from "./quality";
import type { Quality } from "./quality";

/**
 * The peer-to-peer side of a call.
 *
 * The service is a mesh of browsers: each participant holds one RTCPeerConnection per other
 * participant, and the service only relays the SDP and ICE that set them up. Nobody sends media
 * through the server, which also means there is no TURN server here: two participants behind
 * symmetric NATs may not be able to connect. A deployment that needs that adds a TURN server and
 * puts it in ICE_SERVERS.
 *
 * Who offers is decided once, by the newcomer: the welcome it receives lists everybody already
 * in the room, so it offers to each of them. Everybody else waits for the offer of a participant
 * that has just joined. That removes the glare two simultaneous offers would cause.
 */

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const QUALITY_POLL_MS = 3000;

type Peer = {
  pc: RTCPeerConnection;
  stream: MediaStream;
  quality: Quality;
  media_attached: boolean;
};

export type PeerMeshHandlers = {
  send: (message: ClientMessage) => boolean;
  on_stream: (peer_id: string, stream: MediaStream) => void;
  on_quality: (peer_id: string, quality: Quality) => void;
  on_error: (message: string) => void;
};

export class PeerMesh {
  private readonly peers = new Map<string, Peer>();
  /** Candidates can arrive before the offer that makes their peer connection. */
  private readonly pending_candidates = new Map<string, RTCIceCandidateInit[]>();
  private readonly quality_timer: number;
  private self_id: string | null = null;

  constructor(
    private readonly local_stream: MediaStream | null,
    private readonly handlers: PeerMeshHandlers,
  ) {
    this.quality_timer = window.setInterval(() => void this.poll_quality(), QUALITY_POLL_MS);
  }

  set_self(self_id: string): void {
    this.self_id = self_id;
  }

  /** Forget every peer. A rejoin makes all previous peer ids meaningless. */
  reset(): void {
    for (const peer of this.peers.values()) peer.pc.close();
    this.peers.clear();
    this.pending_candidates.clear();
  }

  async offer_to(peer_id: string): Promise<void> {
    if (peer_id === this.self_id) return;
    const peer = this.ensure_peer(peer_id);
    this.attach_local_media(peer);
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.send_description("offer", peer_id, offer.sdp);
    } catch (error) {
      this.handlers.on_error(`Could not start a connection: ${describe(error)}`);
    }
  }

  async handle_offer(from: string, sdp: string): Promise<void> {
    const peer = this.ensure_peer(from);
    try {
      await peer.pc.setRemoteDescription({ type: "offer", sdp });
      // The answerer attaches its media after the offer, so the tracks land in the m-lines the
      // offer carries. Adding them before setRemoteDescription could leave an extra transceiver
      // that an answer is not allowed to add.
      this.attach_local_media(peer);
      await this.flush_candidates(from, peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.send_description("answer", from, answer.sdp);
    } catch (error) {
      this.handlers.on_error(`Could not answer a participant: ${describe(error)}`);
    }
  }

  async handle_answer(from: string, sdp: string): Promise<void> {
    const peer = this.peers.get(from);
    if (peer === undefined) return;
    try {
      await peer.pc.setRemoteDescription({ type: "answer", sdp });
      await this.flush_candidates(from, peer);
    } catch (error) {
      this.handlers.on_error(`Could not finish a connection: ${describe(error)}`);
    }
  }

  handle_candidate(from: string, candidate: ClientIceCandidate): void {
    const peer = this.peers.get(from);
    if (peer !== undefined && peer.pc.remoteDescription !== null) {
      void peer.pc.addIceCandidate(candidate).catch((error: unknown) => {
        this.handlers.on_error(`Could not use a network route: ${describe(error)}`);
      });
      return;
    }
    const list = this.pending_candidates.get(from) ?? [];
    list.push(candidate);
    this.pending_candidates.set(from, list);
  }

  remove_peer(peer_id: string): void {
    const peer = this.peers.get(peer_id);
    if (peer === undefined) return;
    peer.pc.close();
    this.peers.delete(peer_id);
    this.pending_candidates.delete(peer_id);
  }

  close(): void {
    window.clearInterval(this.quality_timer);
    this.reset();
    this.self_id = null;
  }

  private ensure_peer(peer_id: string): Peer {
    const existing = this.peers.get(peer_id);
    if (existing !== undefined) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const stream = new MediaStream();
    const peer: Peer = { pc, stream, quality: "unknown", media_attached: false };
    this.peers.set(peer_id, peer);

    pc.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (candidate === null) return;
      const init = candidate.toJSON();
      if (init.candidate === undefined || init.candidate === "") return;
      this.handlers.send({
        type: "ice-candidate",
        to: peer_id,
        candidate: {
          candidate: init.candidate,
          sdpMid: init.sdpMid ?? null,
          sdpMLineIndex: init.sdpMLineIndex ?? null,
          usernameFragment: init.usernameFragment ?? null,
        },
      });
    };

    pc.ontrack = (event) => {
      peer.stream.addTrack(event.track);
      this.handlers.on_stream(peer_id, peer.stream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && peer.quality !== "poor") {
        peer.quality = "poor";
        this.handlers.on_quality(peer_id, "poor");
      }
    };

    return peer;
  }

  /// Add the local tracks once per peer. Called before the offer on the side that offers, and
  /// after the remote offer on the side that answers, which is where addTrack attaches a track
  /// to an m-line that is already there instead of inventing one.
  private attach_local_media(peer: Peer): void {
    if (peer.media_attached) return;
    peer.media_attached = true;

    for (const track of this.local_stream?.getTracks() ?? []) {
      peer.pc.addTrack(track, this.local_stream ?? peer.stream);
    }

    // Every offer carries both kinds, so a participant without a camera can still receive one.
    const kinds = new Set(
      peer.pc.getTransceivers().map((transceiver) => transceiver.receiver.track.kind),
    );
    if (!kinds.has("audio")) peer.pc.addTransceiver("audio", { direction: "recvonly" });
    if (!kinds.has("video")) peer.pc.addTransceiver("video", { direction: "recvonly" });
  }

  private send_description(kind: "offer" | "answer", peer_id: string, sdp: string | undefined): void {
    if (sdp === undefined || sdp === "") {
      this.handlers.on_error("The browser produced an empty session description.");
      return;
    }
    this.handlers.send({ type: kind, to: peer_id, sdp });
  }

  private async flush_candidates(peer_id: string, peer: Peer): Promise<void> {
    if (peer.pc.remoteDescription === null) return;
    const list = this.pending_candidates.get(peer_id) ?? [];
    this.pending_candidates.delete(peer_id);
    for (const candidate of list) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (error) {
        this.handlers.on_error(`Could not use a network route: ${describe(error)}`);
      }
    }
  }

  private async poll_quality(): Promise<void> {
    for (const [peer_id, peer] of this.peers) {
      const quality = await read_quality(peer.pc);
      if (this.peers.get(peer_id) !== peer) continue;
      if (quality === peer.quality) continue;
      peer.quality = quality;
      this.handlers.on_quality(peer_id, quality);
    }
  }
}

async function read_quality(pc: RTCPeerConnection): Promise<Quality> {
  if (pc.connectionState !== "connected") return "unknown";

  let rtt: number | null = null;
  let worst_loss: number | null = null;
  let worst_jitter: number | null = null;

  try {
    const stats = await pc.getStats();
    stats.forEach((report: RTCStats) => {
      if (report.type === "candidate-pair") {
        const pair = report as RTCIceCandidatePairStats;
        const seconds = pair.currentRoundTripTime;
        if (pair.state === "succeeded" && typeof seconds === "number") {
          const millis = seconds * 1000;
          rtt = rtt === null ? millis : Math.min(rtt, millis);
        }
      }
      if (report.type === "inbound-rtp") {
        const inbound = report as RTCInboundRtpStreamStats;
        if (typeof inbound.packetsLost === "number" && typeof inbound.packetsReceived === "number") {
          const total = inbound.packetsLost + inbound.packetsReceived;
          if (total > 0) {
            const ratio = inbound.packetsLost / total;
            worst_loss = worst_loss === null ? ratio : Math.max(worst_loss, ratio);
          }
        }
        if (typeof inbound.jitter === "number") {
          const millis = inbound.jitter * 1000;
          worst_jitter = worst_jitter === null ? millis : Math.max(worst_jitter, millis);
        }
      }
    });
  } catch {
    return "unknown";
  }

  return classify_quality({
    rtt_ms: rtt,
    loss_ratio: worst_loss,
    jitter_ms: worst_jitter,
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
