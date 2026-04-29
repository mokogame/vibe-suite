import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { newId } from "../core/ids.js";
import { Orchestrator } from "../core/orchestrator.js";
import { createDefaultProvider, type ModelProvider } from "../model/providers.js";
import { TokenRegistry } from "../security/tokens.js";
import { MemoryStore } from "../store/memory-store.js";
import type { AuthActor } from "../types.js";
import { openApiDocument } from "./openapi.js";
import { createAgentSchema, createRunSchema, parseBody, ValidationError } from "./schemas.js";

export type ServerOptions = {
  store?: MemoryStore;
  provider?: ModelProvider;
  apiToken?: string;
};

type AuthedRequest = FastifyRequest & {
  actor?: AuthActor;
  requestId?: string;
};

export async function createServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const store = options.store ?? new MemoryStore();
  const provider = options.provider ?? createDefaultProvider();
  const tokenRegistry = new TokenRegistry(store);
  tokenRegistry.registerPlainToken("default-api-token", options.apiToken ?? process.env.VIBE_CLAW_API_TOKEN ?? "dev-token", ["*"]);
  const orchestrator = new Orchestrator(store, provider);

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

    const actor = tokenRegistry.authenticate(token, requiredScope);
    if (!actor) {
      await reply.status(403).send({ error: "Token 无效或权限不足" });
      return reply;
    }
    authed.actor = actor;
  });

  app.get("/health", async () => ({
    ok: true,
    service: "vibe-claw",
    provider: provider.name
  }));

  app.get("/openapi.json", async () => openApiDocument);

  app.get("/v1/agents", async () => ({ agents: store.listAgents() }));

  app.post("/v1/agents", async (request, reply) => {
    const body = parseBody(createAgentSchema, request.body);
    const agent = store.createAgent(body);
    store.addAudit({
      id: newId("audit"),
      requestId: (request as AuthedRequest).requestId ?? newId("req"),
      actor: (request as AuthedRequest).actor?.name ?? "unknown",
      action: "agent.create",
      targetType: "agent",
      targetId: agent.id,
      status: "success",
      metadata: { name: agent.name },
      createdAt: new Date().toISOString()
    });
    return reply.status(201).send({ agent });
  });

  app.get<{ Params: { id: string } }>("/v1/agents/:id", async (request, reply) => {
    const agent = store.getAgent(request.params.id);
    if (!agent) return reply.status(404).send({ error: "Agent 不存在" });
    return { agent };
  });

  app.post("/v1/runs", async (request, reply) => {
    const body = parseBody(createRunSchema, request.body);
    const requestId = (request as AuthedRequest).requestId ?? newId("req");
    const actor = (request as AuthedRequest).actor;
    if (!actor) return reply.status(403).send({ error: "Token 无效或权限不足" });
    const result = await orchestrator.runAgents(requestId, actor, body);
    return reply.status(result.run.status === "failed" ? 422 : 201).send(result);
  });

  app.get("/v1/runs", async () => ({ runs: store.listRuns() }));

  app.get<{ Params: { id: string } }>("/v1/runs/:id", async (request, reply) => {
    const run = store.getRun(request.params.id);
    if (!run) return reply.status(404).send({ error: "Run 不存在" });
    return { run, steps: store.listSteps(run.id), events: store.listEvents(run.id) };
  });

  app.get<{ Params: { id: string } }>("/v1/runs/:id/events", async (request, reply) => {
    const run = store.getRun(request.params.id);
    if (!run) return reply.status(404).send({ error: "Run 不存在" });
    return { events: store.listEvents(run.id) };
  });

  app.get("/v1/audit-events", async () => ({ auditEvents: store.listAuditEvents() }));

  return app;
}

function scopeFor(method: string, url: string): string {
  if (url.startsWith("/v1/agents")) return method === "GET" ? "agents:read" : "agents:write";
  if (url.startsWith("/v1/runs")) return method === "GET" ? "runs:read" : "runs:write";
  if (url.startsWith("/v1/audit-events")) return "audit:read";
  return "*";
}
