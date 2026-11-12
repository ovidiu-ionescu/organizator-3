# Organizator Video Call

The frontend for the videocall service. It creates and joins rooms, lists the participants, and
carries the WebRTC signaling, the participant state and the chat over one WebSocket. Media is
peer-to-peer; the server only relays signaling messages.

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

There is no TURN server in the deployment. Participants behind symmetric NATs may not be able to
connect; add one to `ICE_SERVERS` in `src/webrtc.ts` if that matters.

## Deployment

The debian package builds this app and installs `dist/` as `/var/www/organizator.ro/videocall/`.
nginx needs the two locations from `Frontend/Nginx/snippets/organizator`: `/videocall/ws/` to the
service (with the WebSocket upgrade headers) and `/videocall/` for the static files.
