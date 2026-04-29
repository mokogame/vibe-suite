import { spawn } from "node:child_process";
import { request } from "node:http";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const port = Number(process.env.PORT || 2900);

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

function canPrompt() {
  return input.isTTY && output.isTTY && process.env.CI !== "true" && process.env.IM_DEV_PROMPT !== "0";
}

async function chooseExistingServiceAction(status) {
  if (!canPrompt()) {
    return status.usable ? "reuse" : "restart";
  }

  const label = status.usable
    ? "健康"
    : `异常，health=${status.healthOk ? "ok" : "failed"}，home=${status.homeOk ? "ok" : "failed"}`;
  const defaultAction = status.usable ? "reuse" : "restart";
  const hint = status.usable
    ? "输入 r 重启替换，直接回车维持并退出"
    : "直接回车重启替换，输入 k 维持并退出";
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`[startup] 发现已有 Vibe IM 服务：http://localhost:${port}（${label}）。${hint}：`)).trim().toLowerCase();
    if (answer === "r" || answer === "restart") return "restart";
    if (answer === "k" || answer === "keep" || answer === "reuse" || answer === "exit") return "reuse";
    return defaultAction;
  } finally {
    rl.close();
  }
}

const status = await getRunningVibeImStatus(port);
let replaceExisting = false;

if (process.env.IM_REUSE_RUNNING_SERVER !== "0" && status.isVibeIm) {
  const action = await chooseExistingServiceAction(status);
  if (action === "reuse") {
    const healthText = status.usable ? "healthy" : "detected";
    console.log(`[startup] Vibe IM is already running and ${healthText} on http://localhost:${port}; keeping existing server`);
    process.exit(0);
  }
  replaceExisting = true;
}

if (status.isVibeIm && !status.usable) {
  console.warn(`[startup] Vibe IM on http://localhost:${port} is unhealthy; watch server will restart it (health=${status.healthOk ? "ok" : "failed"}, home=${status.homeOk ? "ok" : "failed"})`);
} else if (replaceExisting) {
  console.warn(`[startup] replacing existing Vibe IM on http://localhost:${port}`);
}

const child = spawn(
  process.execPath,
  ["--watch-path=server.mjs", "--watch-path=lib", "server.mjs"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || ".next-dev",
      ...(replaceExisting ? { IM_REUSE_RUNNING_SERVER: "0", IM_CLOSE_PORT_ON_START: "1" } : {})
    },
    stdio: "inherit"
  }
);

function forward(signal) {
  child.kill(signal);
}

process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
