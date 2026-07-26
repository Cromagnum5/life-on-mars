import { resolve } from "node:path";
import { defineConfig } from "vite";

// Two entry points: the game, and the combat sim that stages fights against the
// same runtime. The sim ships with the build so it can be opened anywhere the
// game is served.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        sim: resolve(import.meta.dirname, "sim.html"),
      },
    },
  },
});
