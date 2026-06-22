/** Production preview on port 5173 with multiplayer. */
import { preview as vitePreview } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachGameServer } from "../backend/setupGameServer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5173;

process.env.UNO_SINGLE_DEV = "1";

async function main() {
  const server = await vitePreview({
    configFile: path.join(root, "frontend", "vite.config.js"),
    preview: { port: PORT, host: true, strictPort: true },
  });
  await server.listen();
  attachGameServer(server.httpServer);
  console.log(`\nPreview + online: http://localhost:${PORT}/\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
