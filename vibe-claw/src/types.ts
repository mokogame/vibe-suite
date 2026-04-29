export type AgentStatus = "active" | "disabled" | "archived";

export type RunStatus =
  | "queued"
  | "building_context"
  | "calling_model"
  | "validating_output"
  | "completed"
  | "failed"
  | "cancelled";

export type TokenStatus = "active" | "revoked";

export type Agent = {
  id: string;
  name: string;
  description: string;
  instruction: string;
  status: AgentStatus;
  defaultModel: string;
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

export type ModelCallInput = {
  requestId: string;
  runId: string;
  stepId: string;
  agent: Agent;
  input: string;
  context: string[];
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

export type CreateRunInput = {
  agentIds: string[];
  input: string;
  context?: string[];
  mode?: "single" | "sequential";
};
