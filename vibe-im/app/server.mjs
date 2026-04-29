import { createServer } from "node:http";
import { request } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import next from "next";
import { WebSocketServer } from "ws";
import { initDb, getSessionByToken } from "./lib/db.js";
import { registerSocket, unregisterSocket, handleSocketMessage } from "./lib/realtime.js";

const startupStartedAt = Date.now();
let startupLastMark = startupStartedAt;

function logStartupStep(label) {
  if (process.env.IM_STARTUP_PROFILE !== "1") return;
  const now = Date.now();
  console.log(`[startup] ${label}: +${now - startupLastMark}ms, total ${now - startupStartedAt}ms`);
  startupLastMark = now;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));
logStartupStep("env loaded");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 2900);

function execFileText(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGetText(url, timeoutMs = 800) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", timeout: timeoutMs }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        body += chunk;
        if (body.length > 20000) req.destroy(new Error("Response too large"));
      });
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, body }));
    });
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

async function getRunningVibeImStatus(targetPort) {
  let healthOk = false;
  let homeOk = false;

  try {
    const health = await httpGetText(`http://127.0.0.1:${targetPort}/.well-known/vibe-im-health`);
    healthOk = health.statusCode === 200 && health.body.includes("\"service\":\"vibe-im\"");
  } catch {}

  try {
    const home = await httpGetText(`http://127.0.0.1:${targetPort}/`);
    homeOk = home.statusCode === 200 && home.body.includes("Vibe IM");
  } catch {}

  return {
    isVibeIm: healthOk || homeOk,
    usable: healthOk && homeOk,
    healthOk,
    homeOk
  };
}

async function listPortListenerPids(targetPort) {
  try {
    const output = await execFileText("lsof", ["-ti", `tcp:${targetPort}`, "-sTCP:LISTEN"]);
    return [...new Set(output
      .split(/\s+/)
      .map(item => Number(item))
      .filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid))];
  } catch (error) {
    if (error.code === 1 && !String(error.stdout || "").trim()) return [];
    throw error;
  }
}

async function closePortListenersBeforeStart(targetPort) {
  const pids = await listPortListenerPids(targetPort);
  if (!pids.length) return;

  const runningStatus = await getRunningVibeImStatus(targetPort);
  if (process.env.IM_REUSE_RUNNING_SERVER !== "0" && runningStatus.usable) {
    console.log(`[startup] Vibe IM is already running and healthy on http://localhost:${targetPort}; reusing existing server`);
    process.exit(0);
  }

  const shouldReplaceUnhealthyVibeIm = runningStatus.isVibeIm && !runningStatus.usable;
  if (shouldReplaceUnhealthyVibeIm) {
    console.warn(`[startup] Vibe IM on http://localhost:${targetPort} is unhealthy; restarting it (health=${runningStatus.healthOk ? "ok" : "failed"}, home=${runningStatus.homeOk ? "ok" : "failed"})`);
  }

  if (!shouldReplaceUnhealthyVibeIm && process.env.IM_CLOSE_PORT_ON_START !== "1") {
    console.error(`[startup] port ${targetPort} is occupied by pid(s): ${pids.join(", ")}; not stopping unknown process. Set IM_CLOSE_PORT_ON_START=1 to replace it.`);
    process.exit(1);
  }

  console.warn(`[startup] port ${targetPort} is occupied by pid(s): ${pids.join(", ")}; stopping them before Vibe IM starts`);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const remaining = await listPortListenerPids(targetPort);
    if (!remaining.length) return;
    await sleep(150);
  }

  const remaining = await listPortListenerPids(targetPort);
  for (const pid of remaining) {
    try {
      console.warn(`[startup] pid ${pid} did not release port ${targetPort}; sending SIGKILL`);
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

process.on("SIGINT", () => {
  process.exit(130);
});
process.on("SIGTERM", () => {
  process.exit(143);
});

await closePortListenersBeforeStart(port);
logStartupStep("port checked");

initDb();
logStartupStep("database ready");

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();
logStartupStep("next prepared");
const handleNextUpgrade = app.getUpgradeHandler();

const server = createServer((req, res) => {
  if (req.url === "/.well-known/vibe-im-health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "vibe-im" }));
    return;
  }
  handle(req, res);
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    handleNextUpgrade(req, socket, head);
    return;
  }

  const authToken = url.searchParams.get("token");
  let identity = null;

  if (authToken) {
    const session = getSessionByToken(authToken);
    if (session) identity = { userId: session.user_id, sessionId: session.id, type: "user" };
  }

  if (!identity) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    ws.identity = identity;
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", ws => {
  ws.isAlive = true;
  registerSocket(ws.identity.userId, ws);
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  ws.on("message", raw => handleSocketMessage(ws, raw));
  ws.on("close", () => unregisterSocket(ws.identity.userId, ws));
  ws.send(JSON.stringify({ type: "ready" }));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(port, hostname, () => {
  logStartupStep("http listening");
  console.log(`Vibe IM ready on http://localhost:${port}`);
});
