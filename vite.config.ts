import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const TUNING_FILE = resolve(import.meta.dirname, "src/pose-tuning.ts");
/** Kept in step with `TUNING_MARKER` in that file, which is where it is explained. */
const TUNING_MARKER = "/* ANIM-TOOL — everything below is rewritten by anim.html. */";
/** A guard against a runaway paste, not a security boundary. */
const MAX_TUNING_BYTES = 64 * 1024;

/**
 * Lets the animation tool save the numbers it is editing back into
 * `src/pose-tuning.ts`.
 *
 * A browser cannot write a file, and it cannot reach the clipboard either: the
 * tool is meant to be opened from another machine on the network, and
 * `navigator.clipboard` does not exist outside a secure context — which
 * `http://<a LAN address>:5173` is not. So the dev server takes the text.
 *
 * It only ever writes the one file, and only the part of it below the marker,
 * so every comment above that line survives a save. This is a **dev-only**
 * route: it is not part of the build, and the built pages fall back to the
 * export panel, which is always there.
 */
function animToolSave(): Plugin {
  return {
    name: "anim-tool-save",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__anim/pose-tuning", (request, response, next) => {
        if (request.method !== "POST") return next();
        const chunks: Buffer[] = [];
        let size = 0;
        request.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_TUNING_BYTES) chunks.push(chunk);
        });
        request.on("end", () => {
          void (async () => {
            const body = Buffer.concat(chunks).toString("utf8");
            const reply = (status: number, text: string) => {
              response.statusCode = status;
              response.setHeader("content-type", "text/plain; charset=utf-8");
              response.end(text);
            };
            if (size > MAX_TUNING_BYTES) return reply(413, "too much tuning");
            // The payload replaces the tail of a source file, so it has to look
            // like that tail before anything is written.
            if (!body.startsWith(TUNING_MARKER) || !body.includes("POSE_TUNING")) {
              return reply(400, "not a tuning block");
            }
            try {
              const source = await readFile(TUNING_FILE, "utf8");
              // The marker appears twice: once as the exported constant, once as
              // the marker itself. The last one is the real one.
              const cut = source.lastIndexOf(TUNING_MARKER);
              if (cut < 0) return reply(500, "marker missing from pose-tuning.ts");
              await writeFile(TUNING_FILE, source.slice(0, cut) + body, "utf8");
              reply(200, `saved ${new Date().toTimeString().slice(0, 8)}`);
            } catch (error) {
              reply(500, error instanceof Error ? error.message : "write failed");
            }
          })();
        });
      });
    },
  };
}

// Three entry points: the game, the combat sim that stages fights against the
// same runtime, and the animation tool that holds one fighter still. All three
// ship with the build so any of them can be opened wherever the game is served.
export default defineConfig({
  plugins: [animToolSave()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        sim: resolve(import.meta.dirname, "sim.html"),
        anim: resolve(import.meta.dirname, "anim.html"),
      },
    },
  },
});
