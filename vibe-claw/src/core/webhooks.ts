import { createHmac } from "node:crypto";
import { nowIso } from "./ids.js";
import type { AgentRun, RunEvent, RunStep } from "../types.js";

export type WebhookInput = {
  url: string;
  secret?: string;
  requestId: string;
  run: AgentRun;
  steps: RunStep[];
  events: RunEvent[];
};

export async function deliverRunWebhook(input: WebhookInput): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
  const payload = JSON.stringify({
    type: "run.finished",
    requestId: input.requestId,
    createdAt: nowIso(),
    run: input.run,
    steps: input.steps,
    events: input.events
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-vibe-claw-event": "run.finished",
    "x-request-id": input.requestId
  };
  if (input.secret) {
    headers["x-vibe-claw-signature"] = `sha256=${createHmac("sha256", input.secret).update(payload).digest("hex")}`;
  }

  try {
    const response = await fetch(input.url, { method: "POST", headers, body: payload });
    return { ok: response.ok, statusCode: response.status, error: response.ok ? undefined : `Webhook 返回 ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Webhook 发送失败" };
  }
}
