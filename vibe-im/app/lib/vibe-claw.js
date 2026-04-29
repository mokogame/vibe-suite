const crypto = require("node:crypto");
const { getDb, id, now, transaction, publicUser } = require("./db");
const { ensureDirectConversation, createMessage, createSystemMessage, getMessage, serializeMessage, listConversations, listMembers, getConversationForUser, listRecentPlainMessages } = require("./chat");
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
  const contract = parseAgentContract(row.contract_json, {
    role: row.role,
    mission: row.mission,
    style: row.style,
    outputContract: row.output_contract,
    boundaries: parseJsonArray(row.boundaries_json)
  });
  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    name: row.name,
    description: row.description || "",
    contract,
    role: contract.role || row.role || "",
    mission: contract.mission || row.mission || "",
    style: contract.style || row.style || "",
    outputContract: contract.outputContract || row.output_contract || "",
    boundaries: Array.isArray(contract.boundaries) ? contract.boundaries : [],
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

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseAgentContract(value, fallback = {}) {
  let parsed = {};
  if (value) {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }
  const contract = { ...fallback, ...parsed };
  return {
    role: String(contract.role || "").trim(),
    mission: String(contract.mission || "").trim(),
    boundaries: Array.isArray(contract.boundaries) ? contract.boundaries.map(item => String(item)).filter(Boolean) : [],
    style: String(contract.style || "").trim(),
    outputContract: String(contract.outputContract || "").trim(),
    toolPolicy: String(contract.toolPolicy || "").trim(),
    memoryPolicy: String(contract.memoryPolicy || "").trim(),
    handoffPolicy: String(contract.handoffPolicy || "").trim(),
    safetyPolicy: String(contract.safetyPolicy || "").trim(),
    version: String(contract.version || "").trim()
  };
}

function normalizeRemoteAgentContract(agent = {}) {
  return parseAgentContract(JSON.stringify(agent.contract || {}), {
    role: agent.contract?.role || agent.name || "",
    mission: agent.contract?.mission || agent.description || agent.instruction || "",
    style: agent.contract?.style || "",
    outputContract: agent.contract?.outputContract || "",
    boundaries: agent.contract?.boundaries || []
  });
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
      const contract = normalizeRemoteAgentContract(agent);
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
        INSERT INTO vibe_claw_agents (id, agent_id, user_id, name, description, contract_json, role, mission, style, output_contract, boundaries_json, default_model, provider_id, status, created_at, updated_at, last_synced_at, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (agent_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          contract_json = EXCLUDED.contract_json,
          role = EXCLUDED.role,
          mission = EXCLUDED.mission,
          style = EXCLUDED.style,
          output_contract = EXCLUDED.output_contract,
          boundaries_json = EXCLUDED.boundaries_json,
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
        agent.description || contract.mission || agent.instruction || "",
        JSON.stringify(contract),
        contract.role || "",
        contract.mission || "",
        contract.style || "",
        contract.outputContract || "",
        JSON.stringify(contract.boundaries || []),
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

function extractMentionUsernames(text) {
  return Array.from(new Set(String(text || "").match(/@([a-zA-Z0-9_]+)/g)?.map(value => value.slice(1).toLowerCase()) || []));
}

function stripInternalContextLeak(text) {
  const lines = String(text || "").split(/\r?\n/);
  let index = 0;
  let stripped = false;
  const internalMeta = /^\[(system|developer|memory|history|summary|external|attachment|tool|user);[^\]]+\]\s*$/i;
  const internalContent = /^(历史消息|长期记忆|滚动摘要|上下文摘要|内部历史消息|内部长期记忆|内部滚动摘要|调用方提供的内部上下文)[（(]/;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (internalMeta.test(line) || /^reason\s*[:：]/i.test(line) || internalContent.test(line)) {
      stripped = true;
      index += 1;
      continue;
    }
    break;
  }
  return stripped ? lines.slice(index).join("\n").trimStart() : String(text || "");
}

function normalizedMentionItems(mentions = []) {
  return (Array.isArray(mentions) ? mentions : []).map(mention => ({
    userId: String(mention.userId || mention.id || "").trim(),
    agentId: String(mention.agentId || "").trim(),
    username: String(mention.username || "").trim().toLowerCase(),
    type: String(mention.type || mention.role || "").trim().toLowerCase()
  })).filter(mention => mention.userId || mention.agentId || mention.username);
}

function getMentionedGroupAgents(conversationId, text, mentions = []) {
  const structured = normalizedMentionItems(mentions).filter(mention => mention.type === "agent" || mention.agentId);
  if (structured.length) {
    const userIds = structured.map(mention => mention.userId).filter(Boolean);
    const agentIds = structured.map(mention => mention.agentId).filter(Boolean);
    const usernames = structured.map(mention => mention.username).filter(Boolean);
    const conditions = [];
    const params = [conversationId];
    if (userIds.length) {
      conditions.push(`u.id IN (${userIds.map(() => "?").join(", ")})`);
      params.push(...userIds);
    }
    if (agentIds.length) {
      conditions.push(`a.agent_id IN (${agentIds.map(() => "?").join(", ")})`);
      params.push(...agentIds);
    }
    if (usernames.length) {
      conditions.push(`LOWER(u.username) IN (${usernames.map(() => "?").join(", ")})`);
      params.push(...usernames);
    }
    return getDb().prepare(`
      SELECT a.*, u.username, u.display_name, u.avatar_url, u.role, u.status AS user_status
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      JOIN vibe_claw_agents a ON a.user_id = u.id
      WHERE cm.conversation_id = ?
        AND (${conditions.join(" OR ")})
        AND u.role = 'agent'
        AND u.status = 'active'
        AND a.status = 'active'
    `).all(...params).map(mapAgentRow);
  }
  const usernames = extractMentionUsernames(text);
  if (!usernames.length) return [];
  const placeholders = usernames.map(() => "?").join(", ");
  return getDb().prepare(`
    SELECT a.*, u.username, u.display_name, u.avatar_url, u.role, u.status AS user_status
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    JOIN vibe_claw_agents a ON a.user_id = u.id
    WHERE cm.conversation_id = ?
      AND LOWER(u.username) IN (${placeholders})
      AND u.role = 'agent'
      AND u.status = 'active'
      AND a.status = 'active'
  `).all(conversationId, ...usernames).map(mapAgentRow);
}

function getMentionedUsersInConversation(conversationId, text, mentions = []) {
  const structured = normalizedMentionItems(mentions);
  if (structured.length) {
    const userIds = structured.map(mention => mention.userId).filter(Boolean);
    const usernames = structured.map(mention => mention.username).filter(Boolean);
    const conditions = [];
    const params = [conversationId];
    if (userIds.length) {
      conditions.push(`u.id IN (${userIds.map(() => "?").join(", ")})`);
      params.push(...userIds);
    }
    if (usernames.length) {
      conditions.push(`LOWER(u.username) IN (${usernames.map(() => "?").join(", ")})`);
      params.push(...usernames);
    }
    return getDb().prepare(`
      SELECT u.*
      FROM conversation_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.conversation_id = ?
        AND (${conditions.join(" OR ")})
      ORDER BY u.role DESC, u.display_name ASC
    `).all(...params).map(publicUser);
  }
  const usernames = extractMentionUsernames(text);
  if (!usernames.length) return [];
  const placeholders = usernames.map(() => "?").join(", ");
  return getDb().prepare(`
    SELECT u.*
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ?
      AND LOWER(u.username) IN (${placeholders})
    ORDER BY u.role DESC, u.display_name ASC
  `).all(conversationId, ...usernames).map(publicUser);
}

function ensureConversationLink(imConversationId, clawAgentId) {
  const existing = getDb().prepare("SELECT * FROM vibe_claw_conversation_links WHERE im_conversation_id = ? AND claw_agent_id = ?").get(imConversationId, clawAgentId);
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

function updateAgentConversationLink(imConversationId, clawAgentId, clawConversationId) {
  if (!clawConversationId) return;
  getDb().prepare(`
    UPDATE vibe_claw_conversation_links
    SET claw_conversation_id = ?, updated_at = ?
    WHERE im_conversation_id = ? AND claw_agent_id = ?
  `).run(clawConversationId, now(), imConversationId, clawAgentId);
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

function buildImContext({ userId, conversation, conversationId, text, mentions, userMessageId, agent, transportKey }) {
  const members = conversation.type === "group" ? listMembers(userId, conversationId) : [];
  const mentionedUsers = conversation.type === "group" ? getMentionedUsersInConversation(conversationId, text, mentions) : [];
  const recentMessages = listRecentPlainMessages(userId, conversationId, 18).map(message => ({
    seq: message.seq,
    sender: message.sender.displayName || message.sender.username,
    username: message.sender.username,
    role: message.sender.role,
    text: String(message.text || "").slice(0, 500),
    createdAt: message.createdAt
  }));
  const context = [
    {
      source: "system",
      content: `client:vibe-im; surface:${conversation.type === "group" ? "group_chat" : "direct_chat"}`,
      priority: 30,
      sensitive: false
    },
    {
      source: "system",
      content: `im_conversation_id:${conversationId}; im_message_id:${userMessageId}; target_agent:${agent.agentId}`,
      priority: 20,
      sensitive: true
    }
  ];
  if (conversation.type === "group") {
    context.push({
      source: "system",
      content: JSON.stringify({
        type: "group_context",
        group: { id: conversationId, title: conversation.title || conversation.name || "群聊" },
        targetAgent: { id: agent.agentId, name: agent.name, username: agent.user?.username },
        trigger: { mode: normalizedMentionItems(mentions).length ? "structured_mentions" : "text_fallback" },
        mentionedUsers: mentionedUsers.map(user => ({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role
        })),
        members: members.map(member => ({
          id: member.id,
          username: member.username,
          displayName: member.displayName,
          role: member.role,
          memberRole: member.memberRole
        }))
      }),
      priority: 28,
      sensitive: true
    });
    context.push({
      source: "user",
      content: JSON.stringify({
        type: "recent_group_messages",
        window: recentMessages
      }),
      priority: 25,
      sensitive: true
    });
  }
  return context;
}

async function sendAgentReply({ userId, conversation, conversationId, text, mentions, userMessageId, transportKey, agent }) {
  const link = ensureConversationLink(conversationId, agent.agentId);
  try {
    const payload = {
      message: text.trim(),
      compression: "hybrid",
      context: buildImContext({ userId, conversation, conversationId, text, mentions, userMessageId, agent, transportKey })
    };
    if (link.claw_conversation_id) payload.conversationId = link.claw_conversation_id;
    const body = await clawFetch(`/v1/agents/${encodeURIComponent(agent.agentId)}/messages`, {
      method: "POST",
      headers: { "Idempotency-Key": `vibe-im-${userMessageId}-${agent.agentId}` },
      body: JSON.stringify(payload)
    });
    updateAgentConversationLink(conversationId, agent.agentId, body.conversation?.id);
    const replyText = stripInternalContextLeak(body.message?.content || body.output || "Agent 未返回内容。");
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

async function replyToVibeClawAgentIfNeeded({ userId, conversationId, text, mentions = [], userMessageId, transportKey }) {
  if (!text?.trim()) return null;
  const conversation = getConversationForUser(userId, conversationId);
  if (!conversation) return null;

  const agents = conversation.type === "group"
    ? getMentionedGroupAgents(conversationId, text, mentions)
    : [getAgentForConversation(userId, conversationId)].filter(Boolean);

  if (!agents.length) return null;
  const results = [];
  for (const agent of agents) {
    results.push(await sendAgentReply({ userId, conversation, conversationId, text, mentions, userMessageId, transportKey, agent }));
  }
  return results.length === 1 ? results[0] : results;
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
