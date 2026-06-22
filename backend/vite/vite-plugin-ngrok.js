import { fetchNgrokPublicUrl } from "../../scripts/ngrok-url.js";

/** Exposes GET /__ngrok_url for the host lobby (ngrok local API). */
export function ngrokInfoPlugin() {
  let cached = { url: null, at: 0 };

  return {
    name: "ngrok-info",
    configureServer(server) {
      server.middlewares.use("/__ngrok_url", async (_req, res) => {
        const now = Date.now();
        if (now - cached.at > 2000) {
          cached = { url: await fetchNgrokPublicUrl(5173, 1500), at: now };
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ url: cached.url }));
      });
    },
  };
}
