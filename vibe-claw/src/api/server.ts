import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { newId, nowIso } from "../core/ids.js";
import { validateJsonSchema } from "../core/json-schema.js";
import { Orchestrator } from "../core/orchestrator.js";
import { RunQueue } from "../core/run-queue.js";
import { deliverRunWebhook } from "../core/webhooks.js";
import { readRuntimeStorageConfig, saveRuntimeStorageConfig } from "../config/runtime-config.js";
import { createDefaultProvider, createProviderFromConfig, type ModelProvider } from "../model/providers.js";
import { createPlainToken, hashToken, TokenRegistry } from "../security/tokens.js";
import { MemoryStore } from "../store/memory-store.js";
import { PostgresStore } from "../store/postgres-store.js";
import type { Store } from "../store/store.js";
import { listTools } from "../tools/registry.js";
import type { AuthedRequest } from "./context.js";
import { actorOf, filterScope, scopeOf, sameScope, withIdempotency } from "./route-utils.js";
import { scopeFor } from "./scopes.js";
import { registerAdminRoutes } from "./routes/admin-routes.js";
import { registerAgentRoutes } from "./routes/agent-routes.js";
import { registerProviderRoutes } from "./routes/provider-routes.js";
import { registerQueueRoutes, queueStats } from "./routes/queue-routes.js";
import { registerTokenRoutes } from "./routes/token-routes.js";
import { createAgentSchema, createLeaseSchema, createMemorySchema, createMessageSchema, createProtocolRunSchema, createProtocolSchema, createProviderSchema, createRunSchema, createTokenSchema, createWebhookSubscriptionSchema, parseBody, replayWebhookSchema, resetDataSchema, updateAgentSchema, updateProviderSchema, updateStorageConfigSchema, updateWebhookSubscriptionSchema, ValidationError } from "./schemas.js";
import type { AgentRun } from "../types.js";

export type ServerOptions = {
  store?: Store;
  provider?: ModelProvider;
  apiToken?: string;
};

export async function createServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const store = options.store ?? createStoreFromEnv();
  const provider = options.provider ?? createDefaultProvider();
  const defaultApiToken = options.apiToken ?? process.env.VIBE_CLAW_API_TOKEN ?? "dev-token";
  const tokenRegistry = new TokenRegistry(store);
  const registerDefaultToken = () => tokenRegistry.registerPlainToken("default-api-token", defaultApiToken, ["*"]);
  await registerDefaultToken();
  const usageLimiter = createUsageLimiter({
    windowMs: Number(process.env.VIBE_CLAW_RATE_LIMIT_WINDOW_MS ?? 60_000),
    maxRequests: Number(process.env.VIBE_CLAW_RATE_LIMIT_MAX ?? 600),
    maxConcurrency: Number(process.env.VIBE_CLAW_MAX_CONCURRENCY_PER_TOKEN ?? 20),
    dailyTokenQuota: Number(process.env.VIBE_CLAW_DAILY_TOKEN_QUOTA ?? 1_000_000),
    monthlyCostBudgetCents: Number(process.env.VIBE_CLAW_MONTHLY_COST_BUDGET_CENTS ?? 100_000),
    centsPer1kTokens: Number(process.env.VIBE_CLAW_COST_CENTS_PER_1K_TOKENS ?? 1)
  });
  const orchestrator = new Orchestrator(store, provider, {
    modelTimeoutMs: Number(process.env.VIBE_CLAW_MODEL_TIMEOUT_MS ?? 90_000),
    contextTokenBudget: Number(process.env.VIBE_CLAW_CONTEXT_TOKEN_BUDGET ?? 6000),
    resolveProvider: async (providerId, _agentProviderId, agentDefaultModel) => {
      const config = providerId
        ? await store.getProvider(providerId)
        : (await store.listProviders()).find((item) => item.status === "active" && item.defaultModel === agentDefaultModel) ?? null;
      if (providerId && !config) throw new Error(`Provider 不存在：${providerId}`);
      if (!config) return provider;
      return createProviderFromConfig(config);
    },
    onUsage: async ({ actor, agentId, provider: providerName, totalTokens }) => {
      usageLimiter.recordUsage(actor, { agentId, provider: providerName, tokens: totalTokens });
      await store.recordUsage({
        ...scopeOf(actor),
        tokenId: actor.tokenId,
        agentId,
        providerId: providerName,
        usageWindow: usageWindow(),
        tokenCount: totalTokens,
        costUnits: Math.ceil((totalTokens / 1000) * Number(process.env.VIBE_CLAW_COST_CENTS_PER_1K_TOKENS ?? 1))
      });
    }
  });
  const queue = new RunQueue(Number(process.env.VIBE_CLAW_RUN_CONCURRENCY ?? 2));
  const workerId = `${process.pid}-${newId("worker")}`;
  await recoverInterruptedRuns(store, queue, orchestrator, workerId);

  const app = Fastify({ logger: false });
  const corsOrigin = process.env.VIBE_CLAW_CORS_ORIGIN ? process.env.VIBE_CLAW_CORS_ORIGIN.split(",").map((item) => item.trim()).filter(Boolean) : true;
  await app.register(cors, { origin: corsOrigin });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ValidationError) {
      void reply.status(error.statusCode).send({ error: error.message });
      return;
    }
    const normalized = error as { statusCode?: unknown; message?: unknown };
    const statusCode = typeof normalized.statusCode === "number" ? normalized.statusCode : 500;
    const message = typeof normalized.message === "string" ? normalized.message : "请求失败";
    void reply.status(statusCode).send({ error: statusCode >= 500 ? "内部服务错误" : message });
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (reply.statusCode < 400) return payload;
    const requestId = (request as AuthedRequest).requestId ?? request.headers["x-request-id"]?.toString() ?? newId("req");
    const raw = Buffer.isBuffer(payload) ? payload.toString("utf8") : typeof payload === "string" ? payload : "";
    let body: Record<string, unknown> = {};
    try {
      body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    } catch {
      body = { error: raw || "请求失败" };
    }
    const message = String(body.message ?? body.error ?? "请求失败");
    const code = String(body.code ?? errorCodeForStatus(reply.statusCode));
    reply.header("content-type", "application/json; charset=utf-8");
    return JSON.stringify({
      ...body,
      error: body.error ?? message,
      code,
      message,
      details: body.details ?? errorDetails(body),
      requestId
    });
  });

  app.addHook("onRequest", async (request, reply) => {
    const authed = request as AuthedRequest;
    authed.requestId = request.headers["x-request-id"]?.toString() || newId("req");
    reply.header("x-request-id", authed.requestId);

    if (request.url === "/health") return;
    if (request.url === "/openapi.json") return;
    if (!request.url.startsWith("/v1/")) return;

    const requiredScope = scopeFor(request.method, request.url);
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (!token) {
      await reply.status(401).send({ error: "缺少 Bearer Token" });
      return reply;
    }

    const actor = await tokenRegistry.authenticate(token, requiredScope, request.ip);
    if (!actor) {
      await reply.status(403).send({ error: "Token 无效或权限不足" });
      return reply;
    }
    authed.actor = actor;
    await store.recordUsage({ ...scopeOf(actor), tokenId: actor.tokenId, usageWindow: usageWindow(), requestCount: 1 });
    const limit = usageLimiter.enter(actor);
    if (!limit.allowed) {
      await reply.status(429).send({ error: limit.reason, remaining: limit.remaining });
      return reply;
    }
    (authed as AuthedRequest & { limitKey?: string }).limitKey = limit.key;
  });

  app.addHook("onResponse", async (request, reply) => {
    if (request.url === "/health") return;
    const authed = request as AuthedRequest;
    console.log(JSON.stringify({
      level: "info",
      msg: "request.completed",
      requestId: authed.requestId,
      tenantId: authed.actor?.tenantId,
      projectId: authed.actor?.projectId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      traceId: authed.requestId
    }));
    const limitKey = (authed as AuthedRequest & { limitKey?: string }).limitKey;
    if (limitKey) usageLimiter.leave(limitKey);
  });

  app.get("/health", async () => {
    const storeHealth = await store.healthCheck();
    return {
      ok: storeHealth.ok,
      service: "vibe-claw",
      provider: provider.name,
      store: storeHealth,
      queue: await queueStats(apiContext)
    };
  });

  app.get("/v1/admin/storage-config", async () => {
    const storeHealth = await store.healthCheck();
    return { config: await readRuntimeStorageConfig(storeHealth.type) };
  });

  app.post("/v1/admin/storage-config", async (request) => {
    const input = parseBody(updateStorageConfigSchema, request.body);
    const storeHealth = await store.healthCheck();
    const config = await saveRuntimeStorageConfig(input, storeHealth.type);
    return {
      config,
      requiresRestart: true,
      message: "存储配置已写入 .env.local；当前进程不会热切换存储，请重启服务后生效。"
    };
  });

  app.post("/v1/admin/restart", async () => {
    if (process.env.NODE_ENV === "test" || process.env.VIBE_CLAW_DISABLE_ADMIN_RESTART === "1") {
      return {
        ok: false,
        restartScheduled: false,
        message: "当前环境已禁用后台重启；生产环境请由进程管理器执行重启。"
      };
    }
    setTimeout(() => process.exit(0), 300).unref();
    return {
      ok: true,
      restartScheduled: true,
      message: "服务将在当前响应返回后退出；请确保 dev watcher、PM2、systemd 或容器平台会自动拉起进程。"
    };
  });

  app.post("/v1/admin/reset-data", async (request) => {
    parseBody(resetDataSchema, request.body);
    const before = await store.healthCheck();
    const result = await store.resetData();
    const clearedQueueTasks = queue.clearPending();
    await registerDefaultToken();
    return {
      ok: true,
      storeType: result.storeType,
      cleared: result.cleared,
      clearedQueueTasks,
      message: before.type === "postgres"
        ? "当前 Postgres 数据已重置；保留数据库结构和存储配置，已重新写入默认 API Token。"
        : "当前内存数据已清空；已重新写入默认 API Token。"
    };
  });

  app.get("/v1/metrics", async (request) => {
    const scope = scopeOf(request as AuthedRequest);
    const [runs, tasks, deliveries, audits] = await Promise.all([
      store.listRuns(),
      store.listQueueTasks(),
      store.listWebhookDeliveries(),
      store.listAuditEvents()
    ]);
    const scopedRuns = filterScope(runs, scope);
    const scopedTasks = filterScope(tasks, scope);
    const scopedDeliveries = filterScope(deliveries, scope);
    const scopedAudits = filterScope(audits, scope);
    return {
      metrics: {
        runCount: scopedRuns.length,
        tokenUsage: scopedRuns.reduce((sum, run) => sum + run.totalTokens, 0),
        errorRate: scopedRuns.length === 0 ? 0 : scopedRuns.filter((run) => run.status === "failed").length / scopedRuns.length,
        providerLatencySamples: scopedAudits.filter((event) => event.action === "provider.call.completed").map((event) => event.metadata.latencyMs).filter((value) => typeof value === "number"),
        queue: {
          queued: scopedTasks.filter((task) => task.status === "queued").length,
          running: scopedTasks.filter((task) => task.status === "running").length,
          deadLetter: scopedTasks.filter((task) => task.status === "dead_letter").length
        },
        webhook: {
          failed: scopedDeliveries.filter((delivery) => delivery.status === "failed").length,
          deadLetter: scopedDeliveries.filter((delivery) => delivery.status === "dead_letter").length
        },
        traceField: "requestId"
      }
    };
  });

  app.get("/v1/metrics/prometheus", async (request, reply) => {
    const scope = scopeOf(request as AuthedRequest);
    const [runs, tasks, usage] = await Promise.all([store.listRuns(), store.listQueueTasks(), store.listUsageCounters(scope)]);
    const scopedRuns = filterScope(runs, scope);
    const scopedTasks = filterScope(tasks, scope);
    const lines = [
      "# HELP vibe_claw_runs_total Total runs by status",
      "# TYPE vibe_claw_runs_total counter",
      ...countBy(scopedRuns, "status").map(([status, count]) => `vibe_claw_runs_total{status="${status}"} ${count}`),
      "# HELP vibe_claw_queue_tasks Current persisted queue tasks by status",
      "# TYPE vibe_claw_queue_tasks gauge",
      ...countBy(scopedTasks, "status").map(([status, count]) => `vibe_claw_queue_tasks{status="${status}"} ${count}`),
      "# HELP vibe_claw_usage_requests_total Persisted API requests",
      "# TYPE vibe_claw_usage_requests_total counter",
      `vibe_claw_usage_requests_total ${usage.reduce((sum, item) => sum + item.requestCount, 0)}`,
      "# HELP vibe_claw_usage_tokens_total Persisted model tokens",
      "# TYPE vibe_claw_usage_tokens_total counter",
      `vibe_claw_usage_tokens_total ${usage.reduce((sum, item) => sum + item.tokenCount, 0)}`
    ];
    reply.type("text/plain; version=0.0.4; charset=utf-8");
    return lines.join("\n") + "\n";
  });

  app.get("/v1/version", async () => ({
    apiVersion: "v1",
    serviceVersion: "0.4.0",
    compatibility: "v1 endpoints are additive within the same major API version.",
    deprecationPolicy: "Deprecated fields keep a minimum 90-day compatibility window and are documented in CHANGELOG.",
    changelog: ["/v1 adds agents, runs, messages, memories, tokens, usage, billing and webhooks."]
  }));

  app.get("/v1/developer-docs", async () => ({
    documents: [
      { title: "Developer API", path: "docs/developer-api.md" },
      { title: "API Versioning", path: "docs/API_VERSIONING.md" },
      { title: "Changelog", path: "docs/CHANGELOG.md" }
    ],
    sdk: [
      { language: "node", path: "sdk/node/client.mjs" },
      { language: "python", path: "sdk/python/client.py" }
    ]
  }));

  app.get("/v1/usage", async (request) => {
    const counters = await store.listUsageCounters(scopeOf(request as AuthedRequest));
    return { usage: counters, summary: summarizeUsage(counters) };
  });

  app.get("/v1/billing", async (request) => {
    const usage = await store.listUsageCounters(scopeOf(request as AuthedRequest));
    const plan = billingPlan();
    return { plan, usage: summarizeUsage(usage), invoices: [{ id: `invoice_${usageWindow().slice(0, 7)}`, status: "draft", amountCents: summarizeUsage(usage).costUnits }] };
  });

  const apiContext = { store, orchestrator, queue };
  registerAdminRoutes(app);

  registerAgentRoutes(app, apiContext);

  registerProviderRoutes(app, apiContext);

  app.post("/v1/runs", async (request, reply) => {
    const body = parseBody(createRunSchema, request.body);
    const requestId = (request as AuthedRequest).requestId ?? newId("req");
    const actor = actorOf(request as AuthedRequest);
    const scope = scopeOf(actor);
    return withIdempotency(store, request as AuthedRequest, reply, async () => {
      const run = await orchestrator.createRun(requestId, actor, body);
      const task = await store.createQueueTask({ ...scope, runId: run.id, requestId, actor, input: body });
      enqueuePersistedRun(queue, store, orchestrator, workerId, body.callbackUrl ? { secret: body.callbackSecret } : undefined);
      return { statusCode: 202, body: { run, events: await store.listEvents(run.id), queue: await queueStats(apiContext) } };
    });
  });

  app.get("/v1/runs", async (request) => {
    const runs = filterScope(await store.listRuns(), scopeOf(request as AuthedRequest));
    return { runs: await Promise.all(runs.map((run) => enrichRunForList(store, run))) };
  });

  app.get<{ Params: { id: string } }>("/v1/runs/:id", async (request, reply) => {
    const run = await store.getRun(request.params.id);
    if (!run || !sameScope(run, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Run 不存在" });
    return { run: await enrichRunForList(store, run), steps: await store.listSteps(run.id), events: await store.listEvents(run.id) };
  });

  app.post<{ Params: { id: string } }>("/v1/runs/:id/cancel", async (request, reply) => {
    const actor = (request as AuthedRequest).actor;
    if (!actor) return reply.status(403).send({ error: "Token 无效或权限不足" });
    const existing = await store.getRun(request.params.id);
    if (!existing || !sameScope(existing, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Run 不存在" });
    const run = await orchestrator.cancelRun((request as AuthedRequest).requestId ?? newId("req"), actor, existing.id);
    if (!run) return reply.status(404).send({ error: "Run 不存在" });
    return { run };
  });

  app.get<{ Params: { id: string } }>("/v1/runs/:id/events", async (request, reply) => {
    const run = await store.getRun(request.params.id);
    if (!run || !sameScope(run, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Run 不存在" });
    return { events: await store.listEvents(run.id) };
  });

  registerQueueRoutes(app, apiContext);

  app.get("/v1/webhook-deliveries", async (request) => {
    const runId = (request.query as { runId?: string }).runId;
    return { deliveries: filterScope(await store.listWebhookDeliveries(runId), scopeOf(request as AuthedRequest)) };
  });

  app.get("/v1/webhook-subscriptions", async (request) => ({
    subscriptions: await store.listWebhookSubscriptions(scopeOf(request as AuthedRequest))
  }));

  app.post("/v1/webhook-subscriptions", async (request, reply) => {
    const body = parseBody(createWebhookSubscriptionSchema, request.body);
    const subscription = await store.createWebhookSubscription({ ...scopeOf(request as AuthedRequest), ...body, eventTypes: body.eventTypes ?? ["run.completed"] });
    return reply.status(201).send({ subscription });
  });

  app.patch<{ Params: { id: string } }>("/v1/webhook-subscriptions/:id", async (request, reply) => {
    const existing = (await store.listWebhookSubscriptions(scopeOf(request as AuthedRequest))).find((item) => item.id === request.params.id);
    if (!existing) return reply.status(404).send({ error: "Webhook subscription 不存在" });
    const subscription = await store.updateWebhookSubscription(existing.id, parseBody(updateWebhookSubscriptionSchema, request.body));
    return { subscription };
  });

  app.post<{ Params: { id: string } }>("/v1/webhook-deliveries/:id/replay", async (request, reply) => {
    const delivery = (await store.listWebhookDeliveries()).find((item) => item.id === request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!delivery || !sameScope(delivery, scope)) return reply.status(404).send({ error: "Webhook delivery 不存在" });
    const run = await store.getRun(delivery.runId);
    if (!run || !sameScope(run, scope)) return reply.status(404).send({ error: "Run 不存在" });
    const sent = await deliverRunWebhook({
      url: delivery.url,
      secret: parseBody(replayWebhookSchema, request.body ?? {}).secret,
      requestId: (request as AuthedRequest).requestId ?? newId("req"),
      run,
      steps: await store.listSteps(run.id),
      events: await store.listEvents(run.id)
    });
    const updated = await store.updateWebhookDelivery(delivery.id, {
      status: sent.ok ? "delivered" : "failed",
      attempts: delivery.attempts + 1,
      statusCode: sent.statusCode ?? null,
      error: sent.error ?? null,
      nextAttemptAt: null
    });
    return { delivery: updated };
  });

  app.get("/v1/tools", async (request) => ({ tools: listTools((request as AuthedRequest).actor) }));

  registerTokenRoutes(app, apiContext);

  app.get("/v1/audit-events", async () => ({ auditEvents: await store.listAuditEvents() }));

  return app;
}

async function enrichRunForList(store: Store, run: AgentRun) {
  const steps = await store.listSteps(run.id);
  const conversation = await store.findConversationByRunId(run.id);
  const agentId = steps[0]?.agentId ?? conversation?.agentId ?? null;
  const agent = agentId ? await store.getAgent(agentId) : null;
  return {
    ...run,
    agentId,
    agentName: agent?.name ?? null,
    conversationId: conversation?.id ?? null,
    lastCallAt: run.updatedAt || run.createdAt,
    stepCount: steps.length
  };
}

function createStoreFromEnv(): Store {
  if (process.env.VIBE_CLAW_STORAGE_MODE === "memory") return new MemoryStore();
  const connectionString = process.env.VIBE_CLAW_DATABASE_URL ?? process.env.DATABASE_URL;
  if (process.env.VIBE_CLAW_STORAGE_MODE === "postgres" && !connectionString) {
    throw new Error("VIBE_CLAW_STORAGE_MODE=postgres 时必须配置 VIBE_CLAW_DATABASE_URL 或 DATABASE_URL");
  }
  return connectionString ? new PostgresStore({ connectionString }) : new MemoryStore();
}

const terminalRunStatuses = new Set(["completed", "failed", "cancelled"]);

async function recoverInterruptedRuns(store: Store, queue: RunQueue, orchestrator: Orchestrator, workerId: string) {
  const tasks = await store.listQueueTasks(["queued", "running"]);
  for (const task of tasks) {
    await store.updateQueueTask(task.id, { status: "queued", lockedAt: null, lockedBy: null, lockExpiresAt: null, lastError: "服务启动恢复后重新排队" });
    enqueuePersistedRun(queue, store, orchestrator, workerId);
  }
}

function enqueuePersistedRun(queue: RunQueue, store: Store, orchestrator: Orchestrator, workerId: string, webhookOptions?: { secret?: string }) {
  queue.enqueue(newId("queuejob"), async () => {
    const task = await store.claimQueueTask(workerId, new Date(Date.now() + 5 * 60_000).toISOString());
    if (!task) return;
    const result = await orchestrator.executeRun(task.requestId, task.actor, task.runId, task.input);
    const terminalStatus = result.run.status === "completed" ? "completed" : task.attempts + 1 >= (task.maxAttempts ?? 3) ? "dead_letter" : "failed";
    await store.updateQueueTask(task.id, {
      status: terminalStatus,
      lockedBy: null,
      lockExpiresAt: null,
      lastError: result.run.errorMessage,
      nextRunAt: terminalStatus === "failed" ? new Date(Date.now() + retryDelayMs(task.attempts)).toISOString() : null
    });
    if (terminalStatus === "failed") enqueuePersistedRun(queue, store, orchestrator, workerId, webhookOptions);
    if (["completed", "failed", "dead_letter"].includes(terminalStatus)) {
      if (task.input.callbackUrl) {
        await deliverReliableWebhook(store, task, result, { url: task.input.callbackUrl, secret: webhookOptions?.secret ?? task.input.callbackSecret });
      }
      const eventType = `run.${terminalStatus === "dead_letter" ? "failed" : terminalStatus}`;
      const subscriptions = (await store.listWebhookSubscriptions(task))
        .filter((item) => item.status === "active" && (item.eventTypes.includes(eventType) || item.eventTypes.includes("run.*")));
      for (const subscription of subscriptions) {
        await deliverReliableWebhook(store, task, result, { url: subscription.url, secret: subscription.secretRef ?? undefined });
      }
    }
  });
}

async function deliverReliableWebhook(
  store: Store,
  task: Awaited<ReturnType<Store["claimQueueTask"]>> & {},
  result: Awaited<ReturnType<Orchestrator["executeRun"]>>,
  target: { url: string; secret?: string }
) {
  if (!task) return;
  const delivery = await store.createWebhookDelivery({
    tenantId: task.tenantId,
    projectId: task.projectId,
    runId: task.runId,
    url: target.url,
    status: "queued",
    attempts: 0,
    maxAttempts: 3,
    nextAttemptAt: nowIso(),
    statusCode: null,
    error: null
  });
  let current = delivery;
  for (let attempt = 1; attempt <= delivery.maxAttempts; attempt += 1) {
    const sent = await deliverRunWebhook({
      url: target.url,
      secret: target.secret,
      requestId: task.requestId,
      run: result.run,
      steps: result.steps,
      events: result.events
    });
    current = await store.updateWebhookDelivery(current.id, {
      attempts: attempt,
      status: sent.ok ? "delivered" : attempt >= delivery.maxAttempts ? "dead_letter" : "failed",
      statusCode: sent.statusCode ?? null,
      error: sent.error ?? null,
      nextAttemptAt: sent.ok || attempt >= delivery.maxAttempts ? null : new Date(Date.now() + retryDelayMs(attempt)).toISOString()
    });
    await store.addAudit({
      id: newId("audit"),
      tenantId: task.tenantId,
      projectId: task.projectId,
      requestId: task.requestId,
      actor: task.actor.name,
      action: "webhook.deliver",
      targetType: "run",
      targetId: task.runId,
      status: sent.ok ? "success" : "failed",
      metadata: { deliveryId: current.id, url: target.url, statusCode: sent.statusCode, error: sent.error },
      createdAt: nowIso()
    });
    if (sent.ok) return;
    if (attempt < delivery.maxAttempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
  }
}

function retryDelayMs(attempt: number): number {
  return Math.min(10_000, 250 * 2 ** Math.max(0, attempt));
}

function usageWindow(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function billingPlan() {
  return {
    id: "launch",
    name: "Launch",
    monthlyRequestLimit: Number(process.env.VIBE_CLAW_PLAN_MONTHLY_REQUESTS ?? 1_000_000),
    monthlyTokenLimit: Number(process.env.VIBE_CLAW_PLAN_MONTHLY_TOKENS ?? 50_000_000),
    monthlyCostLimitCents: Number(process.env.VIBE_CLAW_MONTHLY_COST_BUDGET_CENTS ?? 100_000),
    features: ["agents", "messages", "runs", "memories", "webhooks", "audit", "usage"]
  };
}

function summarizeUsage(counters: Array<{ requestCount: number; tokenCount: number; costUnits: number }>) {
  return counters.reduce(
    (sum, item) => ({
      requestCount: sum.requestCount + item.requestCount,
      tokenCount: sum.tokenCount + item.tokenCount,
      costUnits: sum.costUnits + item.costUnits
    }),
    { requestCount: 0, tokenCount: 0, costUnits: 0 }
  );
}

function countBy<T extends Record<string, unknown>>(items: T[], key: keyof T): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(String(item[key]), (counts.get(String(item[key])) ?? 0) + 1);
  return [...counts.entries()];
}

function errorCodeForStatus(statusCode: number): string {
  if (statusCode === 400) return "VALIDATION_ERROR";
  if (statusCode === 401) return "AUTH_MISSING";
  if (statusCode === 403) return "FORBIDDEN";
  if (statusCode === 404) return "NOT_FOUND";
  if (statusCode === 409) return "CONFLICT";
  if (statusCode === 422) return "UNPROCESSABLE_ENTITY";
  if (statusCode === 429) return "RATE_LIMITED";
  if (statusCode >= 500) return "INTERNAL_ERROR";
  return "REQUEST_FAILED";
}

function errorDetails(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !["error", "code", "message", "requestId"].includes(key)));
}

function createUsageLimiter(options: { windowMs: number; maxRequests: number; maxConcurrency: number; dailyTokenQuota: number; monthlyCostBudgetCents: number; centsPer1kTokens: number }) {
  const requests = new Map<string, { count: number; resetAt: number }>();
  const active = new Map<string, number>();
  const dailyTokens = new Map<string, { tokens: number; day: string }>();
  const monthlyCosts = new Map<string, { cents: number; month: string }>();
  return {
    enter(actor: { tenantId?: string; projectId?: string; tokenId: string }): { allowed: true; key: string; remaining: Record<string, number> } | { allowed: false; key: string; reason: string; remaining: Record<string, number> } {
      const key = `${actor.tenantId}:${actor.projectId}:${actor.tokenId}`;
      const now = Date.now();
      const bucket = requests.get(key);
      if (!bucket || bucket.resetAt <= now) {
        requests.set(key, { count: 0, resetAt: now + options.windowMs });
      }
      const current = requests.get(key)!;
      const concurrent = active.get(key) ?? 0;
      const day = new Date().toISOString().slice(0, 10);
      const month = new Date().toISOString().slice(0, 7);
      const tokenBucket = dailyTokens.get(key);
      const costBucket = monthlyCosts.get(key);
      const usedTokens = tokenBucket?.day === day ? tokenBucket.tokens : 0;
      const usedCost = costBucket?.month === month ? costBucket.cents : 0;
      const remaining = {
        requests: Math.max(0, options.maxRequests - current.count),
        concurrency: Math.max(0, options.maxConcurrency - concurrent),
        dailyTokens: Math.max(0, options.dailyTokenQuota - usedTokens),
        monthlyCostCents: Math.max(0, options.monthlyCostBudgetCents - usedCost)
      };
      if (current.count >= options.maxRequests) return { allowed: false, key, reason: "QPS/窗口请求数超限", remaining };
      if (concurrent >= options.maxConcurrency) return { allowed: false, key, reason: "并发数超限", remaining };
      if (usedTokens >= options.dailyTokenQuota) return { allowed: false, key, reason: "每日 token 额度已耗尽", remaining };
      if (usedCost >= options.monthlyCostBudgetCents) return { allowed: false, key, reason: "月度成本预算已耗尽", remaining };
      current.count += 1;
      active.set(key, concurrent + 1);
      return { allowed: true, key, remaining };
    },
    leave(key: string): void {
      active.set(key, Math.max(0, (active.get(key) ?? 1) - 1));
    },
    recordUsage(actor: { tenantId?: string; projectId?: string; tokenId: string }, usage: { agentId: string; provider: string; tokens: number }): void {
      const key = `${actor.tenantId}:${actor.projectId}:${actor.tokenId}`;
      const day = new Date().toISOString().slice(0, 10);
      const month = new Date().toISOString().slice(0, 7);
      const currentTokens = dailyTokens.get(key);
      dailyTokens.set(key, { day, tokens: (currentTokens?.day === day ? currentTokens.tokens : 0) + usage.tokens });
      const currentCost = monthlyCosts.get(key);
      const cents = Math.ceil((usage.tokens / 1000) * options.centsPer1kTokens);
      monthlyCosts.set(key, { month, cents: (currentCost?.month === month ? currentCost.cents : 0) + cents });
    }
  };
}
