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
import { scopeFor } from "./scopes.js";
import { registerAdminRoutes } from "./routes/admin-routes.js";
import { registerAgentRoutes } from "./routes/agent-routes.js";
import { registerProviderRoutes } from "./routes/provider-routes.js";
import { registerQueueRoutes, queueStats } from "./routes/queue-routes.js";
import { registerTokenRoutes } from "./routes/token-routes.js";
import { createAgentSchema, createLeaseSchema, createMemorySchema, createMessageSchema, createProtocolRunSchema, createProtocolSchema, createProviderSchema, createRunSchema, createTokenSchema, parseBody, updateAgentSchema, updateProviderSchema, ValidationError } from "./schemas.js";

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
  const orchestrator = new Orchestrator(store, provider, {
    modelTimeoutMs: Number(process.env.VIBE_CLAW_MODEL_TIMEOUT_MS ?? 90_000),
    contextTokenBudget: Number(process.env.VIBE_CLAW_CONTEXT_TOKEN_BUDGET ?? 6000),
    resolveProvider: async (providerId) => {
      if (!providerId) return provider;
      const config = await store.getProvider(providerId);
      if (!config) throw new Error("Provider 不存在：" + providerId);
      return createProviderFromConfig(config);
    }
  });
  const queue = new RunQueue(Number(process.env.VIBE_CLAW_RUN_CONCURRENCY ?? 2));
  await recoverInterruptedRuns(store, queue, orchestrator);

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

  const apiContext = { store, orchestrator, queue };
  registerAdminRoutes(app);

  registerAgentRoutes(app, apiContext);

  registerProviderRoutes(app, apiContext);

  app.post("/v1/runs", async (request, reply) => {
    const body = parseBody(createRunSchema, request.body);
    const requestId = (request as AuthedRequest).requestId ?? newId("req");
    const actor = (request as AuthedRequest).actor;
    if (!actor) return reply.status(403).send({ error: "Token 无效或权限不足" });
    const run = await orchestrator.createRun(requestId, actor, body);
    const task = await store.createQueueTask({ runId: run.id, requestId, actor, input: body });
    queue.enqueue(task.id, async () => {
      await store.updateQueueTask(task.id, { status: "running", attempts: task.attempts + 1, lockedAt: nowIso() });
      const result = await orchestrator.executeRun(requestId, actor, run.id, body);
      await store.updateQueueTask(task.id, { status: result.run.status === "completed" ? "completed" : "failed", lastError: result.run.errorMessage });
      if (body.callbackUrl) {
        const delivery = await deliverRunWebhook({
          url: body.callbackUrl,
          secret: body.callbackSecret,
          requestId,
          run: result.run,
          steps: result.steps,
          events: result.events
        });
        await store.addAudit({
          id: newId("audit"),
          requestId,
          actor: actor.name,
          action: "webhook.deliver",
          targetType: "run",
          targetId: run.id,
          status: delivery.ok ? "success" : "failed",
          metadata: { url: body.callbackUrl, statusCode: delivery.statusCode, error: delivery.error },
          createdAt: nowIso()
        });
      }
    });
    return reply.status(202).send({ run, events: await store.listEvents(run.id), queue: await queueStats(apiContext) });
  });

  app.get("/v1/runs", async () => ({ runs: await store.listRuns() }));

  app.get<{ Params: { id: string } }>("/v1/runs/:id", async (request, reply) => {
    const run = await store.getRun(request.params.id);
    if (!run) return reply.status(404).send({ error: "Run 不存在" });
    return { run, steps: await store.listSteps(run.id), events: await store.listEvents(run.id) };
  });

  app.post<{ Params: { id: string } }>("/v1/runs/:id/cancel", async (request, reply) => {
    const actor = (request as AuthedRequest).actor;
    if (!actor) return reply.status(403).send({ error: "Token 无效或权限不足" });
    const run = await orchestrator.cancelRun((request as AuthedRequest).requestId ?? newId("req"), actor, request.params.id);
    if (!run) return reply.status(404).send({ error: "Run 不存在" });
    return { run };
  });

  app.get<{ Params: { id: string } }>("/v1/runs/:id/events", async (request, reply) => {
    const run = await store.getRun(request.params.id);
    if (!run) return reply.status(404).send({ error: "Run 不存在" });
    return { events: await store.listEvents(run.id) };
  });

  registerQueueRoutes(app, apiContext);

  app.get("/v1/tools", async (request) => ({ tools: listTools((request as AuthedRequest).actor) }));

  registerTokenRoutes(app, apiContext);

  app.get("/v1/audit-events", async () => ({ auditEvents: await store.listAuditEvents() }));

  return app;
}

function createStoreFromEnv(): Store {
  const connectionString = process.env.VIBE_CLAW_DATABASE_URL ?? process.env.DATABASE_URL;
  return connectionString ? new PostgresStore({ connectionString }) : new MemoryStore();
}

const terminalRunStatuses = new Set(["completed", "failed", "cancelled"]);

async function recoverInterruptedRuns(store: Store, queue: RunQueue, orchestrator: Orchestrator) {
  const tasks = await store.listQueueTasks(["queued", "running"]);
  for (const task of tasks) {
    await store.updateQueueTask(task.id, { status: "queued", lockedAt: null, lastError: "服务启动恢复后重新排队" });
    queue.enqueue(task.id, async () => {
      await store.updateQueueTask(task.id, { status: "running", attempts: task.attempts + 1, lockedAt: nowIso() });
      const result = await orchestrator.executeRun(task.requestId, task.actor, task.runId, task.input);
      await store.updateQueueTask(task.id, { status: result.run.status === "completed" ? "completed" : "failed", lastError: result.run.errorMessage });
    });
  }
}

