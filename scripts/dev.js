/**
 * One process, one port (5173): Vite + Socket.io + ngrok (if .env has NGROK_AUTHTOKEN).
 *   npm run dev          → ngrok on automatically when token in .env
 *   npm run dev -- --local-only   → skip ngrok (localhost/LAN only)
 */
import { createServer as createViteServer } from "vite";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ngrok from "@ngrok/ngrok";
import { attachGameServer } from "../backend/setupGameServer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5173;
const URL_FILE = path.join(root, ".ngrok-public-url");
const localOnly = process.argv.includes("--local-only");

process.env.UNO_SINGLE_DEV = "1";

function loadNgrokToken() {
  if (process.env.NGROK_AUTHTOKEN) return process.env.NGROK_AUTHTOKEN.trim();
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) return null;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (t.startsWith("NGROK_AUTHTOKEN=")) {
      return t.slice("NGROK_AUTHTOKEN=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

function shouldUseNgrok() {
  if (localOnly) return false;
  const token = loadNgrokToken();
  return !!token && token !== "paste_your_token_here";
}

async function main() {
  const vite = await createViteServer({
    configFile: path.join(root, "frontend", "vite.config.js"),
  });

  vite.middlewares.use((req, res, next) => {
    if (req.url === "/api/health" || req.url?.startsWith("/api/health?")) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, port: PORT }));
      return;
    }
    next();
  });

  await vite.listen(PORT, true);
  attachGameServer(vite.httpServer);

  let ngrokListener = null;
  let publicUrl = null;

  if (shouldUseNgrok()) {
    console.log("\nOpening ngrok tunnel…\n");
    try {
      ngrokListener = await ngrok.forward({ addr: PORT, authtoken: loadNgrokToken() });
      publicUrl = ngrokListener.url();
      writeFileSync(URL_FILE, publicUrl, "utf8");
    } catch (err) {
      console.error("ngrok failed:", err.message || err);
      console.error("Stop old tunnels: https://dashboard.ngrok.com/tunnels/agents\n");
      try {
        unlinkSync(URL_FILE);
      } catch {
        /* ignore */
      }
    }
  } else {
    try {
      unlinkSync(URL_FILE);
    } catch {
      /* ignore */
    }
  }

  console.log("\n========================================");
  if (publicUrl) {
    console.log("  OPEN THIS (you + friends on the internet):");
    console.log(" ", publicUrl);
    console.log("----------------------------------------");
    console.log("  Host on same PC only:", `http://localhost:${PORT}/`);
  } else {
    console.log("  Brainrot UNO — port", PORT);
    const urls = vite.resolvedUrls ?? {};
    console.log("  Open:", urls.local?.[0] ?? `http://localhost:${PORT}/`);
    if (!loadNgrokToken() || loadNgrokToken() === "paste_your_token_here") {
      console.log("  For internet play: put NGROK_AUTHTOKEN in .env and run npm run dev again");
    }
  }
  console.log("========================================");
  console.log("  Leave this terminal open while you play.\n");

  const shutdown = async () => {
    try {
      ngrokListener?.close();
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(URL_FILE);
    } catch {
      /* ignore */
    }
    await vite.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
