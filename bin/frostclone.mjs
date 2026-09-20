#!/usr/bin/env node

import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Find next available port starting at startPort
function getAvailablePort(startPort = 3000) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      resolve(getAvailablePort(startPort + 1));
    });
  });
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  } catch {}
}

async function main() {
  const port = await getAvailablePort(3000);
  console.log(`\n❄️  Frostclone GUI starting on port ${port}...`);

  const nextProcess = spawn(
    "npx",
    ["next", "dev", "-p", String(port)],
    {
      cwd: rootDir,
      stdio: "pipe",
      env: { ...process.env, PORT: String(port) },
    }
  );

  let opened = false;

  const onData = (chunk) => {
    const text = chunk.toString();
    if (!opened && (text.includes("Ready in") || text.includes("Local:"))) {
      opened = true;
      const targetUrl = `http://localhost:${port}`;
      console.log(`\n✨ Frostclone GUI is ready: ${targetUrl}`);
      console.log(`🚀 Opening browser... (Press Ctrl+C to quit)\n`);
      openBrowser(targetUrl);
    }
  };

  nextProcess.stdout.on("data", onData);
  nextProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    if (text.includes("Ready in") || text.includes("Local:")) {
      onData(chunk);
    }
  });

  const cleanup = () => {
    try {
      nextProcess.kill("SIGTERM");
    } catch {}
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main();
