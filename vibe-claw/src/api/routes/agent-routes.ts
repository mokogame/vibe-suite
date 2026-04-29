import type { FastifyInstance } from "fastify";
import { newId, nowIso } from "../../core/ids.js";
import { compressContext } from "../../core/compression.js";
import { validateJsonSchema } from "../../core/json-schema.js";
import type { ApiContext, AuthedRequest } from "../context.js";
import { createAgentSchema, createLeaseSchema, createMemorySchema, createMessageSchema, createProtocolRunSchema, createProtocolSchema, parseBody, updateAgentSchema } from "../schemas.js";

export function registerAgentRoutes(app: FastifyInstance, { store, orchestrator }: ApiContext): void {
  async function validateLease(leaseId: string | undefined, agentId: string, protocol: string | undefined) {
    if (!leaseId) return null;
    const lease = await store.getLease(leaseId);
    if (!lease || lease.agentId !== agentId) return { status: 403, error: "租约无效" };
    if (lease.status !== "active" || new Date(lease.expiresAt).getTime() <= Date.now()) return { status: 403, error: "租约已失效" };
    if (lease.usedCalls >= lease.maxCalls) return { status: 403, error: "租约调用次数已耗尽" };
    if (lease.usedTokens >= lease.tokenBudget) return { status: 403, error: "租约 token 预算已耗尽" };
    if (protocol && lease.allowedProtocols.length > 0 && !lease.allowedProtocols.includes(protocol)) return { status: 403, error: "租约不允许该协议" };
    return null;
  }

  app.get("/v1/agents", async () => ({ agents: await store.listAgents() }));

  app.post("/v1/agents", async (request, reply) => {
    const body = parseBody(createAgentSchema, request.body);
    const agent = await store.createAgent(body);
    await store.addAudit({
      id: newId("audit"),
      requestId: (request as AuthedRequest).requestId ?? newId("req"),
      actor: (request as AuthedRequest).actor?.name ?? "unknown",
      action: "agent.create",
      targetType: "agent",
      targetId: agent.id,
      status: "success",
      metadata: { name: agent.name },
      createdAt: nowIso()
    });
    return reply.status(201).send({ agent });
  });

  app.get<{ Params: { id: string } }>("/v1/agents/:id", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    if (!agent) return reply.status(404).send({ error: "Agent 不存在" });
    return { agent };
  });

  app.patch<{ Params: { id: string } }>("/v1/agents/:id", async (request, reply) => {
    const body = parseBody(updateAgentSchema, request.body);
    const agent = await store.updateAgent(request.params.id, body);
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
    const agent = await store.updateAgent(request.params.id, { status: "archived" });
    if (!agent) return reply.status(404).send({ error: "Agent 不存在" });
    return { agent };
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/leases", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    if (!agent) return reply.status(404).send({ error: "Agent 不存在" });
    const body = parseBody(createLeaseSchema, request.body);
    const actor = (request as AuthedRequest).actor;
    const lease = await store.createLease({ ...body, allowedProtocols: body.allowedProtocols ?? [], agentId: agent.id, createdBy: actor?.name ?? "unknown" });
    await store.addAudit({ id: newId("audit"), requestId: (request as AuthedRequest).requestId ?? newId("req"), actor: actor?.name ?? "unknown", action: "lease.create", targetType: "lease", targetId: lease.id, status: "success", metadata: { agentId: agent.id }, createdAt: nowIso() });
    return reply.status(201).send({ lease });
  });

  app.get<{ Params: { id: string } }>("/v1/agents/:id/leases", async (request) => ({ leases: await store.listLeases(request.params.id) }));

  app.post<{ Params: { id: string } }>("/v1/agents/:id/memories", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    if (!agent) return reply.status(404).send({ error: "Agent 不存在" });
    const body = parseBody(createMemorySchema, request.body);
    const actor = (request as AuthedRequest).actor;
    const memory = await store.createMemory({ ...body, scope: body.scope ?? "agent", source: body.source ?? "api", agentId: agent.id, createdBy: actor?.name ?? "unknown" });
    await store.addAudit({ id: newId("audit"), requestId: (request as AuthedRequest).requestId ?? newId("req"), actor: actor?.name ?? "unknown", action: "memory.create", targetType: "memory", targetId: memory.id, status: "success", metadata: { agentId: agent.id, type: memory.type, scope: memory.scope }, createdAt: nowIso() });
    return reply.status(201).send({ memory });
  });

  app.get<{ Params: { id: string } }>("/v1/agents/:id/memories", async (request) => ({ memories: await store.listMemories(request.params.id) }));

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/v1/agents/:id/conversations", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    if (!agent) return reply.status(404).send({ error: "Agent 不存在" });
    const limit = Math.max(1, Math.min(50, Number(request.query.limit ?? 10) || 10));
    const conversations = (await store.listConversations(agent.id)).slice(0, limit);
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
    const memory = await store.updateMemoryStatus(request.params.id, body.status);
    if (!memory) return reply.status(404).send({ error: "Memory 不存在" });
    return { memory };
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/messages", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    if (!agent || agent.status !== "active") return reply.status(404).send({ error: "Agent 不存在或不可用" });
    const body = parseBody(createMessageSchema, request.body);
    const actor = (request as AuthedRequest).actor ?? { tokenId: "unknown", name: "unknown", scopes: [] };
    const leaseCheck = await validateLease(body.leaseId, agent.id, undefined);
    if (leaseCheck) return reply.status(leaseCheck.status).send({ error: leaseCheck.error });
    const conversation = body.conversationId ? await store.getConversation(body.conversationId) : await store.createConversation({ agentId: agent.id, mode: "message" });
    if (!conversation || conversation.agentId !== agent.id) return reply.status(404).send({ error: "Conversation 不存在" });
    const historyMessages = body.conversationId ? await store.listMessages(conversation.id) : [];
    const userMessage = await store.addMessage({ conversationId: conversation.id, agentId: agent.id, role: "user", content: body.message });
    const requestId = (request as AuthedRequest).requestId ?? newId("req");
    const run = await orchestrator.createRun(requestId, actor, { agentIds: [agent.id], input: body.message, context: body.context });
    await store.addEvent({ runId: run.id, stepId: null, status: "typing", title: "正在输入", summary: agent.name + " 已收到消息，正在准备回复。", visible: true });
    await store.addEvent({ runId: run.id, stepId: null, status: "retrieving_memory", title: "正在检索记忆", summary: "正在读取 Agent 相关长期记忆。", visible: true });
    const memories = (await store.listMemories(agent.id)).filter((memory) => memory.status === "active");
    const memoryContext = memories.map((memory) => ({ source: "memory" as const, content: memory.type + ":" + memory.summary + "\n" + memory.content, priority: memory.type === "profile" ? 90 : 65 }));
    const historyContext = historyMessages.slice(-12).map((message) => ({
      source: message.role,
      content: `历史消息(${message.role})：${message.content}`,
      priority: message.role === "agent" ? 72 : 68
    }));
    const externalContext = normalizeContext(body.context ?? []);
    const compressed = compressContext([...memoryContext, ...historyContext, ...externalContext], body.compression ?? "hybrid", Number(process.env.VIBE_CLAW_CONTEXT_TOKEN_BUDGET ?? 6000));
    await store.addCompressionAudit({ runId: run.id, strategy: body.compression ?? "hybrid", strategyVersion: "v1", originalTokens: compressed.originalTokens, compressedTokens: compressed.compressedTokens, kept: compressed.kept, summarized: compressed.summarized, dropped: compressed.dropped });
    await store.addAudit({ id: newId("audit"), requestId, actor: actor.name, action: "memory.injected", targetType: "run", targetId: run.id, status: "success", metadata: { memoryIds: memories.map((memory) => memory.id), contextCount: compressed.context.length }, createdAt: nowIso() });
    const result = await orchestrator.executeRun(requestId, actor, run.id, { agentIds: [agent.id], input: body.message, context: compressed.context });
    const message = await store.addMessage({ conversationId: conversation.id, agentId: agent.id, role: "agent", content: result.run.output ?? "", runId: run.id, totalTokens: result.run.totalTokens });
    if (body.leaseId) await store.consumeLease(body.leaseId, result.run.totalTokens);
    await store.addArtifact({ runId: run.id, type: "text", name: "agent-message", content: message.content });
    return { conversation, userMessage, message, run: result.run, events: result.events, usage: { totalTokens: result.run.totalTokens } };
  });

  app.get<{ Params: { id: string } }>("/v1/conversations/:id", async (request, reply) => {
    const conversation = await store.getConversation(request.params.id);
    if (!conversation) return reply.status(404).send({ error: "Conversation 不存在" });
    return { conversation, messages: await store.listMessages(conversation.id) };
  });

  app.get<{ Params: { id: string } }>("/v1/conversations/:id/messages", async (request, reply) => {
    const conversation = await store.getConversation(request.params.id);
    if (!conversation) return reply.status(404).send({ error: "Conversation 不存在" });
    return { messages: await store.listMessages(conversation.id) };
  });

  app.post<{ Params: { id: string } }>("/v1/agents/:id/protocols", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    if (!agent) return reply.status(404).send({ error: "Agent 不存在" });
    const body = parseBody(createProtocolSchema, request.body);
    const protocol = await store.createProtocol({ ...body, agentId: agent.id });
    return reply.status(201).send({ protocol });
  });

  app.get<{ Params: { id: string } }>("/v1/agents/:id/protocols", async (request) => ({ protocols: await store.listProtocols(request.params.id) }));

  app.post<{ Params: { id: string } }>("/v1/agents/:id/protocol-runs", async (request, reply) => {
    const agent = await store.getAgent(request.params.id);
    if (!agent || agent.status !== "active") return reply.status(404).send({ error: "Agent 不存在或不可用" });
    const body = parseBody(createProtocolRunSchema, request.body);
    const [name, version] = splitProtocol(body.protocol);
    const protocol = await store.getProtocol(agent.id, name, version);
    if (!protocol) return reply.status(404).send({ error: "Protocol 不存在" });
    const leaseCheck = await validateLease(body.leaseId, agent.id, body.protocol);
    if (leaseCheck) return reply.status(leaseCheck.status).send({ error: leaseCheck.error });
    const inputIssues = validateJsonSchema(protocol.inputSchema, body.input);
    if (inputIssues.length > 0) return reply.status(400).send({ protocol: body.protocol, valid: false, result: null, rawText: "", issues: inputIssues, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
    const outputIssues = validateJsonSchema(protocol.outputSchema, body.input);
    const requestId = (request as AuthedRequest).requestId ?? newId("req");
    const actor = (request as AuthedRequest).actor ?? { tokenId: "unknown", name: "unknown", scopes: [] };
    const conversation = body.conversationId ? await store.getConversation(body.conversationId) : await store.createConversation({ agentId: agent.id, mode: "protocol" });
    if (!conversation) return reply.status(404).send({ error: "Conversation 不存在" });
    const run = await orchestrator.createRun(requestId, actor, { agentIds: [agent.id], input: JSON.stringify(body.input), context: body.context });
    await store.addMessage({ conversationId: conversation.id, agentId: agent.id, role: "user", content: JSON.stringify({ protocol: body.protocol, input: body.input }), runId: run.id });
    await store.addAudit({ id: newId("audit"), requestId, actor: actor.name, action: "protocol.validate", targetType: "run", targetId: run.id, status: outputIssues.length === 0 ? "success" : "failed", metadata: { protocolName: name, protocolVersion: version, issues: outputIssues }, createdAt: nowIso() });
    if (outputIssues.length > 0) {
      const failed = await store.updateRun(run.id, { status: "failed", errorType: "protocol_validation_failed", errorMessage: "协议输出校验失败" });
      return reply.status(422).send({ protocol: body.protocol, valid: false, result: null, rawText: JSON.stringify(body.input), issues: outputIssues, run: failed, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
    }
    const rawText = JSON.stringify(body.input);
    const completed = await store.updateRun(run.id, { status: "completed", output: rawText, totalTokens: rawText.length });
    await store.addMessage({ conversationId: conversation.id, agentId: agent.id, role: "agent", content: rawText, runId: run.id, totalTokens: rawText.length });
    if (body.leaseId) await store.consumeLease(body.leaseId, rawText.length);
    await store.addArtifact({ runId: run.id, type: "json", name: body.protocol, content: rawText });
    return { protocol: body.protocol, valid: true, result: body.input, rawText, run: completed, usage: { inputTokens: rawText.length, outputTokens: rawText.length, totalTokens: rawText.length } };
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
