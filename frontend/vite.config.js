import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { gameServerPlugin } from "../backend/vite/vite-plugin-game-server.js";
import { ngrokInfoPlugin } from "../backend/vite/vite-plugin-ngrok.js";

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(frontendRoot, "..");

export default defineConfig({
  root: frontendRoot,
  publicDir: path.join(frontendRoot, "public"),
  resolve: {
    alias: {
      "@shared": path.join(repoRoot, "shared"),
    },
  },
  plugins: [react(), gameServerPlugin(), ngrokInfoPlugin()],
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
});
