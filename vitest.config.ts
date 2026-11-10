import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/test/**/*.test.tsx"],
    // shortcut: full-suite runs occasionally push a full-page render past the
    // 5s default under CPU contention (confirmed: both flakes pass in <2s
    // isolated); raise it instead of chasing a non-existent logic bug.
    testTimeout: 15000,
  },
});
