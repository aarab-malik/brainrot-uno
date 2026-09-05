import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(frontendRoot, "..");

export default defineConfig(async ({ command }) => {
  const plugins = [react()];

  // Dev-only: the in-process game server and ngrok helper need express/ngrok,
  // which a plain `vite build` should not require.
  if (command === "serve") {
    const [{ gameServerPlugin }, { ngrokInfoPlugin }] = await Promise.all([
      import("../backend/vite/vite-plugin-game-server.js"),
      import("../backend/vite/vite-plugin-ngrok.js"),
    ]);
    plugins.push(gameServerPlugin(), ngrokInfoPlugin());
  }

  return {
    root: frontendRoot,
    envDir: repoRoot,
    publicDir: path.join(frontendRoot, "public"),
    resolve: {
      alias: {
        "@shared": path.join(repoRoot, "shared"),
      },
    },
    plugins,
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"],
    },
    preview: {
      host: true,
      port: 5173,
      strictPort: true,
      allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"],
    },
    build: {
      outDir: path.join(frontendRoot, "dist"),
      emptyOutDir: true,
    },
  };
});
