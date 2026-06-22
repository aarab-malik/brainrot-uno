import { existsSync, readFileSync } from "node:fs";

const URL_FILE = ".ngrok-public-url";

/** Read public URL written by dev-public.js, or poll ngrok desktop API. */
export async function fetchNgrokPublicUrl(port = 5173, timeoutMs = 60_000) {
  if (existsSync(URL_FILE)) {
    const url = readFileSync(URL_FILE, "utf8").trim();
    if (url) return url;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://127.0.0.1:4040/api/tunnels");
      if (res.ok) {
        const data = await res.json();
        const tunnels = data.tunnels ?? [];
        const match =
          tunnels.find((t) => t.public_url?.includes(`:${port}`) && t.proto === "https") ??
          tunnels.find((t) => t.proto === "https") ??
          tunnels[0];
        if (match?.public_url) return match.public_url;
      }
    } catch {
      // ngrok not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
