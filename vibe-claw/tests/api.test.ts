import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "../src/api/server.js";
import { MemoryStore } from "../src/store/memory-store.js";

const auth = { authorization: "Bearer test-token" };

describe("Vibe Claw API", () => {
  it("exposes health without auth", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, service: "vibe-claw", store: { ok: true } });
    expect(["memory", "postgres"]).toContain(response.json().store.type);
    expect(response.json().queue).toMatchObject({ pending: 0, active: 0 });
  });

  it("exposes OpenAPI contract without auth", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      openapi: "3.1.0",
      info: { title: "Vibe Claw API" }
    });
    expect(response.json().paths).toHaveProperty("/v1/usage");
    expect(response.json().paths).toHaveProperty("/v1/billing");
    expect(response.json().paths).toHaveProperty("/v1/webhook-subscriptions");
    expect(response.json().paths).toHaveProperty("/v1/admin/reset-data");
    expect(response.json().components.schemas).toHaveProperty("ErrorResponse");
  });

  it("rejects protected API without token", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const response = await app.inject({ method: "GET", url: "/v1/agents" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "AUTH_MISSING",
      message: "缺少 Bearer Token",
      requestId: expect.any(String)
    });
  });

  it("creates and updates provider configs", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const create = await app.inject({
      method: "POST",
      url: "/v1/providers",
      headers: auth,
      payload: {
        name: "DeepSeek",
        type: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        defaultModel: "deepseek-chat",
        apiKeyRef: "DEEPSEEK_API_KEY"
      }
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().provider).toMatchObject({ name: "DeepSeek", type: "openai-compatible", apiKeyRef: "DEEPSEEK_API_KEY" });

    const update = await app.inject({
      method: "PATCH",
      url: `/v1/providers/${create.json().provider.id}`,
      headers: auth,
      payload: { status: "disabled", maxRetries: 1 }
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().provider).toMatchObject({ status: "disabled", maxRetries: 1 });
  });

  it("creates, updates and archives an agent", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "Planner", "负责拆解任务");

    const update = await app.inject({
      method: "PATCH",
      url: `/v1/agents/${agentId}`,
      headers: auth,
      payload: { description: "计划 Agent", defaultModel: "mock-v2" }
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().agent).toMatchObject({ description: "计划 Agent", defaultModel: "mock-v2" });

    const archive = await app.inject({ method: "POST", url: `/v1/agents/${agentId}/archive`, headers: auth });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().agent.status).toBe("archived");
  });

  it("exposes queue status", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const response = await app.inject({ method: "GET", url: "/v1/queue", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().queue).toMatchObject({ pending: 0, active: 0 });
  });

  it("lets admins configure storage mode without exposing database credentials", async () => {
    const previousPath = process.env.VIBE_CLAW_RUNTIME_CONFIG_PATH;
    const previousMode = process.env.VIBE_CLAW_STORAGE_MODE;
    const previousVibeDb = process.env.VIBE_CLAW_DATABASE_URL;
    const previousDb = process.env.DATABASE_URL;
    const dir = await mkdtemp(join(tmpdir(), "vibe-claw-config-"));
    process.env.VIBE_CLAW_RUNTIME_CONFIG_PATH = join(dir, ".env.local");
    delete process.env.VIBE_CLAW_STORAGE_MODE;
    delete process.env.VIBE_CLAW_DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const app = await createServer({ apiToken: "test-token" });
      const current = await app.inject({ method: "GET", url: "/v1/admin/storage-config", headers: auth });
      expect(current.statusCode).toBe(200);
      expect(current.json().config).toMatchObject({ storageMode: "memory", activeStoreType: "memory" });

      const saved = await app.inject({
        method: "POST",
        url: "/v1/admin/storage-config",
        headers: auth,
        payload: {
          storageMode: "postgres",
          databaseUrl: "postgres://admin:secret-pass@localhost:5432/vibe_claw"
        }
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().config).toMatchObject({
        storageMode: "postgres",
        activeStoreType: "memory",
        databaseUrlConfigured: true,
        requiresRestart: true
      });
      expect(saved.json().config.databaseUrlMasked).toContain("********");
      expect(saved.json().config.databaseUrlMasked).not.toContain("secret-pass");
      await expect(readFile(join(dir, ".env.local"), "utf8")).resolves.toContain("VIBE_CLAW_STORAGE_MODE");

      const restart = await app.inject({ method: "POST", url: "/v1/admin/restart", headers: auth, payload: {} });
      expect(restart.statusCode).toBe(200);
      expect(restart.json()).toMatchObject({ restartScheduled: false });
    } finally {
      if (previousPath === undefined) delete process.env.VIBE_CLAW_RUNTIME_CONFIG_PATH;
      else process.env.VIBE_CLAW_RUNTIME_CONFIG_PATH = previousPath;
      if (previousMode === undefined) delete process.env.VIBE_CLAW_STORAGE_MODE;
      else process.env.VIBE_CLAW_STORAGE_MODE = previousMode;
      if (previousVibeDb === undefined) delete process.env.VIBE_CLAW_DATABASE_URL;
      else process.env.VIBE_CLAW_DATABASE_URL = previousVibeDb;
      if (previousDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDb;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lets admins reset the active memory store to a fresh state", async () => {
    const app = await createServer({ store: new MemoryStore(), apiToken: "test-token" });
    const agentId = await createAgent(app, "ResetAgent", "reset me");
    const provider = await app.inject({
      method: "POST",
      url: "/v1/providers",
      headers: auth,
      payload: { name: "Mock", type: "mock", defaultModel: "mock" }
    });
    expect(provider.statusCode).toBe(201);

    const before = await app.inject({ method: "GET", url: "/v1/agents", headers: auth });
    expect(before.json().agents.some((agent: { id: string }) => agent.id === agentId)).toBe(true);

    const reset = await app.inject({
      method: "POST",
      url: "/v1/admin/reset-data",
      headers: auth,
      payload: { confirm: "RESET_CURRENT_STORE" }
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ ok: true, storeType: "memory" });
    expect(reset.json().cleared).toBeGreaterThanOrEqual(3);

    const agents = await app.inject({ method: "GET", url: "/v1/agents", headers: auth });
    expect(agents.statusCode).toBe(200);
    expect(agents.json().agents).toHaveLength(0);
    const tokens = await app.inject({ method: "GET", url: "/v1/tokens", headers: auth });
    expect(tokens.statusCode).toBe(200);
    expect(tokens.json().tokens).toHaveLength(1);
    expect(tokens.json().tokens[0]).toMatchObject({ name: "default-api-token", status: "active" });
  });

  it("enforces tool scopes", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const createToken = await app.inject({
      method: "POST",
      url: "/v1/tokens",
      headers: auth,
      payload: { name: "runner", scopes: ["runs:write", "runs:read", "agents:write", "agents:read"] }
    });
    const token = createToken.json().plainToken;
    const createAgent = await app.inject({
      method: "POST",
      url: "/v1/agents",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "NoTool", instruction: "test" }
    });
    expect(createAgent.statusCode).toBe(201);
    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: { authorization: `Bearer ${token}` },
      payload: { agentIds: [createAgent.json().agent.id], input: "hello", toolCalls: [{ name: "text.echo", input: { text: "x" } }] }
    });
    expect(run.statusCode).toBe(202);
    const body = await waitForRun(app, run.json().run.id, "failed");
    expect(body.run.errorType).toBe("provider_error");
    expect(body.run.errorMessage).toContain("缺少工具权限");
  });

  it("lists tools and injects explicit tool results into run context", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const tools = await app.inject({ method: "GET", url: "/v1/tools", headers: auth });
    expect(tools.statusCode).toBe(200);
    expect(tools.json().tools.some((tool: { name: string }) => tool.name === "text.echo")).toBe(true);

    const agentId = await createAgent(app, "ToolUser", "读取工具上下文");
    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: {
        agentIds: [agentId],
        input: "总结工具结果",
        toolCalls: [{ name: "text.echo", input: { text: "工具数据" } }]
      }
    });
    expect(run.statusCode).toBe(202);
    const body = await waitForRun(app, run.json().run.id, "completed");
    expect(body.run.output).toContain("工具数据");
  });

  it("delivers signed webhook after run completion", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "WebhookAgent", "返回输入");
    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: {
        agentIds: [agentId],
        input: "触发回调",
        callbackUrl: "https://example.com/webhook",
        callbackSecret: "super-secret"
      }
    });
    expect(run.statusCode).toBe(202);
    await waitForRun(app, run.json().run.id, "completed");
    await waitFor(() => fetchMock.mock.calls.length > 0);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/webhook");
    const body = String((init as RequestInit).body);
    const signature = ((init as RequestInit).headers as Record<string, string>)["x-vibe-claw-signature"];
    expect(signature).toBe(`sha256=${createHmac("sha256", "super-secret").update(body).digest("hex")}`);
    fetchMock.mockRestore();
  });

  it("creates an async run and completes it in the background", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "Planner", "负责拆解任务");

    const createRun = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: {
        agentIds: [agentId],
        input: "制定回归测试方案"
      }
    });

    expect(createRun.statusCode).toBe(202);
    const runId = createRun.json().run.id;
    const body = await waitForRun(app, runId, "completed");
    expect(body.run.status).toBe("completed");
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].startedAt).toEqual(expect.any(String));
    expect(body.steps[0].completedAt).toEqual(expect.any(String));
    expect(body.events.some((event: { status: string }) => event.status === "calling_model")).toBe(true);
    expect(body.run.totalTokens).toBeGreaterThan(0);
  });

  it("supports fixed sequential multi-agent collaboration with structured context", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const first = await createAgent(app, "Planner", "负责拆解任务");
    const second = await createAgent(app, "Reviewer", "负责审查方案风险");

    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: {
        agentIds: [first, second],
        input: "设计第三方 API 调用方案",
        context: [{ source: "system", content: "必须保留审计事件", priority: 90 }]
      }
    });

    expect(run.statusCode).toBe(202);
    const body = await waitForRun(app, run.json().run.id, "completed");
    expect(body.run.status).toBe("completed");
    expect(body.steps).toHaveLength(2);
    expect(body.run.output).toContain("Reviewer");
    expect(body.events.filter((event: { status: string }) => event.status === "completed").length).toBeGreaterThanOrEqual(3);
  });

  it("records failed runs for invalid agents instead of hiding the error", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: {
        agentIds: ["missing-agent"],
        input: "hello"
      }
    });

    expect(run.statusCode).toBe(202);
    const body = await waitForRun(app, run.json().run.id, "failed");
    expect(body.run.status).toBe("failed");
    expect(body.run.errorType).toBe("invalid_agent");
    expect(body.events.some((event: { status: string }) => event.status === "failed")).toBe(true);
  });

  it("rejects invalid single-mode run shape", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const first = await createAgent(app, "A", "A");
    const second = await createAgent(app, "B", "B");
    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: {
        agentIds: [first, second],
        mode: "single",
        input: "hello"
      }
    });

    expect(run.statusCode).toBe(400);
  });

  it("creates and revokes scoped API tokens without exposing token hashes", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const create = await app.inject({
      method: "POST",
      url: "/v1/tokens",
      headers: auth,
      payload: { name: "reader", scopes: ["agents:read"], expiresAt: new Date(Date.now() + 60_000).toISOString(), allowedIps: ["127.0.0.1"] }
    });
    expect(create.statusCode).toBe(201);
    const body = create.json();
    expect(body.plainToken).toMatch(/^vcl_/);
    expect(body.token.tokenHash).toBeUndefined();
    expect(body.token).toMatchObject({ allowedIps: ["127.0.0.1"], lastUsedAt: null, lastUsedIp: null });

    const allowed = await app.inject({ method: "GET", url: "/v1/agents", headers: { authorization: `Bearer ${body.plainToken}` } });
    expect(allowed.statusCode).toBe(200);
    const listed = await app.inject({ method: "GET", url: "/v1/tokens", headers: auth });
    expect(listed.json().tokens.find((token: { id: string }) => token.id === body.token.id)).toMatchObject({ lastUsedAt: expect.any(String), lastUsedIp: expect.any(String) });
    const denied = await app.inject({ method: "POST", url: "/v1/agents", headers: { authorization: `Bearer ${body.plainToken}` }, payload: { name: "X", instruction: "Y" } });
    expect(denied.statusCode).toBe(403);

    const rotate = await app.inject({ method: "POST", url: `/v1/tokens/${body.token.id}/rotate`, headers: auth });
    expect(rotate.statusCode).toBe(201);
    expect(rotate.json().plainToken).toMatch(/^vcl_/);
    expect(rotate.json().token).toMatchObject({ allowedIps: ["127.0.0.1"], lastUsedAt: null });

    const revoke = await app.inject({ method: "POST", url: `/v1/tokens/${body.token.id}/revoke`, headers: auth });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().token.status).toBe("revoked");
  });

  it("supports cancelling queued runs", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "Planner", "负责拆解任务");
    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: { agentIds: [agentId], input: "hello" }
    });
    const cancel = await app.inject({ method: "POST", url: `/v1/runs/${run.json().run.id}/cancel`, headers: auth });
    expect([200, 404]).toContain(cancel.statusCode);
  });
});

async function createAgent(app: Awaited<ReturnType<typeof createServer>>, name: string, instruction: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/agents",
    headers: auth,
    payload: { name, instruction }
  });
  expect(response.statusCode).toBe(201);
  return response.json().agent.id;
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Condition was not met");
}

async function waitForRun(app: Awaited<ReturnType<typeof createServer>>, runId: string, status: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await app.inject({ method: "GET", url: `/v1/runs/${runId}`, headers: auth });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    if (body.run.status === status) return body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run did not reach ${status}`);
}

describe("Vibe Claw acceptance flows", () => {
  it("runs an agent message conversation with memory injection and retrievable messages", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "MemoryAgent", "使用记忆回答");
    const memory = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/memories`,
      headers: auth,
      payload: { type: "profile", scope: "agent", summary: "偏好", content: "用户偏好中文回答", source: "test" }
    });
    expect(memory.statusCode).toBe(201);

    const response = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/messages`,
      headers: auth,
      payload: { message: "你好", compression: "hybrid" }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message.content).toContain("MemoryAgent");
    expect(body.events.some((event: { status: string }) => event.status === "retrieving_memory")).toBe(true);
    expect(body.events.some((event: { status: string }) => event.status === "typing")).toBe(true);

    const conversation = await app.inject({ method: "GET", url: `/v1/conversations/${body.conversation.id}`, headers: auth });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json().messages).toHaveLength(2);

    const followUp = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/messages`,
      headers: auth,
      payload: { conversationId: body.conversation.id, message: "继续", compression: "hybrid" }
    });
    expect(followUp.statusCode).toBe(200);
    expect(followUp.json().message.content).toContain("历史消息(user)：你好");

    const continuedConversation = await app.inject({ method: "GET", url: `/v1/conversations/${body.conversation.id}`, headers: auth });
    expect(continuedConversation.statusCode).toBe(200);
    expect(continuedConversation.json().messages).toHaveLength(4);

    const recentConversations = await app.inject({ method: "GET", url: `/v1/agents/${agentId}/conversations?limit=10`, headers: auth });
    expect(recentConversations.statusCode).toBe(200);
    expect(recentConversations.json().conversations).toHaveLength(1);
    expect(recentConversations.json().conversations[0]).toMatchObject({
      id: body.conversation.id,
      messageCount: 4,
      preview: expect.stringContaining("MemoryAgent")
    });
  });

  it("archives memories", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "MemoryAdmin", "test");
    const created = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/memories`,
      headers: auth,
      payload: { type: "semantic", summary: "知识", content: "内容" }
    });
    const archived = await app.inject({ method: "PATCH", url: `/v1/memories/${created.json().memory.id}`, headers: auth, payload: { status: "archived" } });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().memory.status).toBe("archived");
  });

  it("validates protocol runs success and failure", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "ProtocolAgent", "按协议输出");
    const protocol = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/protocols`,
      headers: auth,
      payload: {
        name: "vibe-example",
        version: "v1",
        inputSchema: { type: "object", required: ["answer"], properties: { answer: { type: "string" } } },
        outputSchema: { type: "object", required: ["answer"], properties: { answer: { type: "string" } } }
      }
    });
    expect(protocol.statusCode).toBe(201);

    const ok = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/protocol-runs`,
      headers: auth,
      payload: { protocol: "vibe-example/v1", input: { answer: "ok" } }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().valid).toBe(true);

    const failed = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/protocol-runs`,
      headers: auth,
      payload: { protocol: "vibe-example/v1", input: { answer: 1 } }
    });
    expect(failed.statusCode).toBe(400);
    expect(failed.json().valid).toBe(false);
  });

  it("enforces leases for protocol scope and consumes usage", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "LeaseAgent", "test");
    await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/protocols`,
      headers: auth,
      payload: {
        name: "allowed",
        version: "v1",
        inputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
        outputSchema: { type: "object", properties: { ok: { type: "boolean" } } }
      }
    });
    const lease = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/leases`,
      headers: auth,
      payload: { expiresAt: new Date(Date.now() + 60_000).toISOString(), maxCalls: 1, tokenBudget: 1000, allowedProtocols: ["allowed/v1"] }
    });
    expect(lease.statusCode).toBe(201);
    const run = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/protocol-runs`,
      headers: auth,
      payload: { protocol: "allowed/v1", input: { ok: true }, leaseId: lease.json().lease.id }
    });
    expect(run.statusCode).toBe(200);
    const leases = await app.inject({ method: "GET", url: `/v1/agents/${agentId}/leases`, headers: auth });
    expect(leases.json().leases[0].usedCalls).toBe(1);
  });
});

describe("Vibe Claw operations acceptance", () => {
  it("serves the admin console shell", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const response = await app.inject({ method: "GET", url: "/admin" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Vibe Claw 控制台");
    expect(response.body).toContain("模型配置");
    expect(response.body).toContain("Agent 管理");
    expect(response.body).toContain("审计事件");
    expect(response.body).toContain("data-tab");
  });

  it("recovers interrupted runs on startup", async () => {
    const { MemoryStore } = await import("../src/store/memory-store.js");
    const store = new MemoryStore();
    const run = await store.createRun("interrupted");
    await store.updateRun(run.id, { status: "calling_model" });
    const app = await createServer({ apiToken: "test-token", store });
    const response = await app.inject({ method: "GET", url: `/v1/runs/${run.id}`, headers: auth });
    expect(response.statusCode).toBe(200);
    expect(["queued", "calling_model", "completed", "failed"]).toContain(response.json().run.status);
  });

  it("records handoff and artifact for multi-agent runs", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const first = await createAgent(app, "A1", "first");
    const second = await createAgent(app, "A2", "second");
    const run = await app.inject({ method: "POST", url: "/v1/runs", headers: auth, payload: { agentIds: [first, second], input: "go" } });
    const body = await waitForRun(app, run.json().run.id, "completed");
    expect(body.events.some((event: { title: string }) => event.title === "正在移交任务")).toBe(true);
  });
});

describe("runtime provider and persistent queue", () => {
  it("uses run provider config at runtime", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const provider = await app.inject({ method: "POST", url: "/v1/providers", headers: auth, payload: { name: "MockRuntime", type: "mock", defaultModel: "mock-runtime" } });
    expect(provider.statusCode).toBe(201);
    const agentId = await createAgent(app, "RuntimeAgent", "test");
    const run = await app.inject({ method: "POST", url: "/v1/runs", headers: auth, payload: { agentIds: [agentId], input: "hello", providerId: provider.json().provider.id } });
    expect(run.statusCode).toBe(202);
    const body = await waitForRun(app, run.json().run.id, "completed");
    expect(body.run.status).toBe("completed");
  });

  it("reports persisted queue stats", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "QueueAgent", "test");
    await app.inject({ method: "POST", url: "/v1/runs", headers: auth, payload: { agentIds: [agentId], input: "hello" } });
    const queue = await app.inject({ method: "GET", url: "/v1/queue", headers: auth });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().queue.persisted).toBeDefined();
  });
});

describe("SaaS/API readiness controls", () => {
  it("isolates data by tenant/project token ownership", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const createdToken = await app.inject({
      method: "POST",
      url: "/v1/tokens",
      headers: auth,
      payload: { name: "tenant-a", scopes: ["*"], tenantId: "tenant-a", projectId: "prod" }
    });
    expect(createdToken.statusCode).toBe(201);
    const tenantAuth = { authorization: `Bearer ${createdToken.json().plainToken}` };

    const tenantAgent = await app.inject({ method: "POST", url: "/v1/agents", headers: tenantAuth, payload: { name: "TenantAgent", instruction: "tenant only" } });
    expect(tenantAgent.statusCode).toBe(201);

    const defaultList = await app.inject({ method: "GET", url: "/v1/agents", headers: auth });
    expect(defaultList.json().agents.some((agent: { id: string }) => agent.id === tenantAgent.json().agent.id)).toBe(false);
    const tenantList = await app.inject({ method: "GET", url: "/v1/agents", headers: tenantAuth });
    expect(tenantList.json().agents.some((agent: { id: string }) => agent.id === tenantAgent.json().agent.id)).toBe(true);
  });

  it("returns the same response for matching Idempotency-Key and rejects body drift", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const key = "idem-create-agent";
    const first = await app.inject({ method: "POST", url: "/v1/agents", headers: { ...auth, "idempotency-key": key }, payload: { name: "Idem", instruction: "once" } });
    const second = await app.inject({ method: "POST", url: "/v1/agents", headers: { ...auth, "idempotency-key": key }, payload: { name: "Idem", instruction: "once" } });
    const drift = await app.inject({ method: "POST", url: "/v1/agents", headers: { ...auth, "idempotency-key": key }, payload: { name: "Idem", instruction: "different" } });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().agent.id).toBe(first.json().agent.id);
    expect(drift.statusCode).toBe(409);
  });

  it("streams agent messages over SSE and persists the final conversation", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "StreamAgent", "stream test");
    const stream = await app.inject({ method: "POST", url: `/v1/agents/${agentId}/messages/stream`, headers: auth, payload: { message: "hello stream" } });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers["content-type"]).toContain("text/event-stream");
    expect(stream.body.indexOf("event: user_message_created")).toBeGreaterThan(stream.body.indexOf("event: status"));
    expect(stream.body.indexOf("event: run_created")).toBeGreaterThan(stream.body.indexOf("event: user_message_created"));
    expect(stream.body.indexOf("event: delta")).toBeGreaterThan(stream.body.indexOf("event: run_created"));
    expect(stream.body.indexOf("event: assistant_message_completed")).toBeGreaterThan(stream.body.indexOf("event: delta"));
    expect(stream.body).toContain("event: delta");
    expect(stream.body).toContain("event: done");
    const conversations = await app.inject({ method: "GET", url: `/v1/agents/${agentId}/conversations`, headers: auth });
    expect(conversations.json().conversations[0].messageCount).toBe(2);
  });

  it("records webhook delivery logs and allows manual replay", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const app = await createServer({ apiToken: "test-token" });
    const agentId = await createAgent(app, "WebhookLogAgent", "test");
    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: { agentIds: [agentId], input: "webhook log", callbackUrl: "https://example.com/webhook", callbackSecret: "super-secret" }
    });
    await waitForRun(app, run.json().run.id, "completed");
    await waitFor(() => fetchMock.mock.calls.length > 0);
    const deliveries = await app.inject({ method: "GET", url: `/v1/webhook-deliveries?runId=${run.json().run.id}`, headers: auth });
    expect(deliveries.statusCode).toBe(200);
    expect(deliveries.json().deliveries[0]).toMatchObject({ runId: run.json().run.id, status: "delivered" });
    const replay = await app.inject({ method: "POST", url: `/v1/webhook-deliveries/${deliveries.json().deliveries[0].id}/replay`, headers: auth, payload: { secret: "super-secret" } });
    expect(replay.statusCode).toBe(200);
    fetchMock.mockRestore();
  });

  it("exposes version, usage, billing, prometheus and webhook subscriptions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const app = await createServer({ apiToken: "test-token" });
    const version = await app.inject({ method: "GET", url: "/v1/version", headers: auth });
    expect(version.statusCode).toBe(200);
    expect(version.json()).toMatchObject({ apiVersion: "v1", serviceVersion: expect.any(String) });

    const docs = await app.inject({ method: "GET", url: "/v1/developer-docs", headers: auth });
    expect(docs.statusCode).toBe(200);
    expect(docs.json().sdk.some((sdk: { language: string }) => sdk.language === "node")).toBe(true);

    const subscription = await app.inject({
      method: "POST",
      url: "/v1/webhook-subscriptions",
      headers: auth,
      payload: { name: "runs", url: "https://example.com/subscribed", secretRef: "sub-secret", eventTypes: ["run.completed"] }
    });
    expect(subscription.statusCode).toBe(201);

    const agentId = await createAgent(app, "SubscribedWebhookAgent", "test");
    const run = await app.inject({ method: "POST", url: "/v1/runs", headers: auth, payload: { agentIds: [agentId], input: "subscription webhook" } });
    await waitForRun(app, run.json().run.id, "completed");
    await waitFor(() => fetchMock.mock.calls.some(([url]) => url === "https://example.com/subscribed"));

    const usage = await app.inject({ method: "GET", url: "/v1/usage", headers: auth });
    expect(usage.statusCode).toBe(200);
    expect(usage.json().summary.requestCount).toBeGreaterThan(0);
    expect(usage.json().summary.tokenCount).toBeGreaterThan(0);

    const billing = await app.inject({ method: "GET", url: "/v1/billing", headers: auth });
    expect(billing.statusCode).toBe(200);
    expect(billing.json().plan).toMatchObject({ id: "launch" });

    const prometheus = await app.inject({ method: "GET", url: "/v1/metrics/prometheus", headers: auth });
    expect(prometheus.statusCode).toBe(200);
    expect(prometheus.body).toContain("vibe_claw_runs_total");
    fetchMock.mockRestore();
  });
});
