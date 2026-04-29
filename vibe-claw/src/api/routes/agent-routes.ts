import type { FastifyInstance } from "fastify";
import { newId, nowIso } from "../../core/ids.js";
import { compressContext } from "../../core/compression.js";
import { validateJsonSchema } from "../../core/json-schema.js";
import type { ApiContext, AuthedRequest } from "../context.js";
import { actorOf, filterScope, scopeOf, sameScope, withIdempotency } from "../route-utils.js";
import { createAgentSchema, createLeaseSchema, createMemorySchema, createMessageSchema, createProtocolRunSchema, createProtocolSchema, parseBody, updateAgentSchema } from "../schemas.js";

export function registerAgentRoutes(app: FastifyInstance, { store, orchestrator }: ApiContext): void {
  const httpError = (statusCode: number, message: string) => {
    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = statusCode;
    return error;
  };

  const executeMessageFlow = async (
    agentId: string,
    request: AuthedRequest,
    emit?: (event: string, data: Record<string, unknown>) => void | Promise<void>
  ) => {
    const agent = await store.getAgent(agentId);
    const scope = scopeOf(request);
    if (!agent || !sameScope(agent, scope) || agent.status !== "active") throw httpError(404, "Agent 不存在或不可用");
    const body = parseBody(createMessageSchema, request.body);
    const actor = actorOf(request);
    const leaseCheck = await validateLease(body.leaseId, agent.id, undefined, scope);
    if (leaseCheck) throw httpError(leaseCheck.status, leaseCheck.error);
    const conversation = body.conversationId ? await store.getConversation(body.conversationId) : await store.createConversation({ ...scope, agentId: agent.id, mode: "message" });
    if (!conversation || conversation.agentId !== agent.id || !sameScope(conversation, scope)) throw httpError(404, "Conversation 不存在");

    const requestId = request.requestId ?? newId("req");
    const lockHolder = `${requestId}:${actor.tokenId}`;
    await waitForConversationLock(store, scope, conversation.id, lockHolder);
    try {
      const historyMessages = body.conversationId ? await store.listMessages(conversation.id) : [];
      const userMessage = await store.addMessage({ ...scope, conversationId: conversation.id, agentId: agent.id, role: "user", content: body.message });
      await emit?.("conversation", { conversation });
      await emit?.("user_message_created", { conversationId: conversation.id, message: userMessage });

      const run = await orchestrator.createRun(requestId, actor, { agentIds: [agent.id], input: body.message, context: body.context });
      await emit?.("run_created", { run });
      const typingEvent = await store.addEvent({ ...scope, runId: run.id, stepId: null, status: "typing", title: "正在输入", summary: agent.name + " 已收到消息，正在准备回复。", visible: true });
      await emit?.("status", { status: "typing", runId: run.id, event: typingEvent });
      const memoryEvent = await store.addEvent({ ...scope, runId: run.id, stepId: null, status: "retrieving_memory", title: "正在检索记忆", summary: "正在读取 Agent 相关长期记忆。", visible: true });
      await emit?.("status", { status: "retrieving_memory", runId: run.id, event: memoryEvent });

      const memories = filterScope(await store.listMemories(agent.id), scope).filter((memory) => memory.status === "active");
      const memoryContext = memories.map((memory) => ({ source: "memory" as const, content: memory.type + ":" + memory.summary + "\n" + memory.content, priority: memory.type === "profile" ? 90 : 65 }));
      const historyContext = historyMessages.slice(-12).map((message) => ({
        source: message.role,
        content: `历史消息(${message.role})：${message.content}`,
        priority: message.role === "agent" ? 72 : 68
      }));
      const externalContext = normalizeContext(body.context ?? []);
      const compressed = compressContext([...memoryContext, ...historyContext, ...externalContext], body.compression ?? "hybrid", Number(process.env.VIBE_CLAW_CONTEXT_TOKEN_BUDGET ?? 6000));
      await store.addCompressionAudit({ ...scope, runId: run.id, strategy: body.compression ?? "hybrid", strategyVersion: "v1", originalTokens: compressed.originalTokens, compressedTokens: compressed.compressedTokens, kept: compressed.kept, summarized: compressed.summarized, dropped: compressed.dropped });
      await store.addAudit({ id: newId("audit"), ...scope, requestId, actor: actor.name, action: "memory.injected", targetType: "run", targetId: run.id, status: "success", metadata: { memoryIds: memories.map((memory) => memory.id), contextCount: compressed.context.length, sourceIp: request.ip, userAgent: request.headers["user-agent"] ?? null }, createdAt: nowIso() });
      await emit?.("status", { status: "building_context", runId: run.id, contextCount: compressed.context.length });

      const result = await orchestrator.executeRun(requestId, actor, run.id, { agentIds: [agent.id], input: body.message, context: compressed.context });
      const failed = result.run.status !== "completed";
      const message = await store.addMessage({
        ...scope,
        conversationId: conversation.id,
        agentId: agent.id,
        role: failed ? "system" : "agent",
        content: failed ? `调用失败：${result.run.errorMessage ?? "Agent run failed"}` : result.run.output ?? "",
        runId: run.id,
        totalTokens: result.run.totalTokens
      });
      if (body.leaseId) await store.consumeLease(body.leaseId, result.run.totalTokens);
      await store.addArtifact({ ...scope, runId: run.id, type: "text", name: failed ? "agent-message-error" : "agent-message", content: message.content });
      return { statusCode: 200, body: { conversation, userMessage, message, run: result.run, events: result.events, usage: { totalTokens: result.run.totalTokens } } };
    } finally {
      await store.releaseConversationLock(conversation.id, lockHolder);
    }
  };

  async function validateLease(leaseId: string | undefined, agentId: string, protocol: string | undefined, scope = { tenantId: "default", projectId: "default" }) {
    if (!leaseId) return null;
    const lease = await store.getLease(leaseId);
    if (!lease || lease.agentId !== agentId || !sameScope(lease, scope)) return { status: 403, error: "租约无效" };
    if (lease.status !== "active" || new Date(lease.expiresAt).getTime() <= Date.now()) return { status: 403, error: "租约已失效" };
    if (lease.usedCalls >= lease.maxCalls) return { status: 403, error: "租约调用次数已耗尽" };
    if (lease.usedTokens >= lease.tokenBudget) return { status: 403, error: "租约 token 预算已耗尽" };
    if (protocol && lease.allowedProtocols.length > 0 && !lease.allowedProtocols.includes(protocol)) return { status: 403, error: "租约不允许该协议" };
    return null;
  }

  app.get("/v1/agents", async (request) => ({ agents: filterScope(await store.listAgents(), scopeOf(request as AuthedRequest)) }));

  app.post("/v1/agents", async (request, reply) => {
    const body = parseBody(createAgentSchema, request.body);
    const scope = scopeOf(request as AuthedRequest);
    return withIdempotency(store, request as AuthedRequest, reply, async () => {
      const agent = await store.createAgent({ ...body, ...scope });
      await store.addAudit({
        id: newId("audit"),
        ...scope,
        requestId: (request as AuthedRequest).requestId ?? newId("req"),
        actor: (request as AuthedRequest).actor?.name ?? "unknown",
        action: "agent.create",
        targetType: "agent",
        targetId: agent.id,
        status: "success",
        metadata: { name: agent.name, sourceIp: request.ip, userAgent: request.headers["user-agent"] ?? null },
        createdAt: nowIso()
      });
      return { statusCode: 201, body: { agent } };
    });
  });

  app.get<{ Params: { id: string } }>("/v1/agents/:id", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    if (!agent || !sameScope(agent, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Agent 不存在" });
    return { agent };
  });

  app.patch<{ Params: { id: string } }>("/v1/agents/:id", async (request, reply) => {
    const body = parseBody(updateAgentSchema, request.body);
    const existing = await store.getAgent(request.params.id);
    if (!existing || !sameScope(existing, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Agent 不存在" });
    const agent = await store.updateAgent(existing.id, body);
    if (!agent) return reply.status(404).send({ error: "Agent 不存在" });
    await store.addAudit({
      id: newId("audit"),
      requestId: (request as AuthedRequest).requestId ?? newId("req"),
      actor: (request as AuthedRequest).actor?.name ?? "unknown",
      action: "agent.update",
      targetType: "agent",
      targetId: agent.id,
      status: "success",
      metadata: { fields: Object.keys(body) },
      createdAt: nowIso()
    });
    return { agent };
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/archive", async (request, reply) => {
    const existing = await store.getAgent(request.params.id);
    if (!existing || !sameScope(existing, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Agent 不存在" });
    const agent = await store.updateAgent(existing.id, { status: "archived" });
    if (!agent) return reply.status(404).send({ error: "Agent 不存在" });
    return { agent };
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/leases", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!agent || !sameScope(agent, scope)) return reply.status(404).send({ error: "Agent 不存在" });
    const body = parseBody(createLeaseSchema, request.body);
    const actor = actorOf(request as AuthedRequest);
    return withIdempotency(store, request as AuthedRequest, reply, async () => {
      const lease = await store.createLease({ ...body, ...scope, allowedProtocols: body.allowedProtocols ?? [], agentId: agent.id, createdBy: actor.name });
      await store.addAudit({ id: newId("audit"), ...scope, requestId: (request as AuthedRequest).requestId ?? newId("req"), actor: actor.name, action: "lease.create", targetType: "lease", targetId: lease.id, status: "success", metadata: { agentId: agent.id, sourceIp: request.ip, userAgent: request.headers["user-agent"] ?? null }, createdAt: nowIso() });
      return { statusCode: 201, body: { lease } };
    });
  });

  app.get<{ Params: { id: string } }>("/v1/agents/:id/leases", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!agent || !sameScope(agent, scope)) return reply.status(404).send({ error: "Agent 不存在" });
    return { leases: filterScope(await store.listLeases(request.params.id), scope) };
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/memories", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!agent || !sameScope(agent, scope)) return reply.status(404).send({ error: "Agent 不存在" });
    const body = parseBody(createMemorySchema, request.body);
    const actor = actorOf(request as AuthedRequest);
    return withIdempotency(store, request as AuthedRequest, reply, async () => {
      const memory = await store.createMemory({ ...body, ...scope, scope: body.scope ?? "agent", source: body.source ?? "api", agentId: agent.id, createdBy: actor.name });
      await store.addAudit({ id: newId("audit"), ...scope, requestId: (request as AuthedRequest).requestId ?? newId("req"), actor: actor.name, action: "memory.create", targetType: "memory", targetId: memory.id, status: "success", metadata: { agentId: agent.id, type: memory.type, scope: memory.scope, sourceIp: request.ip, userAgent: request.headers["user-agent"] ?? null }, createdAt: nowIso() });
      return { statusCode: 201, body: { memory } };
    });
  });

  app.get<{ Params: { id: string } }>("/v1/agents/:id/memories", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!agent || !sameScope(agent, scope)) return reply.status(404).send({ error: "Agent 不存在" });
    return { memories: filterScope(await store.listMemories(request.params.id), scope) };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/v1/agents/:id/conversations", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!agent || !sameScope(agent, scope)) return reply.status(404).send({ error: "Agent 不存在" });
    const limit = Math.max(1, Math.min(50, Number(request.query.limit ?? 10) || 10));
    const conversations = filterScope(await store.listConversations(agent.id), scope).slice(0, limit);
    const items = await Promise.all(conversations.map(async (conversation) => {
      const messages = await store.listMessages(conversation.id);
      const lastMessage = messages.at(-1) ?? null;
      return {
        ...conversation,
        messageCount: messages.length,
        lastMessage: lastMessage ? {
          id: lastMessage.id,
          role: lastMessage.role,
          content: lastMessage.content,
          createdAt: lastMessage.createdAt
        } : null,
        preview: lastMessage?.content.slice(0, 120) ?? conversation.summary
      };
    }));
    return { conversations: items };
  });

  app.patch<{ Params: { id: string } }>("/v1/memories/:id", async (request, reply) => {
    const body = request.body as { status?: "active" | "archived" | "rejected" };
    if (!body?.status || !["active", "archived", "rejected"].includes(body.status)) return reply.status(400).send({ error: "status 无效" });
    const current = (await Promise.all((await store.listAgents()).map((agent) => store.listMemories(agent.id)))).flat().find((memory) => memory.id === request.params.id);
    if (!current || !sameScope(current, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Memory 不存在" });
    const memory = await store.updateMemoryStatus(request.params.id, body.status);
    if (!memory) return reply.status(404).send({ error: "Memory 不存在" });
    return { memory };
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/messages", async (request, reply) => {
    return withIdempotency(store, request as AuthedRequest, reply, () => executeMessageFlow(request.params.id, request as AuthedRequest));
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/messages/stream", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const send = (event: string, data: Record<string, unknown>) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    send("status", { status: "started", requestId: (request as AuthedRequest).requestId });
    try {
      const response = await executeMessageFlow(request.params.id, request as AuthedRequest, send);
      const payload = response.body;
      if (payload.run.status === "completed" && payload.message.role === "agent") {
        for (const part of chunkText(payload.message.content, 80)) send("delta", { text: part, messageId: payload.message.id, runId: payload.run.id });
        send("assistant_message_completed", { message: payload.message, run: payload.run });
      } else {
        send("error", { statusCode: 200, error: payload.message.content, message: payload.message, run: payload.run });
      }
      send("done", { conversationId: payload.conversation.id, runId: payload.run.id, status: payload.run.status });
    } catch (error) {
      const typed = error as Error & { statusCode?: number };
      send("error", { statusCode: typed.statusCode ?? 500, error: typed.message || "流式对话失败" });
    } finally {
      reply.raw.end();
    }
    return reply;
  });

  app.get<{ Params: { id: string } }>("/v1/conversations/:id", async (request, reply) => {
    const conversation = await store.getConversation(request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!conversation || !sameScope(conversation, scope)) return reply.status(404).send({ error: "Conversation 不存在" });
    return { conversation, messages: filterScope(await store.listMessages(conversation.id), scope) };
  });

  app.get<{ Params: { id: string } }>("/v1/conversations/:id/messages", async (request, reply) => {
    const conversation = await store.getConversation(request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!conversation || !sameScope(conversation, scope)) return reply.status(404).send({ error: "Conversation 不存在" });
    return { messages: filterScope(await store.listMessages(conversation.id), scope) };
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/protocols", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!agent || !sameScope(agent, scope)) return reply.status(404).send({ error: "Agent 不存在" });
    const body = parseBody(createProtocolSchema, request.body);
    const protocol = await store.createProtocol({ ...body, ...scope, agentId: agent.id });
    return reply.status(201).send({ protocol });
  });

  app.get<{ Params: { id: string } }>("/v1/agents/:id/protocols", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!agent || !sameScope(agent, scope)) return reply.status(404).send({ error: "Agent 不存在" });
    return { protocols: filterScope(await store.listProtocols(request.params.id), scope) };
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/protocol-runs", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    const scope = scopeOf(request as AuthedRequest);
    if (!agent || !sameScope(agent, scope) || agent.status !== "active") return reply.status(404).send({ error: "Agent 不存在或不可用" });
    const body = parseBody(createProtocolRunSchema, request.body);
    const [name, version] = splitProtocol(body.protocol);
    const protocol = await store.getProtocol(agent.id, name, version);
    if (!protocol || !sameScope(protocol, scope)) return reply.status(404).send({ error: "Protocol 不存在" });
    const leaseCheck = await validateLease(body.leaseId, agent.id, body.protocol, scope);
    if (leaseCheck) return reply.status(leaseCheck.status).send({ error: leaseCheck.error });
    const inputIssues = validateJsonSchema(protocol.inputSchema, body.input);
    if (inputIssues.length > 0) return reply.status(400).send({ protocol: body.protocol, valid: false, result: null, rawText: "", issues: inputIssues, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
    const requestId = (request as AuthedRequest).requestId ?? newId("req");
    const actor = actorOf(request as AuthedRequest);
    const conversation = body.conversationId ? await store.getConversation(body.conversationId) : await store.createConversation({ ...scope, agentId: agent.id, mode: "protocol" });
    if (!conversation || !sameScope(conversation, scope)) return reply.status(404).send({ error: "Conversation 不存在" });
    const run = await orchestrator.createRun(requestId, actor, { agentIds: [agent.id], input: JSON.stringify(body.input), context: body.context });
    await store.addMessage({ ...scope, conversationId: conversation.id, agentId: agent.id, role: "user", content: JSON.stringify({ protocol: body.protocol, input: body.input }), runId: run.id });
    const prompt = `请严格按 JSON 输出协议 ${body.protocol} 的结果，不要输出 Markdown。输入：${JSON.stringify(body.input)}`;
    const executed = await orchestrator.executeRun(requestId, actor, run.id, { agentIds: [agent.id], input: prompt, context: body.context });
    const rawCandidate = executed.run.output ?? "";
    const parsed = parseProtocolJson(rawCandidate) ?? body.input;
    const rawText = JSON.stringify(parsed);
    const outputIssues = validateJsonSchema(protocol.outputSchema, parsed);
    await store.addAudit({ id: newId("audit"), ...scope, requestId, actor: actor.name, action: "protocol.validate", targetType: "run", targetId: run.id, status: outputIssues.length === 0 ? "success" : "failed", metadata: { protocolName: name, protocolVersion: version, issues: outputIssues, repaired: rawCandidate !== rawText, sourceIp: request.ip, userAgent: request.headers["user-agent"] ?? null }, createdAt: nowIso() });
    if (outputIssues.length > 0) {
      const failed = await store.updateRun(run.id, { status: "failed", errorType: "protocol_validation_failed", errorMessage: "协议输出校验失败", output: rawText });
      return reply.status(422).send({ protocol: body.protocol, valid: false, result: parsed, rawText, issues: outputIssues, run: failed, usage: { inputTokens: 0, outputTokens: rawText.length, totalTokens: rawText.length } });
    }
    const completed = await store.updateRun(run.id, { status: "completed", output: rawText, totalTokens: executed.run.totalTokens || rawText.length });
    await store.addMessage({ ...scope, conversationId: conversation.id, agentId: agent.id, role: "agent", content: rawText, runId: run.id, totalTokens: rawText.length });
    if (body.leaseId) await store.consumeLease(body.leaseId, rawText.length);
    await store.addArtifact({ ...scope, runId: run.id, type: "json", name: body.protocol, content: rawText });
    return { protocol: body.protocol, valid: true, result: parsed, rawText, run: completed, usage: { inputTokens: rawText.length, outputTokens: rawText.length, totalTokens: completed.totalTokens } };
  });


}

function normalizeContext(context: Array<string | { source?: string; content: string; priority?: number; sensitive?: boolean }>) {
  return context.map((item) => typeof item === "string" ? { source: "user" as const, content: item, priority: 50 } : { source: (item.source ?? "user") as "user", content: item.content, priority: item.priority ?? 50, sensitive: item.sensitive });
}

function splitProtocol(protocol: string): [string, string] {
  const index = protocol.lastIndexOf("/");
  if (index === -1) return [protocol, "v1"];
  return [protocol.slice(0, index), protocol.slice(index + 1)];
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
  return chunks.length > 0 ? chunks : [""];
}

function parseProtocolJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const json = trimmed.startsWith("{") ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function waitForConversationLock(
  store: ApiContext["store"],
  scope: { tenantId: string; projectId: string },
  conversationId: string,
  holder: string
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const lockUntil = new Date(Date.now() + 90_000).toISOString();
    if (await store.acquireConversationLock(scope, conversationId, holder, lockUntil)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const error = new Error("Conversation 当前正在处理上一条消息，请稍后重试") as Error & { statusCode?: number };
  error.statusCode = 409;
  throw error;
}
