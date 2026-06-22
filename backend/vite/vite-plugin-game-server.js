import { attachGameServer } from "../setupGameServer.js";

/** Socket.io on Vite's port — skipped when scripts/dev.js runs (UNO_SINGLE_DEV). */
export function gameServerPlugin() {
  if (process.env.UNO_SINGLE_DEV) {
    return { name: "brainrot-uno-game-server-skipped" };
  }

  let attached = false;

  const hook = (httpServer) => {
    if (!httpServer || attached) return;
    attached = true;
    attachGameServer(httpServer);
    console.log("[uno] Online multiplayer ready (port 5173)");
  };

  return {
    name: "brainrot-uno-game-server",
    configureServer(server) {
      server.middlewares.use("/api/health", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, online: true }));
      });

      if (server.httpServer?.listening) {
        hook(server.httpServer);
        return;
      }
      server.httpServer?.once("listening", () => hook(server.httpServer));
      return () => hook(server.httpServer);
    },
    configurePreviewServer(server) {
      if (server.httpServer?.listening) {
        hook(server.httpServer);
        return;
      }
      server.httpServer?.once("listening", () => hook(server.httpServer));
      return () => hook(server.httpServer);
    },
  };
}
