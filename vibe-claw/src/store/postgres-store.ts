import pg from "pg";
import { newId, nowIso } from "../core/ids.js";
import { defaultAgentContract } from "../core/agent-contract.js";
import { DEFAULT_PROJECT_ID, DEFAULT_TENANT_ID } from "../types.js";
import type { Agent, AgentConversation, AgentLease, AgentMemory, AgentMessage, AgentProtocol, AgentRun, ApiToken, AuditEvent, CompressionAudit, IdempotencyRecord, ModelProviderConfig, ResourceScope, RunArtifact, RunEvent, RunQueueTask, RunStep, UsageCounter, WebhookDelivery, WebhookSubscription } from "../types.js";
import type { CreateAgentData, CreateArtifactData, CreateCompressionAuditData, CreateConversationData, CreateLeaseData, CreateMemoryData, CreateMessageData, CreateProtocolData, CreateProviderData, CreateRunQueueTaskData, CreateUsageCounterData, CreateWebhookSubscriptionData, Store, UpdateAgentData, UpdateProviderData, UpdateWebhookSubscriptionData } from "./store.js";
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

  async resetData() {
    const appTables = [
      "agent_messages",
      "agent_conversations",
      "agent_memories",
      "agent_protocols",
      "agent_leases",
      "agent_run_steps",
      "run_events",
      "run_artifacts",
      "compression_audits",
      "run_queue_tasks",
      "agent_run_contexts",
      "agent_versions",
      "model_configs",
      "agent_runs",
      "agents",
      "model_providers",
      "api_tokens",
      "audit_events",
      "idempotency_records",
      "conversation_locks",
      "usage_counters",
      "webhook_deliveries",
      "webhook_subscriptions"
    ];
    const existing = await this.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema='public' and table_name = any($1)`,
      [appTables]
    );
    const tableNames = existing.rows.map((row) => row.table_name);
    if (tableNames.length === 0) return { storeType: "postgres" as const, cleared: 0 };
    const counts = await Promise.all(tableNames.map((name) => this.pool.query(`select count(*)::int as count from ${quoteIdent(name)}`)));
    const cleared = counts.reduce((sum, result) => sum + Number(result.rows[0]?.count ?? 0), 0);
    await this.pool.query(`truncate table ${tableNames.map(quoteIdent).join(", ")} restart identity cascade`);
    return { storeType: "postgres" as const, cleared };
  }

  async createAgent(data: CreateAgentData): Promise<Agent> {
    const now = nowIso();
    const agent: Agent = {
      id: newId("agent"),
      ...scopeFrom(data),
      name: data.name,
      description: data.description ?? "",
      instruction: data.instruction,
      contract: defaultAgentContract(data),
      status: "active",
      defaultModel: data.defaultModel ?? "mock",
      providerId: data.providerId ?? null,
      createdAt: now,
      updatedAt: now
    };
    await this.pool.query(
      `insert into agents (id, tenant_id, project_id, name, description, instruction, contract, status, default_model, provider_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [agent.id, agent.tenantId, agent.projectId, agent.name, agent.description, agent.instruction, JSON.stringify(agent.contract), agent.status, agent.defaultModel, agent.providerId, agent.createdAt, agent.updatedAt]
    );
    return agent;
  }

  async updateAgent(id: string, patch: UpdateAgentData): Promise<Agent | null> {
    const current = await this.getAgent(id);
    if (!current) return null;
    const patchWithoutContract = withoutUndefined(patch);
    const next = {
      ...current,
      ...patchWithoutContract,
      contract: patch.contract ? defaultAgentContract({ ...current, ...patchWithoutContract, contract: { ...current.contract, ...patch.contract } }) : current.contract,
      updatedAt: nowIso()
    };
    await this.pool.query(
      `update agents set name=$2, description=$3, instruction=$4, contract=$5, status=$6, default_model=$7, provider_id=$8, updated_at=$9 where id=$1`,
      [id, next.name, next.description, next.instruction, JSON.stringify(next.contract), next.status, next.defaultModel, next.providerId, next.updatedAt]
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
    await this.pool.query(
      `insert into model_providers (id, tenant_id, project_id, name, type, status, base_url, default_model, api_key_ref, timeout_ms, max_retries, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [provider.id, provider.tenantId, provider.projectId, provider.name, provider.type, provider.status, provider.baseUrl, provider.defaultModel, provider.apiKeyRef, provider.timeoutMs, provider.maxRetries, provider.createdAt, provider.updatedAt]
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
    const memory: AgentMemory = {
      id: newId("mem"),
      ...scopeFrom(data),
      status: "active",
      sourceRunId: data.sourceRunId ?? null,
      importance: data.importance ?? defaultMemoryImportance(data.type),
      confidence: data.confidence ?? 0.75,
      tags: data.tags ?? [],
      provenance: data.provenance ?? data.source,
      expiresAt: data.expiresAt ?? null,
      lastAccessedAt: null,
      createdAt: now,
      updatedAt: now,
      ...data
    };
    await this.pool.query(
      `insert into agent_memories (id, tenant_id, project_id, agent_id, type, scope, status, summary, content, source, source_run_id, importance, confidence, tags, provenance, expires_at, last_accessed_at, created_by, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [memory.id, memory.tenantId, memory.projectId, memory.agentId, memory.type, memory.scope, memory.status, memory.summary, memory.content, memory.source, memory.sourceRunId, memory.importance, memory.confidence, memory.tags.join(","), memory.provenance, memory.expiresAt, memory.lastAccessedAt, memory.createdBy, memory.createdAt, memory.updatedAt]
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
    const conversation: AgentConversation = { id: newId("conv"), ...scopeFrom(data), agentId: data.agentId, mode: data.mode, status: "active", summary: data.summary ?? "", createdAt: now, updatedAt: now };
    await this.pool.query(`insert into agent_conversations (id, tenant_id, project_id, agent_id, mode, status, summary, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [conversation.id, conversation.tenantId, conversation.projectId, conversation.agentId, conversation.mode, conversation.status, conversation.summary, conversation.createdAt, conversation.updatedAt]);
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

  async findConversationByRunId(runId: string): Promise<AgentConversation | null> {
    const result = await this.pool.query(
      `select c.*
       from agent_messages m
       join agent_conversations c on c.id = m.conversation_id
       where m.run_id=$1
       order by m.created_at desc
       limit 1`,
      [runId]
    );
    return result.rows[0] ? rowToConversation(result.rows[0]) : null;
  }

  async addMessage(data: CreateMessageData): Promise<AgentMessage> {
    const message: AgentMessage = { id: newId("msg"), ...scopeFrom(data), runId: data.runId ?? null, inputTokens: data.inputTokens ?? 0, outputTokens: data.outputTokens ?? 0, totalTokens: data.totalTokens ?? 0, createdAt: nowIso(), ...data };
    await this.pool.query(`insert into agent_messages (id, tenant_id, project_id, conversation_id, agent_id, role, content, run_id, input_tokens, output_tokens, total_tokens, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [message.id, message.tenantId, message.projectId, message.conversationId, message.agentId, message.role, message.content, message.runId, message.inputTokens, message.outputTokens, message.totalTokens, message.createdAt]);
    await this.pool.query(`update agent_conversations set updated_at=$2 where id=$1`, [message.conversationId, nowIso()]);
    return message;
  }

  async listMessages(conversationId: string): Promise<AgentMessage[]> {
    const result = await this.pool.query(`select * from agent_messages where conversation_id=$1 order by created_at asc`, [conversationId]);
    return result.rows.map(rowToMessage);
  }

  async createProtocol(data: CreateProtocolData): Promise<AgentProtocol> {
    const now = nowIso();
    const protocol: AgentProtocol = { id: newId("protocol"), ...scopeFrom(data), status: "active", createdAt: now, updatedAt: now, ...data };
    await this.pool.query(`insert into agent_protocols (id, tenant_id, project_id, agent_id, name, version, input_schema, output_schema, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [protocol.id, protocol.tenantId, protocol.projectId, protocol.agentId, protocol.name, protocol.version, protocol.inputSchema, protocol.outputSchema, protocol.status, protocol.createdAt, protocol.updatedAt]);
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
    const lease: AgentLease = { id: newId("lease"), ...scopeFrom(data), status: "active", usedCalls: 0, usedTokens: 0, createdAt: now, updatedAt: now, ...data };
    await this.pool.query(`insert into agent_leases (id, tenant_id, project_id, agent_id, status, expires_at, max_calls, used_calls, token_budget, used_tokens, allowed_protocols, created_by, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [lease.id, lease.tenantId, lease.projectId, lease.agentId, lease.status, lease.expiresAt, lease.maxCalls, lease.usedCalls, lease.tokenBudget, lease.usedTokens, lease.allowedProtocols.join(","), lease.createdBy, lease.createdAt, lease.updatedAt]);
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
    const artifact: RunArtifact = { id: newId("artifact"), ...scopeFrom(data), createdAt: nowIso(), ...data };
    await this.pool.query(`insert into run_artifacts (id, tenant_id, project_id, run_id, type, name, content, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [artifact.id, artifact.tenantId, artifact.projectId, artifact.runId, artifact.type, artifact.name, artifact.content, artifact.createdAt]);
    return artifact;
  }

  async listArtifacts(runId: string): Promise<RunArtifact[]> {
    const result = await this.pool.query(`select * from run_artifacts where run_id=$1 order by created_at asc`, [runId]);
    return result.rows.map(rowToArtifact);
  }

  async addCompressionAudit(data: CreateCompressionAuditData): Promise<CompressionAudit> {
    const audit: CompressionAudit = { id: newId("compress"), ...scopeFrom(data), runId: data.runId ?? null, createdAt: nowIso(), ...data };
    await this.pool.query(`insert into compression_audits (id, tenant_id, project_id, run_id, strategy, strategy_version, original_tokens, compressed_tokens, kept, summarized, dropped, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
      audit.id,
      audit.tenantId,
      audit.projectId,
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
    const task: RunQueueTask = { id: newId("queue"), ...scopeFrom(data), status: "queued", attempts: 0, lockedAt: null, lockedBy: null, lockExpiresAt: null, maxAttempts: 3, nextRunAt: now, lastError: null, createdAt: now, updatedAt: now, ...data };
    await this.pool.query(`insert into run_queue_tasks (id, tenant_id, project_id, run_id, status, request_id, actor, input, attempts, locked_at, locked_by, lock_expires_at, max_attempts, next_run_at, last_error, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [task.id, task.tenantId, task.projectId, task.runId, task.status, task.requestId, task.actor, task.input, task.attempts, task.lockedAt, task.lockedBy, task.lockExpiresAt, task.maxAttempts, task.nextRunAt, task.lastError, task.createdAt, task.updatedAt]);
    return task;
  }

  async updateQueueTask(id: string, patch: Partial<RunQueueTask>): Promise<RunQueueTask> {
    const current = (await this.pool.query(`select * from run_queue_tasks where id=$1`, [id])).rows[0];
    if (!current) throw new Error("Queue task not found: " + id);
    const next = { ...rowToQueueTask(current), ...withoutUndefined(patch), updatedAt: nowIso() };
    await this.pool.query(`update run_queue_tasks set status=$2, request_id=$3, actor=$4, input=$5, attempts=$6, locked_at=$7, locked_by=$8, lock_expires_at=$9, max_attempts=$10, next_run_at=$11, last_error=$12, updated_at=$13 where id=$1`, [id, next.status, next.requestId, next.actor, next.input, next.attempts, next.lockedAt, next.lockedBy, next.lockExpiresAt, next.maxAttempts, next.nextRunAt, next.lastError, next.updatedAt]);
    return next;
  }

  async listQueueTasks(statuses?: RunQueueTask["status"][]): Promise<RunQueueTask[]> {
    const result = statuses && statuses.length > 0 ? await this.pool.query(`select * from run_queue_tasks where status = any($1) order by created_at asc`, [statuses]) : await this.pool.query(`select * from run_queue_tasks order by created_at asc`);
    return result.rows.map(rowToQueueTask);
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
    await this.pool.query(
      `insert into agent_runs (id, tenant_id, project_id, status, input, output, total_tokens, error_type, error_message, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [run.id, run.tenantId, run.projectId, run.status, run.input, run.output, run.totalTokens, run.errorType, run.errorMessage, run.createdAt, run.updatedAt]
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
    const step = { ...scopeFrom(data), ...data, id: newId("step") };
    await this.pool.query(
      `insert into agent_run_steps (id, tenant_id, project_id, run_id, agent_id, status, input, output, input_tokens, output_tokens, total_tokens, started_at, completed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [step.id, step.tenantId, step.projectId, step.runId, step.agentId, step.status, step.input, step.output, step.inputTokens, step.outputTokens, step.totalTokens, step.startedAt, step.completedAt]
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
    const event: RunEvent = { ...scopeFrom(data), ...data, id: newId("event"), createdAt: nowIso() };
    await this.pool.query(
      `insert into run_events (id, tenant_id, project_id, run_id, step_id, status, title, summary, visible, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [event.id, event.tenantId, event.projectId, event.runId, event.stepId, event.status, event.title, event.summary, event.visible, event.createdAt]
    );
    return event;
  }

  async listEvents(runId: string): Promise<RunEvent[]> {
    const result = await this.pool.query(`select * from run_events where run_id=$1 order by created_at asc`, [runId]);
    return result.rows.map(rowToEvent);
  }

  async addToken(token: ApiToken): Promise<ApiToken> {
    const scoped = scopeFrom(token);
    await this.pool.query(
      `insert into api_tokens (id, tenant_id, project_id, token_hash, name, scopes, status, expires_at, allowed_ips, last_used_at, last_used_ip, created_at, revoked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (token_hash) do nothing`,
      [token.id, scoped.tenantId, scoped.projectId, token.tokenHash, token.name, token.scopes.join(","), token.status, token.expiresAt, token.allowedIps.join(","), token.lastUsedAt, token.lastUsedIp, token.createdAt, token.revokedAt]
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

  async markTokenUsed(id: string, usedAt: string, ip: string | null): Promise<ApiToken | null> {
    const result = await this.pool.query(
      `update api_tokens set last_used_at=$2, last_used_ip=$3 where id=$1 returning *`,
      [id, usedAt, ip]
    );
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
    const scoped = scopeFrom(event);
    await this.pool.query(
      `insert into audit_events (id, tenant_id, project_id, request_id, actor, action, target_type, target_id, status, metadata, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [event.id, scoped.tenantId, scoped.projectId, event.requestId, event.actor, event.action, event.targetType, event.targetId, event.status, event.metadata, event.createdAt]
    );
    return event;
  }

  async listAuditEvents(): Promise<AuditEvent[]> {
    const result = await this.pool.query(`select * from audit_events order by created_at desc`);
    return result.rows.map(rowToAudit);
  }

  async getIdempotencyRecord(scope: ResourceScope, actor: string, method: string, path: string, key: string): Promise<IdempotencyRecord | null> {
    const scoped = scopeFrom(scope);
    const result = await this.pool.query(
      `select * from idempotency_records where tenant_id=$1 and project_id=$2 and actor=$3 and method=$4 and path=$5 and idempotency_key=$6 and expires_at > now()`,
      [scoped.tenantId, scoped.projectId, actor, method, path, key]
    );
    return result.rows[0] ? rowToIdempotency(result.rows[0]) : null;
  }

  async saveIdempotencyRecord(record: IdempotencyRecord): Promise<IdempotencyRecord> {
    const scoped = scopeFrom(record);
    await this.pool.query(
      `insert into idempotency_records (id, tenant_id, project_id, actor, method, path, idempotency_key, body_hash, status_code, response_body, expires_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (tenant_id, project_id, actor, method, path, idempotency_key) do nothing`,
      [record.id, scoped.tenantId, scoped.projectId, record.actor, record.method, record.path, record.idempotencyKey, record.bodyHash, record.statusCode, record.responseBody, record.expiresAt, record.createdAt]
    );
    return record;
  }

  async cleanupExpiredIdempotencyRecords(now: string): Promise<number> {
    const result = await this.pool.query(`delete from idempotency_records where expires_at <= $1`, [now]);
    return result.rowCount ?? 0;
  }

  async acquireConversationLock(scope: ResourceScope, conversationId: string, holder: string, lockUntil: string): Promise<boolean> {
    const scoped = scopeFrom(scope);
    const now = nowIso();
    const result = await this.pool.query(
      `insert into conversation_locks (conversation_id, tenant_id, project_id, holder, lock_until, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$6)
       on conflict (conversation_id) do update set holder=$4, lock_until=$5, updated_at=$6
       where conversation_locks.lock_until <= $6 or conversation_locks.holder = $4
       returning conversation_id`,
      [conversationId, scoped.tenantId, scoped.projectId, holder, lockUntil, now]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async releaseConversationLock(conversationId: string, holder: string): Promise<void> {
    await this.pool.query(`delete from conversation_locks where conversation_id=$1 and holder=$2`, [conversationId, holder]);
  }

  async claimQueueTask(workerId: string, lockUntil: string): Promise<RunQueueTask | null> {
    const result = await this.pool.query(
      `update run_queue_tasks
       set status='running', attempts=attempts+1, locked_at=now(), locked_by=$1, lock_expires_at=$2, updated_at=now()
       where id = (
         select id from run_queue_tasks
         where status='queued'
           and (next_run_at is null or next_run_at <= now())
           and (lock_expires_at is null or lock_expires_at <= now())
         order by created_at asc
         for update skip locked
         limit 1
       )
       returning *`,
      [workerId, lockUntil]
    );
    return result.rows[0] ? rowToQueueTask(result.rows[0]) : null;
  }

  async recordUsage(data: CreateUsageCounterData): Promise<UsageCounter> {
    const scoped = scopeFrom(data);
    const now = nowIso();
    const result = await this.pool.query(
      `insert into usage_counters (id, tenant_id, project_id, token_id, agent_id, provider_id, usage_window, request_count, token_count, cost_units, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       on conflict (tenant_id, project_id, (coalesce(token_id, ''::text)), (coalesce(agent_id, ''::text)), (coalesce(provider_id, ''::text)), usage_window)
       do update set
         request_count=usage_counters.request_count + excluded.request_count,
         token_count=usage_counters.token_count + excluded.token_count,
         cost_units=usage_counters.cost_units + excluded.cost_units,
         updated_at=excluded.updated_at
       returning *`,
      [
        newId("usage"),
        scoped.tenantId,
        scoped.projectId,
        data.tokenId ?? null,
        data.agentId ?? null,
        data.providerId ?? null,
        data.usageWindow,
        data.requestCount ?? 0,
        data.tokenCount ?? 0,
        data.costUnits ?? 0,
        now
      ]
    );
    return rowToUsageCounter(result.rows[0]);
  }

  async listUsageCounters(scope: ResourceScope = {}): Promise<UsageCounter[]> {
    const scoped = scopeFrom(scope);
    const result = await this.pool.query(`select * from usage_counters where tenant_id=$1 and project_id=$2 order by usage_window desc, updated_at desc`, [scoped.tenantId, scoped.projectId]);
    return result.rows.map(rowToUsageCounter);
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
    await this.pool.query(
      `insert into webhook_subscriptions (id, tenant_id, project_id, name, url, secret_ref, event_types, status, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [subscription.id, subscription.tenantId, subscription.projectId, subscription.name, subscription.url, subscription.secretRef, subscription.eventTypes.join(","), subscription.status, subscription.createdAt, subscription.updatedAt]
    );
    return subscription;
  }

  async updateWebhookSubscription(id: string, patch: UpdateWebhookSubscriptionData): Promise<WebhookSubscription | null> {
    const current = (await this.pool.query(`select * from webhook_subscriptions where id=$1`, [id])).rows[0];
    if (!current) return null;
    const next = { ...rowToWebhookSubscription(current), ...withoutUndefined(patch), updatedAt: nowIso() };
    await this.pool.query(
      `update webhook_subscriptions set name=$2, url=$3, secret_ref=$4, event_types=$5, status=$6, updated_at=$7 where id=$1 returning *`,
      [id, next.name, next.url, next.secretRef, next.eventTypes.join(","), next.status, next.updatedAt]
    );
    return next;
  }

  async listWebhookSubscriptions(scope: ResourceScope = {}): Promise<WebhookSubscription[]> {
    const scoped = scopeFrom(scope);
    const result = await this.pool.query(`select * from webhook_subscriptions where tenant_id=$1 and project_id=$2 order by created_at desc`, [scoped.tenantId, scoped.projectId]);
    return result.rows.map(rowToWebhookSubscription);
  }

  async createWebhookDelivery(data: Omit<WebhookDelivery, "id" | "createdAt" | "updatedAt">): Promise<WebhookDelivery> {
    const now = nowIso();
    const delivery: WebhookDelivery = { id: newId("wh"), createdAt: now, updatedAt: now, ...data };
    const scoped = scopeFrom(delivery);
    await this.pool.query(
      `insert into webhook_deliveries (id, tenant_id, project_id, run_id, url, status, attempts, max_attempts, next_attempt_at, status_code, error, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [delivery.id, scoped.tenantId, scoped.projectId, delivery.runId, delivery.url, delivery.status, delivery.attempts, delivery.maxAttempts, delivery.nextAttemptAt, delivery.statusCode, delivery.error, delivery.createdAt, delivery.updatedAt]
    );
    return delivery;
  }

  async updateWebhookDelivery(id: string, patch: Partial<WebhookDelivery>): Promise<WebhookDelivery> {
    const current = (await this.pool.query(`select * from webhook_deliveries where id=$1`, [id])).rows[0];
    if (!current) throw new Error("Webhook delivery not found: " + id);
    const next = { ...rowToWebhookDelivery(current), ...withoutUndefined(patch), updatedAt: nowIso() };
    await this.pool.query(
      `update webhook_deliveries set status=$2, attempts=$3, max_attempts=$4, next_attempt_at=$5, status_code=$6, error=$7, updated_at=$8 where id=$1`,
      [id, next.status, next.attempts, next.maxAttempts, next.nextAttemptAt, next.statusCode, next.error, next.updatedAt]
    );
    return next;
  }

  async listWebhookDeliveries(runId?: string): Promise<WebhookDelivery[]> {
    const result = runId ? await this.pool.query(`select * from webhook_deliveries where run_id=$1 order by created_at desc`, [runId]) : await this.pool.query(`select * from webhook_deliveries order by created_at desc`);
    return result.rows.map(rowToWebhookDelivery);
  }
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function scopeFrom(value: Partial<ResourceScope>): Required<ResourceScope> {
  return { tenantId: value.tenantId ?? DEFAULT_TENANT_ID, projectId: value.projectId ?? DEFAULT_PROJECT_ID };
}

function rowScope(row: Record<string, unknown>): Required<ResourceScope> {
  return { tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID), projectId: String(row.project_id ?? DEFAULT_PROJECT_ID) };
}

function rowToQueueTask(row: Record<string, unknown>): RunQueueTask {
  return { id: String(row.id), tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID), projectId: String(row.project_id ?? DEFAULT_PROJECT_ID), runId: String(row.run_id), status: row.status as RunQueueTask["status"], requestId: String(row.request_id), actor: row.actor as RunQueueTask["actor"], input: row.input as RunQueueTask["input"], attempts: Number(row.attempts), lockedAt: row.locked_at === null ? null : iso(row.locked_at), lockedBy: row.locked_by === null || row.locked_by === undefined ? null : String(row.locked_by), lockExpiresAt: row.lock_expires_at === null || row.lock_expires_at === undefined ? null : iso(row.lock_expires_at), maxAttempts: Number(row.max_attempts ?? 3), nextRunAt: row.next_run_at === null || row.next_run_at === undefined ? null : iso(row.next_run_at), lastError: row.last_error === null ? null : String(row.last_error), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function rowToIdempotency(row: Record<string, unknown>): IdempotencyRecord {
  return { id: String(row.id), tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID), projectId: String(row.project_id ?? DEFAULT_PROJECT_ID), actor: String(row.actor), method: String(row.method), path: String(row.path), idempotencyKey: String(row.idempotency_key), bodyHash: String(row.body_hash), statusCode: Number(row.status_code), responseBody: (row.response_body ?? {}) as Record<string, unknown>, expiresAt: iso(row.expires_at), createdAt: iso(row.created_at) };
}

function rowToWebhookDelivery(row: Record<string, unknown>): WebhookDelivery {
  return { id: String(row.id), tenantId: String(row.tenant_id ?? DEFAULT_TENANT_ID), projectId: String(row.project_id ?? DEFAULT_PROJECT_ID), runId: String(row.run_id), url: String(row.url), status: row.status as WebhookDelivery["status"], attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts), nextAttemptAt: row.next_attempt_at === null ? null : iso(row.next_attempt_at), statusCode: row.status_code === null ? null : Number(row.status_code), error: row.error === null ? null : String(row.error), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function rowToUsageCounter(row: Record<string, unknown>): UsageCounter {
  return {
    id: String(row.id),
    ...rowScope(row),
    tokenId: row.token_id === null || row.token_id === undefined ? null : String(row.token_id),
    agentId: row.agent_id === null || row.agent_id === undefined ? null : String(row.agent_id),
    providerId: row.provider_id === null || row.provider_id === undefined ? null : String(row.provider_id),
    usageWindow: String(row.usage_window),
    requestCount: Number(row.request_count),
    tokenCount: Number(row.token_count),
    costUnits: Number(row.cost_units),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function rowToWebhookSubscription(row: Record<string, unknown>): WebhookSubscription {
  return {
    id: String(row.id),
    ...rowScope(row),
    name: String(row.name),
    url: String(row.url),
    secretRef: row.secret_ref === null || row.secret_ref === undefined ? null : String(row.secret_ref),
    eventTypes: String(row.event_types ?? "").split(",").filter(Boolean),
    status: row.status as WebhookSubscription["status"],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function rowToMemory(row: Record<string, unknown>): AgentMemory {
  return {
    id: String(row.id),
    ...rowScope(row),
    agentId: String(row.agent_id),
    type: row.type as AgentMemory["type"],
    scope: row.scope as AgentMemory["scope"],
    status: row.status as AgentMemory["status"],
    summary: String(row.summary),
    content: String(row.content),
    source: String(row.source),
    sourceRunId: row.source_run_id === null ? null : String(row.source_run_id),
    importance: Number(row.importance ?? defaultMemoryImportance(row.type as AgentMemory["type"])),
    confidence: Number(row.confidence ?? 0.75),
    tags: String(row.tags ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    provenance: String(row.provenance ?? row.source ?? "unknown"),
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : iso(row.expires_at),
    lastAccessedAt: row.last_accessed_at === null || row.last_accessed_at === undefined ? null : iso(row.last_accessed_at),
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function rowToConversation(row: Record<string, unknown>): AgentConversation {
  return { id: String(row.id), ...rowScope(row), agentId: String(row.agent_id), mode: row.mode as AgentConversation["mode"], status: row.status as AgentConversation["status"], summary: String(row.summary ?? ""), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function rowToMessage(row: Record<string, unknown>): AgentMessage {
  return { id: String(row.id), ...rowScope(row), conversationId: String(row.conversation_id), agentId: String(row.agent_id), role: row.role as AgentMessage["role"], content: String(row.content), runId: row.run_id === null ? null : String(row.run_id), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens), totalTokens: Number(row.total_tokens), createdAt: iso(row.created_at) };
}

function rowToProtocol(row: Record<string, unknown>): AgentProtocol {
  return { id: String(row.id), ...rowScope(row), agentId: String(row.agent_id), name: String(row.name), version: String(row.version), inputSchema: (row.input_schema ?? {}) as Record<string, unknown>, outputSchema: (row.output_schema ?? {}) as Record<string, unknown>, status: row.status as AgentProtocol["status"], createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function rowToLease(row: Record<string, unknown>): AgentLease {
  return { id: String(row.id), ...rowScope(row), agentId: String(row.agent_id), status: row.status as AgentLease["status"], expiresAt: iso(row.expires_at), maxCalls: Number(row.max_calls), usedCalls: Number(row.used_calls), tokenBudget: Number(row.token_budget), usedTokens: Number(row.used_tokens), allowedProtocols: String(row.allowed_protocols).split(",").filter(Boolean), createdBy: String(row.created_by), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function rowToArtifact(row: Record<string, unknown>): RunArtifact {
  return { id: String(row.id), ...rowScope(row), runId: String(row.run_id), type: row.type as RunArtifact["type"], name: String(row.name), content: String(row.content), createdAt: iso(row.created_at) };
}

function rowToCompressionAudit(row: Record<string, unknown>): CompressionAudit {
  return { id: String(row.id), ...rowScope(row), runId: row.run_id === null ? null : String(row.run_id), strategy: row.strategy as CompressionAudit["strategy"], strategyVersion: String(row.strategy_version), originalTokens: Number(row.original_tokens), compressedTokens: Number(row.compressed_tokens), kept: (row.kept ?? []) as string[], summarized: (row.summarized ?? []) as string[], dropped: (row.dropped ?? []) as string[], createdAt: iso(row.created_at) };
}

function rowToProvider(row: Record<string, unknown>): ModelProviderConfig {
  return {
    id: String(row.id),
    ...rowScope(row),
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
  const partialContract = parseJsonObject(row.contract);
  const instruction = String(row.instruction);
  const name = String(row.name);
  const description = String(row.description ?? "");
  return {
    id: String(row.id),
    ...rowScope(row),
    name,
    description,
    instruction,
    contract: defaultAgentContract({ name, description, instruction, contract: partialContract }),
    status: row.status as Agent["status"],
    defaultModel: String(row.default_model),
    providerId: row.provider_id === null || row.provider_id === undefined ? null : String(row.provider_id),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function defaultMemoryImportance(type: AgentMemory["type"]): number {
  if (type === "profile") return 0.95;
  if (type === "semantic") return 0.8;
  if (type === "episodic") return 0.65;
  return 0.55;
}

function rowToRun(row: Record<string, unknown>): AgentRun {
  return {
    id: String(row.id),
    ...rowScope(row),
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
    ...rowScope(row),
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
    ...rowScope(row),
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
    ...rowScope(row),
    tokenHash: String(row.token_hash),
    name: String(row.name),
    scopes: String(row.scopes).split(",").filter(Boolean),
    status: row.status as ApiToken["status"],
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : iso(row.expires_at),
    allowedIps: String(row.allowed_ips ?? "").split(",").filter(Boolean),
    lastUsedAt: row.last_used_at === null || row.last_used_at === undefined ? null : iso(row.last_used_at),
    lastUsedIp: row.last_used_ip === null || row.last_used_ip === undefined ? null : String(row.last_used_ip),
    createdAt: iso(row.created_at),
    revokedAt: row.revoked_at === null ? null : iso(row.revoked_at)
  };
}

function rowToAudit(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    ...rowScope(row),
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
