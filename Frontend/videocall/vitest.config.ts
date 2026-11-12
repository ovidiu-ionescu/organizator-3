import { defineConfig } from "vitest/config";

// The unit tests cover the modules that do not touch the DOM: room ids, the signaling
// protocol, and connection-quality thresholds. Everything that needs a browser (media,
// WebRTC, the UI) is exercised by the app itself.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
