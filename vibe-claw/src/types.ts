export type AgentStatus = "active" | "disabled" | "archived";

export type RunStatus =
  | "queued"
  | "building_context"
  | "retrieving_memory"
  | "typing"
  | "calling_model"
  | "validating_output"
  | "completed"
  | "failed"
  | "cancelled";

export type TokenStatus = "active" | "revoked";
export type ProviderStatus = "active" | "disabled";
export type ProviderType = "mock" | "openai-compatible";

export type ResourceScope = {
  tenantId?: string;
  projectId?: string;
};

export const DEFAULT_TENANT_ID = "default";
export const DEFAULT_PROJECT_ID = "default";

export type Agent = {
  id: string;
  tenantId?: string;
  projectId?: string;
  name: string;
  description: string;
  instruction: string;
  contract: AgentContract;
  status: AgentStatus;
  defaultModel: string;
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentRun = {
  id: string;
  tenantId?: string;
  projectId?: string;
  status: RunStatus;
  input: string;
  output: string | null;
  totalTokens: number;
  errorType: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RunStep = {
  id: string;
  tenantId?: string;
  projectId?: string;
  runId: string;
  agentId: string;
  status: RunStatus;
  input: string;
  output: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  startedAt: string | null;
  completedAt: string | null;
};

export type RunEvent = {
  id: string;
  tenantId?: string;
  projectId?: string;
  runId: string;
  stepId: string | null;
  status: RunStatus;
  title: string;
  summary: string;
  visible: boolean;
  createdAt: string;
};

export type ModelProviderConfig = {
  id: string;
  tenantId?: string;
  projectId?: string;
  name: string;
  type: ProviderType;
  status: ProviderStatus;
  baseUrl: string | null;
  defaultModel: string;
  apiKeyRef: string | null;
  timeoutMs: number;
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
};

export type ApiToken = {
  id: string;
  tenantId?: string;
  projectId?: string;
  tokenHash: string;
  name: string;
  scopes: string[];
  status: TokenStatus;
  expiresAt: string | null;
  allowedIps: string[];
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdAt: string;
  revokedAt: string | null;
};

export type AuditEvent = {
  id: string;
  tenantId?: string;
  projectId?: string;
  requestId: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  status: "success" | "failed";
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ContextItem = {
  source: "user" | "system" | "agent" | "memory" | "tool";
  content: string;
  priority: number;
  sensitive?: boolean;
};

export type AgentContract = {
  role: string;
  mission: string;
  boundaries: string[];
  style: string;
  outputContract: string;
  toolPolicy: string;
  memoryPolicy: string;
  handoffPolicy: string;
  safetyPolicy: string;
  version: string;
};

export type PromptMessageRole = "system" | "developer" | "user" | "assistant" | "tool";

export type PromptMessage = {
  role: PromptMessageRole;
  content: string;
  name?: string;
};

export type ContextBlockKind =
  | "system"
  | "developer"
  | "memory"
  | "history"
  | "summary"
  | "tool"
  | "attachment"
  | "external"
  | "user";

export type ContextBlock = {
  id: string;
  kind: ContextBlockKind;
  role: PromptMessageRole;
  source: string;
  content: string;
  priority: number;
  tokenCost: number;
  recency: number;
  relevance: number;
  importance: number;
  confidence: number;
  sensitive: boolean;
  provenance: string;
  reason: string;
  required?: boolean;
};

export type ContextBuildAudit = {
  strategy: CompressionStrategy;
  budgetTokens: number;
  originalTokens: number;
  compressedTokens: number;
  kept: string[];
  summarized: string[];
  dropped: string[];
  reasons: Record<string, string>;
};

export type ModelCallInput = {
  requestId: string;
  runId: string;
  stepId: string;
  agent: Agent;
  input: string;
  context: ContextItem[];
  messages?: PromptMessage[];
  contextAudit?: ContextBuildAudit;
  timeoutMs: number;
};

export type ModelCallOutput = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  provider: string;
  model: string;
};

export type AuthActor = {
  tokenId: string;
  name: string;
  scopes: string[];
  tenantId?: string;
  projectId?: string;
};

export type ToolCallInput = {
  name: string;
  input?: Record<string, unknown>;
};

export type CreateRunInput = {
  agentIds: string[];
  input: string;
  context?: Array<string | Partial<ContextItem> & { content: string }>;
  messages?: PromptMessage[];
  contextAudit?: ContextBuildAudit;
  toolCalls?: ToolCallInput[];
  callbackUrl?: string;
  callbackSecret?: string;
  mode?: "single" | "sequential";
  providerId?: string;
};

export type MemoryType = "profile" | "semantic" | "episodic" | "working";
export type MemoryStatus = "active" | "archived" | "rejected";
export type MemoryScope = "agent" | "conversation" | "tenant" | "lease";
export type CompressionStrategy = "none" | "recent_only" | "rolling_summary" | "semantic_recall" | "hybrid" | "protocol_minimal";
export type ConversationMode = "message" | "protocol";
export type LeaseStatus = "active" | "expired" | "revoked";

export type AgentMemory = {
  id: string;
  tenantId?: string;
  projectId?: string;
  agentId: string;
  type: MemoryType;
  scope: MemoryScope;
  status: MemoryStatus;
  summary: string;
  content: string;
  source: string;
  sourceRunId: string | null;
  importance: number;
  confidence: number;
  tags: string[];
  provenance: string;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentConversation = {
  id: string;
  tenantId?: string;
  projectId?: string;
  agentId: string;
  mode: ConversationMode;
  status: "active" | "archived";
  summary: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentMessage = {
  id: string;
  tenantId?: string;
  projectId?: string;
  conversationId: string;
  agentId: string;
  role: "user" | "agent" | "system";
  content: string;
  runId: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt: string;
};

export type AgentProtocol = {
  id: string;
  tenantId?: string;
  projectId?: string;
  agentId: string;
  name: string;
  version: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

export type AgentLease = {
  id: string;
  tenantId?: string;
  projectId?: string;
  agentId: string;
  status: LeaseStatus;
  expiresAt: string;
  maxCalls: number;
  usedCalls: number;
  tokenBudget: number;
  usedTokens: number;
  allowedProtocols: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type RunArtifact = {
  id: string;
  tenantId?: string;
  projectId?: string;
  runId: string;
  type: "text" | "json";
  name: string;
  content: string;
  createdAt: string;
};

export type CompressionAudit = {
  id: string;
  tenantId?: string;
  projectId?: string;
  runId: string | null;
  strategy: CompressionStrategy;
  strategyVersion: string;
  originalTokens: number;
  compressedTokens: number;
  kept: string[];
  summarized: string[];
  dropped: string[];
  createdAt: string;
};

export type RunQueueTask = {
  id: string;
  tenantId?: string;
  projectId?: string;
  runId: string;
  status: "queued" | "running" | "completed" | "failed" | "dead_letter";
  requestId: string;
  actor: AuthActor;
  input: CreateRunInput;
  attempts: number;
  lockedAt: string | null;
  lockedBy?: string | null;
  lockExpiresAt?: string | null;
  maxAttempts?: number;
  nextRunAt?: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IdempotencyRecord = {
  id: string;
  tenantId?: string;
  projectId?: string;
  actor: string;
  method: string;
  path: string;
  idempotencyKey: string;
  bodyHash: string;
  statusCode: number;
  responseBody: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
};

export type WebhookDelivery = {
  id: string;
  tenantId?: string;
  projectId?: string;
  runId: string;
  url: string;
  status: "queued" | "delivered" | "failed" | "dead_letter";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  statusCode: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UsageCounter = {
  id: string;
  tenantId?: string;
  projectId?: string;
  tokenId: string | null;
  agentId: string | null;
  providerId: string | null;
  usageWindow: string;
  requestCount: number;
  tokenCount: number;
  costUnits: number;
  createdAt: string;
  updatedAt: string;
};

export type WebhookSubscription = {
  id: string;
  tenantId?: string;
  projectId?: string;
  name: string;
  url: string;
  secretRef: string | null;
  eventTypes: string[];
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

export type BillingPlan = {
  id: string;
  name: string;
  monthlyRequestLimit: number;
  monthlyTokenLimit: number;
  monthlyCostLimitCents: number;
  features: string[];
};
