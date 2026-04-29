import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { newId, nowIso } from "../core/ids.js";
import { compressContext } from "../core/compression.js";
import { validateJsonSchema } from "../core/json-schema.js";
import { Orchestrator } from "../core/orchestrator.js";
import { RunQueue } from "../core/run-queue.js";
import { deliverRunWebhook } from "../core/webhooks.js";
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
import { createAgentSchema, createLeaseSchema, createMemorySchema, createMessageSchema, createProtocolRunSchema, createProtocolSchema, createProviderSchema, createRunSchema, createTokenSchema, parseBody, updateAgentSchema, updateProviderSchema, ValidationError } from "./schemas.js";
import type { AgentRun } from "../types.js";

export type ServerOptions = {
  store?: Store;
  provider?: ModelProvider;
  apiToken?: string;
};

export async function createServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const store = options.store ?? createStoreFromEnv();
  const provider = options.provider ?? createDefaultProvider();
  const tokenRegistry = new TokenRegistry(store);
  await tokenRegistry.registerPlainToken("default-api-token", options.apiToken ?? process.env.VIBE_CLAW_API_TOKEN ?? "dev-token", ["*"]);
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
    resolveProvider: async (providerId) => {
      if (!providerId) return provider;
      const config = await store.getProvider(providerId);
      if (!config) throw new Error("Provider 不存在：" + providerId);
      return createProviderFromConfig(config);
    },
    onUsage: async ({ actor, agentId, provider: providerName, totalTokens }) => {
      usageLimiter.recordUsage(actor, { agentId, provider: providerName, tokens: totalTokens });
    }
  });
  const queue = new RunQueue(Number(process.env.VIBE_CLAW_RUN_CONCURRENCY ?? 2));
  const workerId = `${process.pid}-${newId("worker")}`;
  await recoverInterruptedRuns(store, queue, orchestrator, workerId);

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

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

    const actor = await tokenRegistry.authenticate(token, requiredScope);
    if (!actor) {
      await reply.status(403).send({ error: "Token 无效或权限不足" });
      return reply;
    }
    authed.actor = actor;
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

  app.post<{ Params: { id: string } }>("/v1/webhook-deliveries/:id/replay", async (request, reply) => {
    const delivery = (await store.listWebhookDeliveries()).find((item) => item.id === request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!delivery || !sameScope(delivery, scope)) return reply.status(404).send({ error: "Webhook delivery 不存在" });
    const run = await store.getRun(delivery.runId);
    if (!run || !sameScope(run, scope)) return reply.status(404).send({ error: "Run 不存在" });
    const sent = await deliverRunWebhook({
      url: delivery.url,
      secret: (request.body as { secret?: string } | undefined)?.secret,
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
  const connectionString = process.env.VIBE_CLAW_DATABASE_URL ?? process.env.DATABASE_URL;
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
    if (task.input.callbackUrl && ["completed", "failed", "dead_letter"].includes(terminalStatus)) {
      await deliverReliableWebhook(store, task, result, webhookOptions?.secret ?? task.input.callbackSecret);
    }
  });
}

async function deliverReliableWebhook(
  store: Store,
  task: Awaited<ReturnType<Store["claimQueueTask"]>> & {},
  result: Awaited<ReturnType<Orchestrator["executeRun"]>>,
  secret?: string
) {
  if (!task || !task.input.callbackUrl) return;
  const delivery = await store.createWebhookDelivery({
    tenantId: task.tenantId,
    projectId: task.projectId,
    runId: task.runId,
    url: task.input.callbackUrl,
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
      url: task.input.callbackUrl,
      secret,
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
      metadata: { deliveryId: current.id, url: task.input.callbackUrl, statusCode: sent.statusCode, error: sent.error },
      createdAt: nowIso()
    });
    if (sent.ok) return;
    if (attempt < delivery.maxAttempts) await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
  }
}

function retryDelayMs(attempt: number): number {
  return Math.min(10_000, 250 * 2 ** Math.max(0, attempt));
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
