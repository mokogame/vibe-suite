const crypto = require("node:crypto");
const { getDb, id, now, transaction, publicUser } = require("./db");
const { ensureDirectConversation, createMessage, createSystemMessage, getMessage, serializeMessage, listConversations } = require("./chat");
const { publishChatMessage } = require("./chat-events");

const DEFAULT_BASE_URL = "http://localhost:3100";
const DEFAULT_TOKEN = "dev-token";
const SETTINGS_KEY = "vibe_claw.integration";

class VibeClawError extends Error {
  constructor(message, input = {}) {
    super(message);
    this.name = "VibeClawError";
    this.code = input.code || "VIBE_CLAW_ERROR";
    this.status = input.status || 500;
    this.detail = input.detail || null;
  }
}

function readStoredConfig() {
  try {
    const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(SETTINGS_KEY);
    return row?.value ? JSON.parse(row.value) : {};
  } catch {
    return {};
  }
}

function config() {
  const stored = readStoredConfig();
  return {
    baseUrl: String(stored.baseUrl || process.env.VIBE_CLAW_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    token: stored.token || process.env.VIBE_CLAW_API_TOKEN || DEFAULT_TOKEN,
    timeoutMs: Number(stored.timeoutMs || process.env.VIBE_CLAW_TIMEOUT_MS || 90000)
  };
}

function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 10) return `${text.slice(0, 2)}******${text.slice(-2)}`;
  return `${text.slice(0, 7)}${"*".repeat(Math.min(18, Math.max(8, text.length - 11)))}${text.slice(-4)}`;
}

function publicConfig() {
  const current = config();
  return {
    baseUrl: current.baseUrl,
    tokenConfigured: Boolean(current.token),
    tokenMasked: maskSecret(current.token),
    timeoutMs: current.timeoutMs
  };
}

function saveConfig(input = {}) {
  const current = config();
  const next = {
    baseUrl: String(input.baseUrl || current.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    token: String(input.token || current.token || DEFAULT_TOKEN),
    timeoutMs: Math.max(5000, Number(input.timeoutMs || current.timeoutMs || 90000))
  };
  getDb().prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `).run(SETTINGS_KEY, JSON.stringify(next), now());
  return publicConfig();
}

function stableSuffix(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12);
}

function agentUserId(agentId) {
  return `claw_user_${stableSuffix(agentId)}`;
}

function agentUsername(agentId) {
  return `claw_${stableSuffix(agentId)}`;
}

async function clawFetch(path, options = {}) {
  const { baseUrl, token, timeoutMs } = config();
  const controller = new AbortController();
  const requestTimeoutMs = Number(options.timeoutMs || timeoutMs);
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
    const response = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new VibeClawError(body.message || body.error || `Vibe Claw 请求失败：${response.status}`, {
        code: body.code || `VIBE_CLAW_HTTP_${response.status}`,
        status: response.status,
        detail: body
      });
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new VibeClawError("Vibe Claw 响应超时", { code: "VIBE_CLAW_TIMEOUT", status: 504 });
    }
    if (error instanceof VibeClawError) throw error;
    throw new VibeClawError(error.message || "Vibe Claw 连接失败", { code: "VIBE_CLAW_UNREACHABLE", status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}

async function diagnoseVibeClaw() {
  const startedAt = Date.now();
  const diagnosticTimeoutMs = Math.min(config().timeoutMs || 90000, 6000);
  const result = {
    ok: false,
    status: "config_error",
    message: "",
    latencyMs: 0,
    config: publicConfig(),
    health: null,
    providers: [],
    agents: []
  };
  try {
    result.health = await clawFetch("/health", { timeoutMs: diagnosticTimeoutMs });
    const providersBody = await clawFetch("/v1/providers", { timeoutMs: diagnosticTimeoutMs });
    const agentsBody = await clawFetch("/v1/agents", { timeoutMs: diagnosticTimeoutMs });
    result.providers = providersBody.providers || [];
    result.agents = agentsBody.agents || [];
    const activeProviders = result.providers.filter(provider => provider.status === "active");
    const activeAgents = result.agents.filter(agent => agent.status === "active");
    if (!activeProviders.length) {
      result.status = "model_unavailable";
      result.message = "Vibe Claw 没有可用模型 Provider";
    } else if (!activeAgents.length) {
      result.status = "agent_unavailable";
      result.message = "Vibe Claw 没有可用 Agent";
    } else {
      result.ok = true;
      result.status = "online";
      result.message = "Vibe Claw 连接正常";
    }
  } catch (error) {
    result.status = error.code === "VIBE_CLAW_TIMEOUT" ? "timeout" : "config_error";
    result.message = error.message;
    result.error = { code: error.code || "VIBE_CLAW_ERROR", status: error.status || 500 };
  } finally {
    result.latencyMs = Date.now() - startedAt;
  }
  return result;
}

function mapAgentRow(row) {
  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    name: row.name,
    description: row.description || "",
    defaultModel: row.default_model || "",
    providerId: row.provider_id || "",
    status: row.status,
    lastSyncedAt: row.last_synced_at || null,
    lastError: row.last_error || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: row.username ? publicUser({
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      role: row.role,
      status: row.user_status
    }) : null
  };
}

function listMappedAgents() {
  return getDb().prepare(`
    SELECT a.*, u.username, u.display_name, u.avatar_url, u.role, u.status AS user_status
    FROM vibe_claw_agents a
    JOIN users u ON u.id = a.user_id
    WHERE a.status = 'active' AND u.status = 'active'
    ORDER BY a.updated_at DESC, a.name ASC
  `).all().map(mapAgentRow);
}

function getMappedAgent(agentId) {
  const row = getDb().prepare(`
    SELECT a.*, u.username, u.display_name, u.avatar_url, u.role, u.status AS user_status
    FROM vibe_claw_agents a
    JOIN users u ON u.id = a.user_id
    WHERE a.agent_id = ?
    LIMIT 1
  `).get(agentId);
  return row ? mapAgentRow(row) : null;
}

async function syncVibeClawAgents() {
  const body = await clawFetch("/v1/agents");
  const agents = (body.agents || []).filter(agent => agent.status !== "archived");
  const syncedAt = now();
  transaction(() => {
    for (const agent of agents) {
      const userId = agentUserId(agent.id);
      const username = agentUsername(agent.id);
      const displayName = agent.name || `Agent ${agent.id.slice(-6)}`;
      getDb().prepare(`
        INSERT INTO users (id, username, password_hash, display_name, avatar_url, role, status, created_at, updated_at)
        VALUES (?, ?, NULL, ?, NULL, 'agent', ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          role = 'agent',
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at
      `).run(userId, username, displayName, agent.status === "active" ? "active" : "inactive", syncedAt, syncedAt);

      getDb().prepare(`
        INSERT INTO vibe_claw_agents (id, agent_id, user_id, name, description, default_model, provider_id, status, created_at, updated_at, last_synced_at, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (agent_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          default_model = EXCLUDED.default_model,
          provider_id = EXCLUDED.provider_id,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          last_synced_at = EXCLUDED.last_synced_at,
          last_error = NULL
      `).run(
        `vca_${stableSuffix(agent.id)}`,
        agent.id,
        userId,
        displayName,
        agent.description || agent.instruction || "",
        agent.defaultModel || agent.default_model || "",
        agent.providerId || agent.provider_id || "",
        agent.status || "active",
        syncedAt,
        syncedAt,
        syncedAt,
        null
      );
    }
  });
  return listMappedAgents();
}

function getAgentForConversation(userId, conversationId) {
  const row = getDb().prepare(`
    SELECT a.*, u.username, u.display_name, u.avatar_url, u.role, u.status AS user_status
    FROM conversation_members current_member
    JOIN conversation_members agent_member
      ON agent_member.conversation_id = current_member.conversation_id
      AND agent_member.user_id != current_member.user_id
    JOIN vibe_claw_agents a ON a.user_id = agent_member.user_id
    JOIN users u ON u.id = a.user_id
    WHERE current_member.conversation_id = ?
      AND current_member.user_id = ?
      AND a.status = 'active'
      AND u.status = 'active'
    LIMIT 1
  `).get(conversationId, userId);
  return row ? mapAgentRow(row) : null;
}

function ensureConversationLink(imConversationId, clawAgentId) {
  const existing = getDb().prepare("SELECT * FROM vibe_claw_conversation_links WHERE im_conversation_id = ?").get(imConversationId);
  if (existing) return existing;
  const createdAt = now();
  const row = {
    id: id(),
    im_conversation_id: imConversationId,
    claw_agent_id: clawAgentId,
    claw_conversation_id: null,
    created_at: createdAt,
    updated_at: createdAt
  };
  getDb().prepare(`
    INSERT INTO vibe_claw_conversation_links (id, im_conversation_id, claw_agent_id, claw_conversation_id, created_at, updated_at)
    VALUES (@id, @im_conversation_id, @claw_agent_id, @claw_conversation_id, @created_at, @updated_at)
  `).run(row);
  return row;
}

function updateConversationLink(imConversationId, clawConversationId) {
  if (!clawConversationId) return;
  getDb().prepare(`
    UPDATE vibe_claw_conversation_links
    SET claw_conversation_id = ?, updated_at = ?
    WHERE im_conversation_id = ?
  `).run(clawConversationId, now(), imConversationId);
}

async function startAgentConversation(userId, clawAgentId) {
  let agent = getMappedAgent(clawAgentId);
  if (!agent) {
    await syncVibeClawAgents();
    agent = getMappedAgent(clawAgentId);
  }
  if (!agent || agent.status !== "active") throw new Error("Agent 不存在或未启用");
  const conversation = ensureDirectConversation(userId, agent.userId);
  ensureConversationLink(conversation.id, agent.agentId);
  const summary = listConversations(userId).find(item => item.id === conversation.id) || conversation;
  return { conversation: { ...summary, isAgent: true, agent } };
}

async function replyToVibeClawAgentIfNeeded({ userId, conversationId, text, userMessageId, transportKey }) {
  const agent = getAgentForConversation(userId, conversationId);
  if (!agent || !text?.trim()) return null;
  const link = ensureConversationLink(conversationId, agent.agentId);
  try {
    const payload = {
      message: text.trim(),
      compression: "hybrid",
      context: [{ source: "system", content: `im_conversation_id:${conversationId}`, priority: 30 }]
    };
    if (link.claw_conversation_id) payload.conversationId = link.claw_conversation_id;
    const body = await clawFetch(`/v1/agents/${encodeURIComponent(agent.agentId)}/messages`, {
      method: "POST",
      headers: { "Idempotency-Key": `vibe-im-${userMessageId}` },
      body: JSON.stringify(payload)
    });
    updateConversationLink(conversationId, body.conversation?.id);
    const replyText = body.message?.content || body.output || "Agent 未返回内容。";
    const replyRow = createMessage(agent.userId, conversationId, { type: "text", text: replyText });
    publishChatMessage(replyRow);
    return {
      message: serializeMessage(getMessage(replyRow.id), transportKey),
      clawConversationId: body.conversation?.id || null,
      runId: body.run?.id || null
    };
  } catch (error) {
    const code = error.code || "VIBE_CLAW_ERROR";
    const systemRow = createSystemMessage(conversationId, userId, `Agent 调用失败（${code}）：${error.message}`);
    publishChatMessage(systemRow);
    return { error: error.message, code, message: serializeMessage(getMessage(systemRow.id), transportKey) };
  }
}

module.exports = {
  config,
  publicConfig,
  saveConfig,
  diagnoseVibeClaw,
  syncVibeClawAgents,
  listMappedAgents,
  getMappedAgent,
  startAgentConversation,
  getAgentForConversation,
  replyToVibeClawAgentIfNeeded
};
