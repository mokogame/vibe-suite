import pg from "pg";
import { newId, nowIso } from "../core/ids.js";
import type { Agent, AgentConversation, AgentLease, AgentMemory, AgentMessage, AgentProtocol, AgentRun, ApiToken, AuditEvent, CompressionAudit, ModelProviderConfig, RunArtifact, RunEvent, RunQueueTask, RunStep } from "../types.js";
import type { CreateAgentData, CreateArtifactData, CreateCompressionAuditData, CreateConversationData, CreateLeaseData, CreateMemoryData, CreateMessageData, CreateProtocolData, CreateProviderData, CreateRunQueueTaskData, Store, UpdateAgentData, UpdateProviderData } from "./store.js";
import { withoutUndefined } from "./store.js";

const { Pool } = pg;

type DbConfig = { connectionString: string };

export class PostgresStore implements Store {
  private readonly pool: pg.Pool;

  constructor(config: DbConfig) {
    this.pool = new Pool({ connectionString: config.connectionString });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async healthCheck() {
    try {
      await this.pool.query(`select 1`);
      return { ok: true, type: "postgres" as const };
    } catch (error) {
      return { ok: false, type: "postgres" as const, error: error instanceof Error ? error.message : "数据库不可用" };
    }
  }

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
    await this.pool.query(
      `insert into agents (id, name, description, instruction, status, default_model, provider_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [agent.id, agent.name, agent.description, agent.instruction, agent.status, agent.defaultModel, agent.providerId, agent.createdAt, agent.updatedAt]
    );
    return agent;
  }

  async updateAgent(id: string, patch: UpdateAgentData): Promise<Agent | null> {
    const current = await this.getAgent(id);
    if (!current) return null;
    const next = { ...current, ...withoutUndefined(patch), updatedAt: nowIso() };
    await this.pool.query(
      `update agents set name=$2, description=$3, instruction=$4, status=$5, default_model=$6, provider_id=$7, updated_at=$8 where id=$1`,
      [id, next.name, next.description, next.instruction, next.status, next.defaultModel, next.providerId, next.updatedAt]
    );
    return next;
  }

  async listAgents(): Promise<Agent[]> {
    const result = await this.pool.query(`select * from agents order by created_at asc`);
    return result.rows.map(rowToAgent);
  }

  async getAgent(id: string): Promise<Agent | null> {
    const result = await this.pool.query(`select * from agents where id=$1`, [id]);
    return result.rows[0] ? rowToAgent(result.rows[0]) : null;
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
    await this.pool.query(
      `insert into model_providers (id, name, type, status, base_url, default_model, api_key_ref, timeout_ms, max_retries, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [provider.id, provider.name, provider.type, provider.status, provider.baseUrl, provider.defaultModel, provider.apiKeyRef, provider.timeoutMs, provider.maxRetries, provider.createdAt, provider.updatedAt]
    );
    return provider;
  }

  async updateProvider(id: string, patch: UpdateProviderData): Promise<ModelProviderConfig | null> {
    const current = await this.getProvider(id);
    if (!current) return null;
    const next = { ...current, ...withoutUndefined(patch), updatedAt: nowIso() };
    await this.pool.query(
      `update model_providers set name=$2, status=$3, base_url=$4, default_model=$5, api_key_ref=$6, timeout_ms=$7, max_retries=$8, updated_at=$9 where id=$1`,
      [id, next.name, next.status, next.baseUrl, next.defaultModel, next.apiKeyRef, next.timeoutMs, next.maxRetries, next.updatedAt]
    );
    return next;
  }

  async listProviders(): Promise<ModelProviderConfig[]> {
    const result = await this.pool.query(`select * from model_providers order by created_at asc`);
    return result.rows.map(rowToProvider);
  }

  async getProvider(id: string): Promise<ModelProviderConfig | null> {
    const result = await this.pool.query(`select * from model_providers where id=$1`, [id]);
    return result.rows[0] ? rowToProvider(result.rows[0]) : null;
  }

  async createMemory(data: CreateMemoryData): Promise<AgentMemory> {
    const now = nowIso();
    const memory: AgentMemory = { id: newId("mem"), status: "active", sourceRunId: data.sourceRunId ?? null, createdAt: now, updatedAt: now, ...data };
    await this.pool.query(
      `insert into agent_memories (id, agent_id, type, scope, status, summary, content, source, source_run_id, created_by, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [memory.id, memory.agentId, memory.type, memory.scope, memory.status, memory.summary, memory.content, memory.source, memory.sourceRunId, memory.createdBy, memory.createdAt, memory.updatedAt]
    );
    return memory;
  }

  async listMemories(agentId: string): Promise<AgentMemory[]> {
    const result = await this.pool.query(`select * from agent_memories where agent_id=$1 order by created_at desc`, [agentId]);
    return result.rows.map(rowToMemory);
  }

  async updateMemoryStatus(id: string, status: AgentMemory["status"]): Promise<AgentMemory | null> {
    const result = await this.pool.query(`update agent_memories set status=$2, updated_at=$3 where id=$1 returning *`, [id, status, nowIso()]);
    return result.rows[0] ? rowToMemory(result.rows[0]) : null;
  }

  async createConversation(data: CreateConversationData): Promise<AgentConversation> {
    const now = nowIso();
    const conversation: AgentConversation = { id: newId("conv"), agentId: data.agentId, mode: data.mode, status: "active", summary: data.summary ?? "", createdAt: now, updatedAt: now };
    await this.pool.query(`insert into agent_conversations (id, agent_id, mode, status, summary, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7)`, [conversation.id, conversation.agentId, conversation.mode, conversation.status, conversation.summary, conversation.createdAt, conversation.updatedAt]);
    return conversation;
  }

  async getConversation(id: string): Promise<AgentConversation | null> {
    const result = await this.pool.query(`select * from agent_conversations where id=$1`, [id]);
    return result.rows[0] ? rowToConversation(result.rows[0]) : null;
  }

  async listConversations(agentId?: string): Promise<AgentConversation[]> {
    const result = agentId ? await this.pool.query(`select * from agent_conversations where agent_id=$1 order by updated_at desc`, [agentId]) : await this.pool.query(`select * from agent_conversations order by updated_at desc`);
    return result.rows.map(rowToConversation);
  }

  async addMessage(data: CreateMessageData): Promise<AgentMessage> {
    const message: AgentMessage = { id: newId("msg"), runId: data.runId ?? null, inputTokens: data.inputTokens ?? 0, outputTokens: data.outputTokens ?? 0, totalTokens: data.totalTokens ?? 0, createdAt: nowIso(), ...data };
    await this.pool.query(`insert into agent_messages (id, conversation_id, agent_id, role, content, run_id, input_tokens, output_tokens, total_tokens, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [message.id, message.conversationId, message.agentId, message.role, message.content, message.runId, message.inputTokens, message.outputTokens, message.totalTokens, message.createdAt]);
    await this.pool.query(`update agent_conversations set updated_at=$2 where id=$1`, [message.conversationId, nowIso()]);
    return message;
  }

  async listMessages(conversationId: string): Promise<AgentMessage[]> {
    const result = await this.pool.query(`select * from agent_messages where conversation_id=$1 order by created_at asc`, [conversationId]);
    return result.rows.map(rowToMessage);
  }

  async createProtocol(data: CreateProtocolData): Promise<AgentProtocol> {
    const now = nowIso();
    const protocol: AgentProtocol = { id: newId("protocol"), status: "active", createdAt: now, updatedAt: now, ...data };
    await this.pool.query(`insert into agent_protocols (id, agent_id, name, version, input_schema, output_schema, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [protocol.id, protocol.agentId, protocol.name, protocol.version, protocol.inputSchema, protocol.outputSchema, protocol.status, protocol.createdAt, protocol.updatedAt]);
    return protocol;
  }

  async getProtocol(agentId: string, name: string, version: string): Promise<AgentProtocol | null> {
    const result = await this.pool.query(`select * from agent_protocols where agent_id=$1 and name=$2 and version=$3 and status='active'`, [agentId, name, version]);
    return result.rows[0] ? rowToProtocol(result.rows[0]) : null;
  }

  async listProtocols(agentId: string): Promise<AgentProtocol[]> {
    const result = await this.pool.query(`select * from agent_protocols where agent_id=$1 order by created_at asc`, [agentId]);
    return result.rows.map(rowToProtocol);
  }

  async createLease(data: CreateLeaseData): Promise<AgentLease> {
    const now = nowIso();
    const lease: AgentLease = { id: newId("lease"), status: "active", usedCalls: 0, usedTokens: 0, createdAt: now, updatedAt: now, ...data };
    await this.pool.query(`insert into agent_leases (id, agent_id, status, expires_at, max_calls, used_calls, token_budget, used_tokens, allowed_protocols, created_by, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [lease.id, lease.agentId, lease.status, lease.expiresAt, lease.maxCalls, lease.usedCalls, lease.tokenBudget, lease.usedTokens, lease.allowedProtocols.join(","), lease.createdBy, lease.createdAt, lease.updatedAt]);
    return lease;
  }

  async getLease(id: string): Promise<AgentLease | null> {
    const result = await this.pool.query(`select * from agent_leases where id=$1`, [id]);
    return result.rows[0] ? rowToLease(result.rows[0]) : null;
  }

  async listLeases(agentId: string): Promise<AgentLease[]> {
    const result = await this.pool.query(`select * from agent_leases where agent_id=$1 order by created_at desc`, [agentId]);
    return result.rows.map(rowToLease);
  }

  async consumeLease(id: string, tokens: number): Promise<AgentLease> {
    const result = await this.pool.query(`update agent_leases set used_calls=used_calls+1, used_tokens=used_tokens+$2, updated_at=$3 where id=$1 returning *`, [id, tokens, nowIso()]);
    if (!result.rows[0]) throw new Error("Lease not found: " + id);
    return rowToLease(result.rows[0]);
  }

  async addArtifact(data: CreateArtifactData): Promise<RunArtifact> {
    const artifact: RunArtifact = { id: newId("artifact"), createdAt: nowIso(), ...data };
    await this.pool.query(`insert into run_artifacts (id, run_id, type, name, content, created_at) values ($1,$2,$3,$4,$5,$6)`, [artifact.id, artifact.runId, artifact.type, artifact.name, artifact.content, artifact.createdAt]);
    return artifact;
  }

  async listArtifacts(runId: string): Promise<RunArtifact[]> {
    const result = await this.pool.query(`select * from run_artifacts where run_id=$1 order by created_at asc`, [runId]);
    return result.rows.map(rowToArtifact);
  }

  async addCompressionAudit(data: CreateCompressionAuditData): Promise<CompressionAudit> {
    const audit: CompressionAudit = { id: newId("compress"), runId: data.runId ?? null, createdAt: nowIso(), ...data };
    await this.pool.query(`insert into compression_audits (id, run_id, strategy, strategy_version, original_tokens, compressed_tokens, kept, summarized, dropped, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
      audit.id,
      audit.runId,
      audit.strategy,
      audit.strategyVersion,
      audit.originalTokens,
      audit.compressedTokens,
      JSON.stringify(audit.kept),
      JSON.stringify(audit.summarized),
      JSON.stringify(audit.dropped),
      audit.createdAt
    ]);
    return audit;
  }

  async listCompressionAudits(runId?: string): Promise<CompressionAudit[]> {
    const result = runId ? await this.pool.query(`select * from compression_audits where run_id=$1 order by created_at desc`, [runId]) : await this.pool.query(`select * from compression_audits order by created_at desc`);
    return result.rows.map(rowToCompressionAudit);
  }

  async createQueueTask(data: CreateRunQueueTaskData): Promise<RunQueueTask> {
    const now = nowIso();
    const task: RunQueueTask = { id: newId("queue"), status: "queued", attempts: 0, lockedAt: null, lastError: null, createdAt: now, updatedAt: now, ...data };
    await this.pool.query(`insert into run_queue_tasks (id, run_id, status, request_id, actor, input, attempts, locked_at, last_error, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [task.id, task.runId, task.status, task.requestId, task.actor, task.input, task.attempts, task.lockedAt, task.lastError, task.createdAt, task.updatedAt]);
    return task;
  }

  async updateQueueTask(id: string, patch: Partial<RunQueueTask>): Promise<RunQueueTask> {
    const current = (await this.pool.query(`select * from run_queue_tasks where id=$1`, [id])).rows[0];
    if (!current) throw new Error("Queue task not found: " + id);
    const next = { ...rowToQueueTask(current), ...withoutUndefined(patch), updatedAt: nowIso() };
    await this.pool.query(`update run_queue_tasks set status=$2, request_id=$3, actor=$4, input=$5, attempts=$6, locked_at=$7, last_error=$8, updated_at=$9 where id=$1`, [id, next.status, next.requestId, next.actor, next.input, next.attempts, next.lockedAt, next.lastError, next.updatedAt]);
    return next;
  }

  async listQueueTasks(statuses?: RunQueueTask["status"][]): Promise<RunQueueTask[]> {
    const result = statuses && statuses.length > 0 ? await this.pool.query(`select * from run_queue_tasks where status = any($1) order by created_at asc`, [statuses]) : await this.pool.query(`select * from run_queue_tasks order by created_at asc`);
    return result.rows.map(rowToQueueTask);
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
    await this.pool.query(
      `insert into agent_runs (id, status, input, output, total_tokens, error_type, error_message, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [run.id, run.status, run.input, run.output, run.totalTokens, run.errorType, run.errorMessage, run.createdAt, run.updatedAt]
    );
    return run;
  }

  async updateRun(id: string, patch: Partial<AgentRun>): Promise<AgentRun> {
    const current = await this.getRun(id);
    if (!current) throw new Error(`Run not found: ${id}`);
    const next = { ...current, ...withoutUndefined(patch), updatedAt: nowIso() };
    await this.pool.query(
      `update agent_runs set status=$2, input=$3, output=$4, total_tokens=$5, error_type=$6, error_message=$7, updated_at=$8 where id=$1`,
      [id, next.status, next.input, next.output, next.totalTokens, next.errorType, next.errorMessage, next.updatedAt]
    );
    return next;
  }

  async getRun(id: string): Promise<AgentRun | null> {
    const result = await this.pool.query(`select * from agent_runs where id=$1`, [id]);
    return result.rows[0] ? rowToRun(result.rows[0]) : null;
  }

  async listRuns(): Promise<AgentRun[]> {
    const result = await this.pool.query(`select * from agent_runs order by created_at desc`);
    return result.rows.map(rowToRun);
  }

  async createStep(data: Omit<RunStep, "id">): Promise<RunStep> {
    const step = { ...data, id: newId("step") };
    await this.pool.query(
      `insert into agent_run_steps (id, run_id, agent_id, status, input, output, input_tokens, output_tokens, total_tokens, started_at, completed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [step.id, step.runId, step.agentId, step.status, step.input, step.output, step.inputTokens, step.outputTokens, step.totalTokens, step.startedAt, step.completedAt]
    );
    return step;
  }

  async updateStep(id: string, patch: Partial<RunStep>): Promise<RunStep> {
    const result = await this.pool.query(`select * from agent_run_steps where id=$1`, [id]);
    if (!result.rows[0]) throw new Error(`Step not found: ${id}`);
    const next = { ...rowToStep(result.rows[0]), ...withoutUndefined(patch) };
    await this.pool.query(
      `update agent_run_steps set status=$2, input=$3, output=$4, input_tokens=$5, output_tokens=$6, total_tokens=$7, started_at=$8, completed_at=$9 where id=$1`,
      [id, next.status, next.input, next.output, next.inputTokens, next.outputTokens, next.totalTokens, next.startedAt, next.completedAt]
    );
    return next;
  }

  async listSteps(runId: string): Promise<RunStep[]> {
    const result = await this.pool.query(`select * from agent_run_steps where run_id=$1 order by id asc`, [runId]);
    return result.rows.map(rowToStep);
  }

  async addEvent(data: Omit<RunEvent, "id" | "createdAt">): Promise<RunEvent> {
    const event: RunEvent = { ...data, id: newId("event"), createdAt: nowIso() };
    await this.pool.query(
      `insert into run_events (id, run_id, step_id, status, title, summary, visible, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [event.id, event.runId, event.stepId, event.status, event.title, event.summary, event.visible, event.createdAt]
    );
    return event;
  }

  async listEvents(runId: string): Promise<RunEvent[]> {
    const result = await this.pool.query(`select * from run_events where run_id=$1 order by created_at asc`, [runId]);
    return result.rows.map(rowToEvent);
  }

  async addToken(token: ApiToken): Promise<ApiToken> {
    await this.pool.query(
      `insert into api_tokens (id, token_hash, name, scopes, status, created_at, revoked_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (token_hash) do nothing`,
      [token.id, token.tokenHash, token.name, token.scopes.join(","), token.status, token.createdAt, token.revokedAt]
    );
    return token;
  }

  async listTokens(): Promise<ApiToken[]> {
    const result = await this.pool.query(`select * from api_tokens order by created_at desc`);
    return result.rows.map(rowToToken);
  }

  async getToken(id: string): Promise<ApiToken | null> {
    const result = await this.pool.query(`select * from api_tokens where id=$1`, [id]);
    return result.rows[0] ? rowToToken(result.rows[0]) : null;
  }

  async revokeToken(id: string, revokedAt: string): Promise<ApiToken | null> {
    const result = await this.pool.query(
      `update api_tokens set status='revoked', revoked_at=$2 where id=$1 returning *`,
      [id, revokedAt]
    );
    return result.rows[0] ? rowToToken(result.rows[0]) : null;
  }

  async addAudit(event: AuditEvent): Promise<AuditEvent> {
    await this.pool.query(
      `insert into audit_events (id, request_id, actor, action, target_type, target_id, status, metadata, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [event.id, event.requestId, event.actor, event.action, event.targetType, event.targetId, event.status, event.metadata, event.createdAt]
    );
    return event;
  }

  async listAuditEvents(): Promise<AuditEvent[]> {
    const result = await this.pool.query(`select * from audit_events order by created_at desc`);
    return result.rows.map(rowToAudit);
  }
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}




function rowToQueueTask(row: Record<string, unknown>): RunQueueTask {
  return { id: String(row.id), runId: String(row.run_id), status: row.status as RunQueueTask["status"], requestId: String(row.request_id), actor: row.actor as RunQueueTask["actor"], input: row.input as RunQueueTask["input"], attempts: Number(row.attempts), lockedAt: row.locked_at === null ? null : iso(row.locked_at), lastError: row.last_error === null ? null : String(row.last_error), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function rowToMemory(row: Record<string, unknown>): AgentMemory {
  return { id: String(row.id), agentId: String(row.agent_id), type: row.type as AgentMemory["type"], scope: row.scope as AgentMemory["scope"], status: row.status as AgentMemory["status"], summary: String(row.summary), content: String(row.content), source: String(row.source), sourceRunId: row.source_run_id === null ? null : String(row.source_run_id), createdBy: String(row.created_by), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function rowToConversation(row: Record<string, unknown>): AgentConversation {
  return { id: String(row.id), agentId: String(row.agent_id), mode: row.mode as AgentConversation["mode"], status: row.status as AgentConversation["status"], summary: String(row.summary ?? ""), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function rowToMessage(row: Record<string, unknown>): AgentMessage {
  return { id: String(row.id), conversationId: String(row.conversation_id), agentId: String(row.agent_id), role: row.role as AgentMessage["role"], content: String(row.content), runId: row.run_id === null ? null : String(row.run_id), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), totalTokens: Number(row.total_tokens), createdAt: iso(row.created_at) };
}

function rowToProtocol(row: Record<string, unknown>): AgentProtocol {
  return { id: String(row.id), agentId: String(row.agent_id), name: String(row.name), version: String(row.version), inputSchema: (row.input_schema ?? {}) as Record<string, unknown>, outputSchema: (row.output_schema ?? {}) as Record<string, unknown>, status: row.status as AgentProtocol["status"], createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function rowToLease(row: Record<string, unknown>): AgentLease {
  return { id: String(row.id), agentId: String(row.agent_id), status: row.status as AgentLease["status"], expiresAt: iso(row.expires_at), maxCalls: Number(row.max_calls), usedCalls: Number(row.used_calls), tokenBudget: Number(row.token_budget), usedTokens: Number(row.used_tokens), allowedProtocols: String(row.allowed_protocols).split(",").filter(Boolean), createdBy: String(row.created_by), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function rowToArtifact(row: Record<string, unknown>): RunArtifact {
  return { id: String(row.id), runId: String(row.run_id), type: row.type as RunArtifact["type"], name: String(row.name), content: String(row.content), createdAt: iso(row.created_at) };
}

function rowToCompressionAudit(row: Record<string, unknown>): CompressionAudit {
  return { id: String(row.id), runId: row.run_id === null ? null : String(row.run_id), strategy: row.strategy as CompressionAudit["strategy"], strategyVersion: String(row.strategy_version), originalTokens: Number(row.original_tokens), compressedTokens: Number(row.compressed_tokens), kept: (row.kept ?? []) as string[], summarized: (row.summarized ?? []) as string[], dropped: (row.dropped ?? []) as string[], createdAt: iso(row.created_at) };
}

function rowToProvider(row: Record<string, unknown>): ModelProviderConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    type: row.type as ModelProviderConfig["type"],
    status: row.status as ModelProviderConfig["status"],
    baseUrl: row.base_url === null ? null : String(row.base_url),
    defaultModel: String(row.default_model),
    apiKeyRef: row.api_key_ref === null ? null : String(row.api_key_ref),
    timeoutMs: Number(row.timeout_ms),
    maxRetries: Number(row.max_retries),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ""),
    instruction: String(row.instruction),
    status: row.status as Agent["status"],
    defaultModel: String(row.default_model),
    providerId: row.provider_id === null || row.provider_id === undefined ? null : String(row.provider_id),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function rowToRun(row: Record<string, unknown>): AgentRun {
  return {
    id: String(row.id),
    status: row.status as AgentRun["status"],
    input: String(row.input),
    output: row.output === null ? null : String(row.output),
    totalTokens: Number(row.total_tokens),
    errorType: row.error_type === null ? null : String(row.error_type),
    errorMessage: row.error_message === null ? null : String(row.error_message),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function rowToStep(row: Record<string, unknown>): RunStep {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    agentId: String(row.agent_id),
    status: row.status as RunStep["status"],
    input: String(row.input),
    output: row.output === null ? null : String(row.output),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    totalTokens: Number(row.total_tokens),
    startedAt: row.started_at === null ? null : iso(row.started_at),
    completedAt: row.completed_at === null ? null : iso(row.completed_at)
  };
}

function rowToEvent(row: Record<string, unknown>): RunEvent {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    stepId: row.step_id === null ? null : String(row.step_id),
    status: row.status as RunEvent["status"],
    title: String(row.title),
    summary: String(row.summary),
    visible: Boolean(row.visible),
    createdAt: iso(row.created_at)
  };
}

function rowToToken(row: Record<string, unknown>): ApiToken {
  return {
    id: String(row.id),
    tokenHash: String(row.token_hash),
    name: String(row.name),
    scopes: String(row.scopes).split(",").filter(Boolean),
    status: row.status as ApiToken["status"],
    createdAt: iso(row.created_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at)
  };
}

function rowToAudit(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    actor: String(row.actor),
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    status: row.status as AuditEvent["status"],
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: iso(row.created_at)
  };
}
