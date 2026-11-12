import { defineConfig } from "vite";

/// The app is served under /videocall/ by nginx, and the signaling server answers at
/// /videocall/ws/<room>, nginx stripping the /videocall prefix before it reaches the service.
/// The development server has to do the same rewriting, or the browser would be talking to a
/// URL the deployment does not have.
const identity = "http://localhost:8080";
const memo_api = "http://localhost:8082";

export default defineConfig({
  base: "/videocall/",
  server: {
    open: "/videocall/",
    proxy: {
      // Signing in and out is the identity service's; so is /me, which is what the app asks
      // before it shows anything. These have to come before the memo API rule below.
      "/organizator/login": {
        target: identity,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/organizator/, ""),
      },
      "/organizator/logout": {
        target: identity,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/organizator/, ""),
      },
      "/organizator/me": {
        target: identity,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/organizator/, ""),
      },
      "/organizator/": {
        target: memo_api,
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/organizator/, ""),
      },
      // The WebSocket handshake carries the identity cookie, so it can only be same-origin:
      // in development that means this proxy, in production the nginx location.
      "/videocall/ws/": {
        target: "ws://127.0.0.1:8083",
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/videocall/, ""),
      },
    },
  },
  build: {
    target: "es2022",
  },
});
