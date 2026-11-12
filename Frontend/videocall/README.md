# Organizator Video Call

The frontend for the videocall service. It creates and joins rooms, lists the participants, and
carries the WebRTC signaling, the participant state and the chat over one WebSocket. Media is
peer-to-peer, or through a TURN relay when the networks cannot reach each other directly; the
signaling service only relays signaling messages.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173/videocall/
npm test
npm run build    # dist/
```

The development server proxies `/organizator/*` to the identity and memo services and
`/videocall/ws/*` to the signaling service at `127.0.0.1:8083` (see `vite.config.ts`). Start the
identity service (the signaling service fetches its JWT public key at startup) and then the
signaling service from `Backend/Server`:

```bash
CONFIG_PATH=videocall-server/settings.toml cargo run -p videocall-server
```

Sign in through the memo app on the same origin, or the development proxy's `/organizator/login`
route will accept the same credentials the identity service does.

## Room links

A room id is a UUID made by the browser; the service creates the room when the first participant
arrives and forgets it when the last one leaves. The invitation is
`https://<origin>/videocall/?room=<uuid>`. The join field accepts the id, that link, or any URL
whose query has a `room` parameter.

## Connections

The newcomer offers to everybody already in the room; the others answer. Connection quality is
read from `RTCPeerConnection.getStats()` every three seconds: round-trip time, packet loss and
jitter, with thresholds in `src/quality.ts`.

The signaling socket reconnects by itself. Media connections are peer-to-peer and may survive the
gap, but a rejoin gives the participant a new id, so the mesh is rebuilt on the welcome.

## Screen sharing

The screen control calls `getDisplayMedia`, so the reader chooses a window, a screen or a tab in
the browser's picker. The captured video track replaces the camera track on every peer connection
with `RTCRtpSender.replaceTrack`, which needs no renegotiation; a peer joining during the share
gets the same track when its connection is built. The participant state carries a `screen` flag,
so the other tiles show a “Screen” badge and the roster says “Sharing screen”. Stopping from the
browser's own sharing bar ends the track and brings the camera back.

Browsers without `getDisplayMedia` (most mobile browsers) show the control disabled.

## Switching cameras

When the browser reports more than one video input — the front and back cameras on a phone, or
two webcams on a desktop — a **Switch camera** control appears. It cycles through the video
inputs and replaces the track in the local stream and on every peer sender with
`RTCRtpSender.replaceTrack`, so the call does not renegotiate. While a screen is being shared the
peers keep receiving the screen; only the camera underneath changes, ready for when the share
stops. The control is hidden when only one camera is available.

The old track is stopped before the new camera is opened: Android refuses to start a second
camera while the first one is still held, which surfaces as “Could not start video source”. A
short retry and a facing-mode fallback cover the time the camera service takes to release it; if
the new camera still cannot start, the previous one is restored.

## TURN, for mobile networks

STUN is enough when one side is on an ordinary home or office network: the phone can reach the
LAN peer's public mapping. Two phones on mobile networks are usually behind carrier-grade NAT,
often symmetric, so there is no direct path for STUN to find. A TURN relay fixes that by carrying
the media between them.

The service issues short-lived coturn REST credentials in the welcome message (`ice_servers`);
the browser merges them with its STUN servers. The shared secret stays on the servers.

To enable it:

1. Run coturn with `Backend/Server/videocall-server/turnserver.conf.example`. Give it a public
   address and open UDP/TCP 3478, TLS 5349, and the relay UDP range.
2. Generate one secret with `openssl rand -hex 32` and put it in both places:
   - `static-auth-secret=` in coturn's configuration;
   - `TURN_SHARED_SECRET=…` in `/etc/videocall-server/turn.env` (read by the systemd unit).
3. Set the browser-facing URLs in `/etc/videocall-server/settings.toml`:
   ```toml
   [turn]
   urls = [
     "turn:turn.example.org:3478?transport=udp",
     "turns:turn.example.org:5349?transport=tcp",
   ]
   ttl_seconds = 86400
   ```
4. Restart `videocall-server` and reload the call page.

TURN over TLS on a port the carrier allows (often 443) is the fallback for networks that block
UDP; if 443 is nginx's, give the relay a separate address or use 5349. Without TURN, two mobile
networks will often be unable to connect.

## Deployment

The debian package builds this app and installs `dist/` as `/var/www/organizator.ro/videocall/`.
nginx needs the two locations from `Frontend/Nginx/snippets/organizator`: `/videocall/ws/` to the
service (with the WebSocket upgrade headers) and `/videocall/` for the static files.
