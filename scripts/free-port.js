/**
 * Frees a TCP port before dev (Windows). Usage: node scripts/free-port.js 5173
 */
import { execSync } from "node:child_process";

const port = process.argv[2] || "5173";

function freeWindows(targetPort) {
  let out = "";
  try {
    out = execSync(`netstat -ano | findstr :${targetPort}`, { encoding: "utf8" });
  } catch {
    return;
  }

  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && pid !== "0") pids.add(pid);
  }

  for (const pid of pids) {
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      console.log(`Freed port ${targetPort} (stopped PID ${pid})`);
    } catch {
      // already gone
    }
  }
}

if (process.platform === "win32") {
  freeWindows(port);
} else {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { shell: true, stdio: "ignore" });
  } catch {
    // port free
  }
}
