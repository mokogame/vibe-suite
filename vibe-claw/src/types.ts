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

export type Agent = {
  id: string;
  name: string;
  description: string;
  instruction: string;
  status: AgentStatus;
  defaultModel: string;
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentRun = {
  id: string;
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
  tokenHash: string;
  name: string;
  scopes: string[];
  status: TokenStatus;
  createdAt: string;
  revokedAt: string | null;
};

export type AuditEvent = {
  id: string;
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

export type ModelCallInput = {
  requestId: string;
  runId: string;
  stepId: string;
  agent: Agent;
  input: string;
  context: ContextItem[];
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
};

export type ToolCallInput = {
  name: string;
  input?: Record<string, unknown>;
};

export type CreateRunInput = {
  agentIds: string[];
  input: string;
  context?: Array<string | Partial<ContextItem> & { content: string }>;
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
  agentId: string;
  type: MemoryType;
  scope: MemoryScope;
  status: MemoryStatus;
  summary: string;
  content: string;
  source: string;
  sourceRunId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentConversation = {
  id: string;
  agentId: string;
  mode: ConversationMode;
  status: "active" | "archived";
  summary: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentMessage = {
  id: string;
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
  runId: string;
  type: "text" | "json";
  name: string;
  content: string;
  createdAt: string;
};

export type CompressionAudit = {
  id: string;
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
  runId: string;
  status: "queued" | "running" | "completed" | "failed";
  requestId: string;
  actor: AuthActor;
  input: CreateRunInput;
  attempts: number;
  lockedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};
