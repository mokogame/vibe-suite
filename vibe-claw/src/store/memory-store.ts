import { newId, nowIso } from "../core/ids.js";
import { DEFAULT_PROJECT_ID, DEFAULT_TENANT_ID } from "../types.js";
import type { Agent, AgentConversation, AgentLease, AgentMemory, AgentMessage, AgentProtocol, AgentRun, ApiToken, AuditEvent, CompressionAudit, IdempotencyRecord, ModelProviderConfig, ResourceScope, RunArtifact, RunEvent, RunQueueTask, RunStep, UsageCounter, WebhookDelivery, WebhookSubscription } from "../types.js";
import type { CreateAgentData, CreateArtifactData, CreateCompressionAuditData, CreateConversationData, CreateLeaseData, CreateMemoryData, CreateMessageData, CreateProtocolData, CreateProviderData, CreateRunQueueTaskData, CreateUsageCounterData, CreateWebhookSubscriptionData, Store, UpdateAgentData, UpdateProviderData, UpdateWebhookSubscriptionData } from "./store.js";
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
  private idempotencyRecords = new Map<string, IdempotencyRecord>();
  private conversationLocks = new Map<string, { holder: string; lockUntil: string; tenantId: string; projectId: string }>();
  private usageCounters = new Map<string, UsageCounter>();
  private webhookSubscriptions = new Map<string, WebhookSubscription>();
  private webhookDeliveries = new Map<string, WebhookDelivery>();

  async resetData() {
    const collections = [
      this.agents,
      this.providers,
      this.memories,
      this.conversations,
      this.messages,
      this.protocols,
      this.leases,
      this.artifacts,
      this.compressionAudits,
      this.queueTasks,
      this.runs,
      this.steps,
      this.events,
      this.tokens,
      this.audits,
      this.idempotencyRecords,
      this.conversationLocks,
      this.usageCounters,
      this.webhookSubscriptions,
      this.webhookDeliveries
    ];
    const cleared = collections.reduce((sum, collection) => sum + collection.size, 0);
    for (const collection of collections) collection.clear();
    return { storeType: "memory" as const, cleared };
  }

  async createAgent(data: CreateAgentData): Promise<Agent> {
    const now = nowIso();
    const agent: Agent = {
      id: newId("agent"),
      ...scopeFrom(data),
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
      ...scopeFrom(data),
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
    const memory: AgentMemory = { id: newId("mem"), ...scopeFrom(data), status: "active", sourceRunId: data.sourceRunId ?? null, createdAt: now, updatedAt: now, ...data };
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
    const conversation: AgentConversation = { id: newId("conv"), ...scopeFrom(data), agentId: data.agentId, mode: data.mode, status: "active", summary: data.summary ?? "", createdAt: now, updatedAt: now };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  async getConversation(id: string): Promise<AgentConversation | null> {
    return this.conversations.get(id) ?? null;
  }

  async listConversations(agentId?: string): Promise<AgentConversation[]> {
    return [...this.conversations.values()].filter((item) => !agentId || item.agentId === agentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findConversationByRunId(runId: string): Promise<AgentConversation | null> {
    const message = [...this.messages.values()]
      .filter((item) => item.runId === runId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return message ? this.getConversation(message.conversationId) : null;
  }

  async addMessage(data: CreateMessageData): Promise<AgentMessage> {
    const message: AgentMessage = { id: newId("msg"), ...scopeFrom(data), runId: data.runId ?? null, inputTokens: data.inputTokens ?? 0, outputTokens: data.outputTokens ?? 0, totalTokens: data.totalTokens ?? 0, createdAt: nowIso(), ...data };
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
    const protocol: AgentProtocol = { id: newId("protocol"), ...scopeFrom(data), status: "active", createdAt: now, updatedAt: now, ...data };
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
    const lease: AgentLease = { id: newId("lease"), ...scopeFrom(data), status: "active", usedCalls: 0, usedTokens: 0, createdAt: now, updatedAt: now, ...data };
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
    const artifact: RunArtifact = { id: newId("artifact"), ...scopeFrom(data), createdAt: nowIso(), ...data };
    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  async listArtifacts(runId: string): Promise<RunArtifact[]> {
    return [...this.artifacts.values()].filter((item) => item.runId === runId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addCompressionAudit(data: CreateCompressionAuditData): Promise<CompressionAudit> {
    const audit: CompressionAudit = { id: newId("compress"), ...scopeFrom(data), runId: data.runId ?? null, createdAt: nowIso(), ...data };
    this.compressionAudits.set(audit.id, audit);
    return audit;
  }

  async listCompressionAudits(runId?: string): Promise<CompressionAudit[]> {
    return [...this.compressionAudits.values()].filter((item) => !runId || item.runId === runId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createQueueTask(data: CreateRunQueueTaskData): Promise<RunQueueTask> {
    const now = nowIso();
    const task: RunQueueTask = { id: newId("queue"), ...scopeFrom(data), status: "queued", attempts: 0, lockedAt: null, lockedBy: null, lockExpiresAt: null, maxAttempts: 3, nextRunAt: now, lastError: null, createdAt: now, updatedAt: now, ...data };
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

  async createRun(input: string, scope: ResourceScope = {}): Promise<AgentRun> {
    const now = nowIso();
    const run: AgentRun = {
      id: newId("run"),
      ...scopeFrom(scope),
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
    const step = { tenantId: DEFAULT_TENANT_ID, projectId: DEFAULT_PROJECT_ID, ...data, id: newId("step") };
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
    const event: RunEvent = { tenantId: DEFAULT_TENANT_ID, projectId: DEFAULT_PROJECT_ID, ...data, id: newId("event"), createdAt: nowIso() };
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

  async markTokenUsed(id: string, usedAt: string, ip: string | null): Promise<ApiToken | null> {
    const current = this.tokens.get(id);
    if (!current) return null;
    const next = { ...current, lastUsedAt: usedAt, lastUsedIp: ip };
    this.tokens.set(id, next);
    return next;
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

  async getIdempotencyRecord(scope: ResourceScope, actor: string, method: string, path: string, key: string): Promise<IdempotencyRecord | null> {
    return this.idempotencyRecords.get(idempotencyMapKey(scope, actor, method, path, key)) ?? null;
  }

  async saveIdempotencyRecord(record: IdempotencyRecord): Promise<IdempotencyRecord> {
    this.idempotencyRecords.set(idempotencyMapKey(record, record.actor, record.method, record.path, record.idempotencyKey), record);
    return record;
  }

  async cleanupExpiredIdempotencyRecords(now: string): Promise<number> {
    let count = 0;
    for (const [key, record] of this.idempotencyRecords.entries()) {
      if (record.expiresAt <= now) {
        this.idempotencyRecords.delete(key);
        count += 1;
      }
    }
    return count;
  }

  async acquireConversationLock(scope: ResourceScope, conversationId: string, holder: string, lockUntil: string): Promise<boolean> {
    const current = this.conversationLocks.get(conversationId);
    if (current && current.lockUntil > nowIso() && current.holder !== holder) return false;
    this.conversationLocks.set(conversationId, { ...scopeFrom(scope), holder, lockUntil });
    return true;
  }

  async releaseConversationLock(conversationId: string, holder: string): Promise<void> {
    const current = this.conversationLocks.get(conversationId);
    if (!current || current.holder === holder) this.conversationLocks.delete(conversationId);
  }

  async claimQueueTask(workerId: string, lockUntil: string): Promise<RunQueueTask | null> {
    const now = nowIso();
    const task = [...this.queueTasks.values()].find((item) => item.status === "queued" && (!item.nextRunAt || item.nextRunAt <= now) && (!item.lockExpiresAt || item.lockExpiresAt <= now));
    if (!task) return null;
    const next: RunQueueTask = { ...task, status: "running", attempts: task.attempts + 1, lockedAt: now, lockedBy: workerId, lockExpiresAt: lockUntil, updatedAt: now };
    this.queueTasks.set(task.id, next);
    return next;
  }

  async recordUsage(data: CreateUsageCounterData): Promise<UsageCounter> {
    const scoped = scopeFrom(data);
    const key = usageMapKey(scoped, data.tokenId ?? null, data.agentId ?? null, data.providerId ?? null, data.usageWindow);
    const now = nowIso();
    const current = this.usageCounters.get(key);
    const next: UsageCounter = current
      ? {
          ...current,
          requestCount: current.requestCount + (data.requestCount ?? 0),
          tokenCount: current.tokenCount + (data.tokenCount ?? 0),
          costUnits: current.costUnits + (data.costUnits ?? 0),
          updatedAt: now
        }
      : {
          id: newId("usage"),
          ...scoped,
          tokenId: data.tokenId ?? null,
          agentId: data.agentId ?? null,
          providerId: data.providerId ?? null,
          usageWindow: data.usageWindow,
          requestCount: data.requestCount ?? 0,
          tokenCount: data.tokenCount ?? 0,
          costUnits: data.costUnits ?? 0,
          createdAt: now,
          updatedAt: now
        };
    this.usageCounters.set(key, next);
    return next;
  }

  async listUsageCounters(scope: ResourceScope = {}): Promise<UsageCounter[]> {
    const scoped = scopeFrom(scope);
    return [...this.usageCounters.values()]
      .filter((item) => item.tenantId === scoped.tenantId && item.projectId === scoped.projectId)
      .sort((a, b) => b.usageWindow.localeCompare(a.usageWindow));
  }

  async createWebhookSubscription(data: CreateWebhookSubscriptionData): Promise<WebhookSubscription> {
    const now = nowIso();
    const subscription: WebhookSubscription = {
      id: newId("whsub"),
      ...scopeFrom(data),
      name: data.name,
      url: data.url,
      secretRef: data.secretRef ?? null,
      eventTypes: data.eventTypes,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    this.webhookSubscriptions.set(subscription.id, subscription);
    return subscription;
  }

  async updateWebhookSubscription(id: string, patch: UpdateWebhookSubscriptionData): Promise<WebhookSubscription | null> {
    const current = this.webhookSubscriptions.get(id);
    if (!current) return null;
    const next = { ...current, ...withoutUndefined(patch), updatedAt: nowIso() };
    this.webhookSubscriptions.set(id, next);
    return next;
  }

  async listWebhookSubscriptions(scope: ResourceScope = {}): Promise<WebhookSubscription[]> {
    const scoped = scopeFrom(scope);
    return [...this.webhookSubscriptions.values()]
      .filter((item) => item.tenantId === scoped.tenantId && item.projectId === scoped.projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createWebhookDelivery(data: Omit<WebhookDelivery, "id" | "createdAt" | "updatedAt">): Promise<WebhookDelivery> {
    const now = nowIso();
    const delivery: WebhookDelivery = { id: newId("wh"), createdAt: now, updatedAt: now, ...data };
    this.webhookDeliveries.set(delivery.id, delivery);
    return delivery;
  }

  async updateWebhookDelivery(id: string, patch: Partial<WebhookDelivery>): Promise<WebhookDelivery> {
    const current = this.webhookDeliveries.get(id);
    if (!current) throw new Error("Webhook delivery not found: " + id);
    const next = { ...current, ...withoutUndefined(patch), updatedAt: nowIso() };
    this.webhookDeliveries.set(id, next);
    return next;
  }

  async listWebhookDeliveries(runId?: string): Promise<WebhookDelivery[]> {
    return [...this.webhookDeliveries.values()].filter((item) => !runId || item.runId === runId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

function scopeFrom(value: Partial<ResourceScope>): Required<ResourceScope> {
  return { tenantId: value.tenantId ?? DEFAULT_TENANT_ID, projectId: value.projectId ?? DEFAULT_PROJECT_ID };
}

function idempotencyMapKey(scope: ResourceScope, actor: string, method: string, path: string, key: string): string {
  return [scope.tenantId, scope.projectId, actor, method, path, key].join(":");
}

function usageMapKey(scope: ResourceScope, tokenId: string | null, agentId: string | null, providerId: string | null, window: string): string {
  return [scope.tenantId, scope.projectId, tokenId ?? "", agentId ?? "", providerId ?? "", window].join(":");
}
