import { newId, nowIso } from "../core/ids.js";
import type { Agent, AgentConversation, AgentLease, AgentMemory, AgentMessage, AgentProtocol, AgentRun, ApiToken, AuditEvent, CompressionAudit, ModelProviderConfig, RunArtifact, RunEvent, RunQueueTask, RunStep } from "../types.js";
import type { CreateAgentData, CreateArtifactData, CreateCompressionAuditData, CreateConversationData, CreateLeaseData, CreateMemoryData, CreateMessageData, CreateProtocolData, CreateProviderData, CreateRunQueueTaskData, Store, UpdateAgentData, UpdateProviderData } from "./store.js";
import { withoutUndefined } from "./store.js";

export class MemoryStore implements Store {
  async healthCheck() {
    return { ok: true, type: "memory" as const };
  }

  private agents = new Map<string, Agent>();
  private providers = new Map<string, ModelProviderConfig>();
  private memories = new Map<string, AgentMemory>();
  private conversations = new Map<string, AgentConversation>();
  private messages = new Map<string, AgentMessage>();
  private protocols = new Map<string, AgentProtocol>();
  private leases = new Map<string, AgentLease>();
  private artifacts = new Map<string, RunArtifact>();
  private compressionAudits = new Map<string, CompressionAudit>();
  private queueTasks = new Map<string, RunQueueTask>();
  private runs = new Map<string, AgentRun>();
  private steps = new Map<string, RunStep>();
  private events = new Map<string, RunEvent>();
  private tokens = new Map<string, ApiToken>();
  private audits = new Map<string, AuditEvent>();

  async createAgent(data: CreateAgentData): Promise<Agent> {
    const now = nowIso();
    const agent: Agent = {
      id: newId("agent"),
      name: data.name,
      description: data.description ?? "",
      instruction: data.instruction,
      status: "active",
      defaultModel: data.defaultModel ?? "mock",
      providerId: data.providerId ?? null,
      createdAt: now,
      updatedAt: now
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  async updateAgent(id: string, patch: UpdateAgentData): Promise<Agent | null> {
    const current = this.agents.get(id);
    if (!current) return null;
    const next = { ...current, ...withoutUndefined(patch), updatedAt: nowIso() };
    this.agents.set(id, next);
    return next;
  }

  async listAgents(): Promise<Agent[]> {
    return [...this.agents.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getAgent(id: string): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }


  async createProvider(data: CreateProviderData): Promise<ModelProviderConfig> {
    const now = nowIso();
    const provider: ModelProviderConfig = {
      id: newId("provider"),
      name: data.name,
      type: data.type,
      status: "active",
      baseUrl: data.baseUrl ?? null,
      defaultModel: data.defaultModel,
      apiKeyRef: data.apiKeyRef ?? null,
      timeoutMs: data.timeoutMs ?? 30_000,
      maxRetries: data.maxRetries ?? 2,
      createdAt: now,
      updatedAt: now
    };
    this.providers.set(provider.id, provider);
    return provider;
  }

  async updateProvider(id: string, patch: UpdateProviderData): Promise<ModelProviderConfig | null> {
    const current = this.providers.get(id);
    if (!current) return null;
    const next = { ...current, ...withoutUndefined(patch), updatedAt: nowIso() };
    this.providers.set(id, next);
    return next;
  }

  async listProviders(): Promise<ModelProviderConfig[]> {
    return [...this.providers.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getProvider(id: string): Promise<ModelProviderConfig | null> {
    return this.providers.get(id) ?? null;
  }

  async createMemory(data: CreateMemoryData): Promise<AgentMemory> {
    const now = nowIso();
    const memory: AgentMemory = { id: newId("mem"), status: "active", sourceRunId: data.sourceRunId ?? null, createdAt: now, updatedAt: now, ...data };
    this.memories.set(memory.id, memory);
    return memory;
  }

  async listMemories(agentId: string): Promise<AgentMemory[]> {
    return [...this.memories.values()].filter((item) => item.agentId === agentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateMemoryStatus(id: string, status: AgentMemory["status"]): Promise<AgentMemory | null> {
    const current = this.memories.get(id);
    if (!current) return null;
    const next = { ...current, status, updatedAt: nowIso() };
    this.memories.set(id, next);
    return next;
  }

  async createConversation(data: CreateConversationData): Promise<AgentConversation> {
    const now = nowIso();
    const conversation: AgentConversation = { id: newId("conv"), agentId: data.agentId, mode: data.mode, status: "active", summary: data.summary ?? "", createdAt: now, updatedAt: now };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async getConversation(id: string): Promise<AgentConversation | null> {
    return this.conversations.get(id) ?? null;
  }

  async listConversations(agentId?: string): Promise<AgentConversation[]> {
    return [...this.conversations.values()].filter((item) => !agentId || item.agentId === agentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async addMessage(data: CreateMessageData): Promise<AgentMessage> {
    const message: AgentMessage = { id: newId("msg"), runId: data.runId ?? null, inputTokens: data.inputTokens ?? 0, outputTokens: data.outputTokens ?? 0, totalTokens: data.totalTokens ?? 0, createdAt: nowIso(), ...data };
    this.messages.set(message.id, message);
    const conversation = this.conversations.get(data.conversationId);
    if (conversation) this.conversations.set(conversation.id, { ...conversation, updatedAt: nowIso() });
    return message;
  }

  async listMessages(conversationId: string): Promise<AgentMessage[]> {
    return [...this.messages.values()].filter((item) => item.conversationId === conversationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createProtocol(data: CreateProtocolData): Promise<AgentProtocol> {
    const now = nowIso();
    const protocol: AgentProtocol = { id: newId("protocol"), status: "active", createdAt: now, updatedAt: now, ...data };
    this.protocols.set(protocol.id, protocol);
    return protocol;
  }

  async getProtocol(agentId: string, name: string, version: string): Promise<AgentProtocol | null> {
    return [...this.protocols.values()].find((item) => item.agentId === agentId && item.name === name && item.version === version && item.status === "active") ?? null;
  }

  async listProtocols(agentId: string): Promise<AgentProtocol[]> {
    return [...this.protocols.values()].filter((item) => item.agentId === agentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createLease(data: CreateLeaseData): Promise<AgentLease> {
    const now = nowIso();
    const lease: AgentLease = { id: newId("lease"), status: "active", usedCalls: 0, usedTokens: 0, createdAt: now, updatedAt: now, ...data };
    this.leases.set(lease.id, lease);
    return lease;
  }

  async getLease(id: string): Promise<AgentLease | null> {
    return this.leases.get(id) ?? null;
  }

  async listLeases(agentId: string): Promise<AgentLease[]> {
    return [...this.leases.values()].filter((item) => item.agentId === agentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async consumeLease(id: string, tokens: number): Promise<AgentLease> {
    const current = this.leases.get(id);
    if (!current) throw new Error("Lease not found: " + id);
    const next = { ...current, usedCalls: current.usedCalls + 1, usedTokens: current.usedTokens + tokens, updatedAt: nowIso() };
    this.leases.set(id, next);
    return next;
  }

  async addArtifact(data: CreateArtifactData): Promise<RunArtifact> {
    const artifact: RunArtifact = { id: newId("artifact"), createdAt: nowIso(), ...data };
    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  async listArtifacts(runId: string): Promise<RunArtifact[]> {
    return [...this.artifacts.values()].filter((item) => item.runId === runId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addCompressionAudit(data: CreateCompressionAuditData): Promise<CompressionAudit> {
    const audit: CompressionAudit = { id: newId("compress"), runId: data.runId ?? null, createdAt: nowIso(), ...data };
    this.compressionAudits.set(audit.id, audit);
    return audit;
  }

  async listCompressionAudits(runId?: string): Promise<CompressionAudit[]> {
    return [...this.compressionAudits.values()].filter((item) => !runId || item.runId === runId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createQueueTask(data: CreateRunQueueTaskData): Promise<RunQueueTask> {
    const now = nowIso();
    const task: RunQueueTask = { id: newId("queue"), status: "queued", attempts: 0, lockedAt: null, lastError: null, createdAt: now, updatedAt: now, ...data };
    this.queueTasks.set(task.id, task);
    return task;
  }

  async updateQueueTask(id: string, patch: Partial<RunQueueTask>): Promise<RunQueueTask> {
    const current = this.queueTasks.get(id);
    if (!current) throw new Error("Queue task not found: " + id);
    const next = { ...current, ...withoutUndefined(patch), updatedAt: nowIso() };
    this.queueTasks.set(id, next);
    return next;
  }

  async listQueueTasks(statuses?: RunQueueTask["status"][]): Promise<RunQueueTask[]> {
    return [...this.queueTasks.values()].filter((task) => !statuses || statuses.includes(task.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createRun(input: string): Promise<AgentRun> {
    const now = nowIso();
    const run: AgentRun = {
      id: newId("run"),
      status: "queued",
      input,
      output: null,
      totalTokens: 0,
      errorType: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now
    };
    this.runs.set(run.id, run);
    return run;
  }

  async updateRun(id: string, patch: Partial<AgentRun>): Promise<AgentRun> {
    const current = this.runs.get(id);
    if (!current) throw new Error(`Run not found: ${id}`);
    const next = { ...current, ...withoutUndefined(patch), updatedAt: nowIso() };
    this.runs.set(id, next);
    return next;
  }

  async getRun(id: string): Promise<AgentRun | null> {
    return this.runs.get(id) ?? null;
  }

  async listRuns(): Promise<AgentRun[]> {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createStep(data: Omit<RunStep, "id">): Promise<RunStep> {
    const step = { ...data, id: newId("step") };
    this.steps.set(step.id, step);
    return step;
  }

  async updateStep(id: string, patch: Partial<RunStep>): Promise<RunStep> {
    const current = this.steps.get(id);
    if (!current) throw new Error(`Step not found: ${id}`);
    const next = { ...current, ...withoutUndefined(patch) };
    this.steps.set(id, next);
    return next;
  }

  async listSteps(runId: string): Promise<RunStep[]> {
    return [...this.steps.values()].filter((step) => step.runId === runId);
  }

  async addEvent(data: Omit<RunEvent, "id" | "createdAt">): Promise<RunEvent> {
    const event: RunEvent = { ...data, id: newId("event"), createdAt: nowIso() };
    this.events.set(event.id, event);
    return event;
  }

  async listEvents(runId: string): Promise<RunEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addToken(token: ApiToken): Promise<ApiToken> {
    this.tokens.set(token.id, token);
    return token;
  }

  async listTokens(): Promise<ApiToken[]> {
    return [...this.tokens.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getToken(id: string): Promise<ApiToken | null> {
    return this.tokens.get(id) ?? null;
  }

  async revokeToken(id: string, revokedAt: string): Promise<ApiToken | null> {
    const current = this.tokens.get(id);
    if (!current) return null;
    const next = { ...current, status: "revoked" as const, revokedAt };
    this.tokens.set(id, next);
    return next;
  }

  async addAudit(event: AuditEvent): Promise<AuditEvent> {
    this.audits.set(event.id, event);
    return event;
  }

  async listAuditEvents(): Promise<AuditEvent[]> {
    return [...this.audits.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
