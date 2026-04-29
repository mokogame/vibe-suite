import type { Agent, AgentContract, AgentConversation, AgentLease, AgentMemory, AgentMessage, AgentProtocol, AgentRun, AgentStatus, ApiToken, AuditEvent, CompressionAudit, CompressionStrategy, IdempotencyRecord, MemoryScope, MemoryType, ModelProviderConfig, ProviderStatus, ProviderType, ResourceScope, RunArtifact, RunEvent, RunQueueTask, RunStep, UsageCounter, WebhookDelivery, WebhookSubscription } from "../types.js";

export type ScopedCreate = Partial<ResourceScope>;

export type CreateAgentData = ScopedCreate & {
  name: string;
  description?: string;
  instruction: string;
  contract?: Partial<AgentContract>;
  defaultModel?: string;
  providerId?: string | null;
};

export type UpdateAgentData = Partial<{
  name: string;
  description: string;
  instruction: string;
  contract: Partial<AgentContract>;
  defaultModel: string;
  providerId: string | null;
  status: AgentStatus;
}>;

export type CreateProviderData = ScopedCreate & {
  name: string;
  type: ProviderType;
  baseUrl?: string | null;
  defaultModel: string;
  apiKeyRef?: string | null;
  timeoutMs?: number;
  maxRetries?: number;
};

export type UpdateProviderData = Partial<{
  name: string;
  status: ProviderStatus;
  baseUrl: string | null;
  defaultModel: string;
  apiKeyRef: string | null;
  timeoutMs: number;
  maxRetries: number;
}>;


export type CreateMemoryData = ScopedCreate & {
  agentId: string;
  type: MemoryType;
  scope: MemoryScope;
  summary: string;
  content: string;
  source: string;
  sourceRunId?: string | null;
  importance?: number;
  confidence?: number;
  tags?: string[];
  provenance?: string;
  expiresAt?: string | null;
  createdBy: string;
};

export type CreateConversationData = ScopedCreate & {
  agentId: string;
  mode: "message" | "protocol";
  summary?: string;
};

export type CreateMessageData = ScopedCreate & {
  conversationId: string;
  agentId: string;
  role: "user" | "agent" | "system";
  content: string;
  runId?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type CreateProtocolData = ScopedCreate & {
  agentId: string;
  name: string;
  version: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
};

export type CreateLeaseData = ScopedCreate & {
  agentId: string;
  expiresAt: string;
  maxCalls: number;
  tokenBudget: number;
  allowedProtocols: string[];
  createdBy: string;
};

export type CreateArtifactData = ScopedCreate & {
  runId: string;
  type: "text" | "json";
  name: string;
  content: string;
};

export type CreateUsageCounterData = ScopedCreate & {
  tokenId?: string | null;
  agentId?: string | null;
  providerId?: string | null;
  usageWindow: string;
  requestCount?: number;
  tokenCount?: number;
  costUnits?: number;
};

export type CreateWebhookSubscriptionData = ScopedCreate & {
  name: string;
  url: string;
  secretRef?: string | null;
  eventTypes: string[];
};

export type UpdateWebhookSubscriptionData = Partial<{
  name: string;
  url: string;
  secretRef: string | null;
  eventTypes: string[];
  status: WebhookSubscription["status"];
}>;


export type CreateRunQueueTaskData = ScopedCreate & {
  runId: string;
  requestId: string;
  actor: import("../types.js").AuthActor;
  input: import("../types.js").CreateRunInput;
};

export type CreateCompressionAuditData = ScopedCreate & {
  runId?: string | null;
  strategy: CompressionStrategy;
  strategyVersion: string;
  originalTokens: number;
  compressedTokens: number;
  kept: string[];
  summarized: string[];
  dropped: string[];
};

export type StoreHealth = { ok: boolean; type: "memory" | "postgres"; error?: string };
export type ResetStoreResult = { storeType: StoreHealth["type"]; cleared: number };

export type Store = {
  healthCheck(): Promise<StoreHealth>;
  resetData(): Promise<ResetStoreResult>;
  createAgent(data: CreateAgentData): Promise<Agent>;
  updateAgent(id: string, patch: UpdateAgentData): Promise<Agent | null>;
  listAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | null>;

  createProvider(data: CreateProviderData): Promise<ModelProviderConfig>;
  updateProvider(id: string, patch: UpdateProviderData): Promise<ModelProviderConfig | null>;
  listProviders(): Promise<ModelProviderConfig[]>;
  getProvider(id: string): Promise<ModelProviderConfig | null>;

  createMemory(data: CreateMemoryData): Promise<AgentMemory>;
  listMemories(agentId: string): Promise<AgentMemory[]>;
  updateMemoryStatus(id: string, status: AgentMemory["status"]): Promise<AgentMemory | null>;

  createConversation(data: CreateConversationData): Promise<AgentConversation>;
  getConversation(id: string): Promise<AgentConversation | null>;
  listConversations(agentId?: string): Promise<AgentConversation[]>;
  findConversationByRunId(runId: string): Promise<AgentConversation | null>;
  addMessage(data: CreateMessageData): Promise<AgentMessage>;
  listMessages(conversationId: string): Promise<AgentMessage[]>;

  createProtocol(data: CreateProtocolData): Promise<AgentProtocol>;
  getProtocol(agentId: string, name: string, version: string): Promise<AgentProtocol | null>;
  listProtocols(agentId: string): Promise<AgentProtocol[]>;

  createLease(data: CreateLeaseData): Promise<AgentLease>;
  getLease(id: string): Promise<AgentLease | null>;
  listLeases(agentId: string): Promise<AgentLease[]>;
  consumeLease(id: string, tokens: number): Promise<AgentLease>;

  addArtifact(data: CreateArtifactData): Promise<RunArtifact>;
  listArtifacts(runId: string): Promise<RunArtifact[]>;
  addCompressionAudit(data: CreateCompressionAuditData): Promise<CompressionAudit>;
  listCompressionAudits(runId?: string): Promise<CompressionAudit[]>;

  createQueueTask(data: CreateRunQueueTaskData): Promise<RunQueueTask>;
  updateQueueTask(id: string, patch: Partial<RunQueueTask>): Promise<RunQueueTask>;
  listQueueTasks(statuses?: RunQueueTask["status"][]): Promise<RunQueueTask[]>;

  createRun(input: string, scope?: ResourceScope): Promise<AgentRun>;
  updateRun(id: string, patch: Partial<AgentRun>): Promise<AgentRun>;
  getRun(id: string): Promise<AgentRun | null>;
  listRuns(): Promise<AgentRun[]>;

  createStep(data: Omit<RunStep, "id">): Promise<RunStep>;
  updateStep(id: string, patch: Partial<RunStep>): Promise<RunStep>;
  listSteps(runId: string): Promise<RunStep[]>;

  addEvent(data: Omit<RunEvent, "id" | "createdAt">): Promise<RunEvent>;
  listEvents(runId: string): Promise<RunEvent[]>;

  addToken(token: ApiToken): Promise<ApiToken>;
  listTokens(): Promise<ApiToken[]>;
  getToken(id: string): Promise<ApiToken | null>;
  markTokenUsed(id: string, usedAt: string, ip: string | null): Promise<ApiToken | null>;
  revokeToken(id: string, revokedAt: string): Promise<ApiToken | null>;

  addAudit(event: AuditEvent): Promise<AuditEvent>;
  listAuditEvents(): Promise<AuditEvent[]>;

  getIdempotencyRecord(scope: ResourceScope, actor: string, method: string, path: string, key: string): Promise<IdempotencyRecord | null>;
  saveIdempotencyRecord(record: IdempotencyRecord): Promise<IdempotencyRecord>;
  cleanupExpiredIdempotencyRecords(now: string): Promise<number>;

  acquireConversationLock(scope: ResourceScope, conversationId: string, holder: string, lockUntil: string): Promise<boolean>;
  releaseConversationLock(conversationId: string, holder: string): Promise<void>;

  claimQueueTask(workerId: string, lockUntil: string): Promise<RunQueueTask | null>;

  recordUsage(data: CreateUsageCounterData): Promise<UsageCounter>;
  listUsageCounters(scope?: ResourceScope): Promise<UsageCounter[]>;

  createWebhookSubscription(data: CreateWebhookSubscriptionData): Promise<WebhookSubscription>;
  updateWebhookSubscription(id: string, patch: UpdateWebhookSubscriptionData): Promise<WebhookSubscription | null>;
  listWebhookSubscriptions(scope?: ResourceScope): Promise<WebhookSubscription[]>;

  createWebhookDelivery(data: Omit<WebhookDelivery, "id" | "createdAt" | "updatedAt">): Promise<WebhookDelivery>;
  updateWebhookDelivery(id: string, patch: Partial<WebhookDelivery>): Promise<WebhookDelivery>;
  listWebhookDeliveries(runId?: string): Promise<WebhookDelivery[]>;
};

export function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
