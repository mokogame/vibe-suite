import { compileAgentContract } from "./agent-contract.js";
import { estimateTokens } from "../model/providers.js";
import type { Agent, AgentMemory, AgentMessage, CompressionStrategy, ContextBlock, ContextBuildAudit, ContextItem } from "../types.js";

export type BuildContextInput = {
  agent: Agent;
  currentMessage: string;
  historyMessages: AgentMessage[];
  memories: AgentMemory[];
  externalContext?: ContextItem[];
  strategy?: CompressionStrategy;
  budgetTokens?: number;
};

export type BuildContextResult = {
  blocks: ContextBlock[];
  audit: ContextBuildAudit;
  legacyContext: ContextItem[];
};

const DEFAULT_BUDGET = 6000;
const RECENT_HISTORY_COUNT = 12;
const MEMORY_LIMIT = 8;

export function buildAgentContext(input: BuildContextInput): BuildContextResult {
  const budgetTokens = input.budgetTokens ?? DEFAULT_BUDGET;
  const strategy = input.strategy ?? "hybrid";
  const blocks = [
    systemBlock(),
    agentContractBlock(input.agent),
    ...memoryBlocks(input.memories, input.currentMessage),
    ...historyBlocks(input.historyMessages),
    ...summaryBlocks(input.historyMessages),
    ...externalBlocks(input.externalContext ?? []),
    userBlock(input.currentMessage)
  ];

  const originalTokens = blocks.reduce((sum, block) => sum + block.tokenCost, 0);
  const selected = selectBlocks(blocks, strategy, budgetTokens);
  const compressedTokens = selected.kept.reduce((sum, block) => sum + block.tokenCost, 0);
  const reasons = Object.fromEntries(selected.kept.map((block) => [block.id, block.reason]));

  return {
    blocks: selected.kept,
    audit: {
      strategy,
      budgetTokens,
      originalTokens,
      compressedTokens,
      kept: selected.kept.map(labelBlock),
      summarized: selected.summarized.map(labelBlock),
      dropped: selected.dropped.map(labelBlock),
      reasons
    },
    legacyContext: selected.kept
      .filter((block) => block.kind !== "user")
      .map((block) => ({
        source: block.kind === "memory" ? "memory" : block.kind === "tool" ? "tool" : block.role === "assistant" ? "agent" : block.role === "system" || block.role === "developer" ? "system" : "user",
        content: block.content,
        priority: block.priority,
        sensitive: block.sensitive
      }))
  };
}

function systemBlock(): ContextBlock {
  return makeBlock({
    id: "system:platform",
    kind: "system",
    role: "system",
    source: "platform",
    content: "你运行在 Vibe Claw Agent Runtime 中。必须遵守租户隔离、工具权限、记忆治理和输出契约。不要泄露未授权上下文。",
    priority: 100,
    recency: 1,
    relevance: 1,
    importance: 1,
    confidence: 1,
    provenance: "runtime",
    reason: "平台安全和运行时边界必须始终保留。",
    required: true
  });
}

function agentContractBlock(agent: Agent): ContextBlock {
  return makeBlock({
    id: `developer:agent-contract:${agent.id}`,
    kind: "developer",
    role: "developer",
    source: "agent_contract",
    content: compileAgentContract(agent),
    priority: 98,
    recency: 1,
    relevance: 1,
    importance: 1,
    confidence: 1,
    provenance: `agent:${agent.id}:contract:${agent.contract.version}`,
    reason: "Agent 职责契约必须始终参与模型调用。",
    required: true
  });
}

function memoryBlocks(memories: AgentMemory[], query: string): ContextBlock[] {
  const now = Date.now();
  return memories
    .filter((memory) => memory.status === "active")
    .filter((memory) => !memory.expiresAt || new Date(memory.expiresAt).getTime() > now)
    .map((memory) => {
      const relevance = keywordRelevance(`${memory.summary}\n${memory.content}\n${memory.tags.join(" ")}`, query);
      const recency = recencyScore(memory.lastAccessedAt ?? memory.updatedAt ?? memory.createdAt);
      const importance = clamp(memory.importance);
      const confidence = clamp(memory.confidence);
      const score = 0.45 * relevance + 0.3 * importance + 0.15 * recency + 0.1 * confidence;
      return makeBlock({
        id: `memory:${memory.id}`,
        kind: "memory",
        role: "user",
        source: "memory",
        content: `长期记忆(${memory.type})：${memory.summary}\n${memory.content}`,
        priority: Math.round(60 + score * 35),
        recency,
        relevance,
        importance,
        confidence,
        provenance: memory.provenance || memory.source || memory.id,
        reason: `按相关性 ${relevance.toFixed(2)}、重要性 ${importance.toFixed(2)}、时间 ${recency.toFixed(2)}、可信度 ${confidence.toFixed(2)} 召回。`
      });
    })
    .sort((a, b) => blockScore(b) - blockScore(a))
    .slice(0, MEMORY_LIMIT);
}

function historyBlocks(messages: AgentMessage[]): ContextBlock[] {
  const recent = messages.slice(-RECENT_HISTORY_COUNT);
  return recent.map((message, index) => makeBlock({
    id: `history:${message.id}`,
    kind: "history",
    role: message.role === "agent" ? "assistant" : "user",
    source: "conversation_history",
    content: `历史消息(${message.role})：${message.content}`,
    priority: 70 + index,
    recency: (index + 1) / Math.max(recent.length, 1),
    relevance: 0.72,
    importance: 0.65,
    confidence: 1,
    provenance: `conversation:${message.conversationId}:message:${message.id}`,
    reason: "最近对话窗口优先保留，保证续聊上下文。"
  }));
}

function summaryBlocks(messages: AgentMessage[]): ContextBlock[] {
  const older = messages.slice(0, Math.max(0, messages.length - RECENT_HISTORY_COUNT));
  if (!older.length) return [];
  const facts = older.slice(-8).map((message) => `${message.role}: ${message.content.slice(0, 140)}`).join("\n");
  return [makeBlock({
    id: "summary:rolling",
    kind: "summary",
    role: "developer",
    source: "conversation_summary",
    content: `滚动摘要：以下为较早历史的稳定摘要，用于保持长期对话连续性。\n${facts}`,
    priority: 76,
    recency: 0.45,
    relevance: 0.7,
    importance: 0.72,
    confidence: 0.7,
    provenance: "conversation:rolling-summary:v1",
    reason: "较早历史转为摘要，避免长对话无限增长。"
  })];
}

function externalBlocks(context: ContextItem[]): ContextBlock[] {
  return context.map((item, index) => {
    const source = item.source ?? "user";
    const kind = source === "tool" ? "tool" : source === "memory" ? "memory" : source === "system" ? "external" : "attachment";
    return makeBlock({
      id: `external:${index}:${source}`,
      kind,
      role: source === "agent" ? "assistant" : source === "tool" ? "tool" : source === "system" ? "developer" : "user",
      source,
      content: item.content,
      priority: item.priority ?? 50,
      recency: 1,
      relevance: 0.68,
      importance: (item.priority ?? 50) / 100,
      confidence: 0.85,
      sensitive: item.sensitive ?? false,
      provenance: `request.context.${index}`,
      reason: item.sensitive ? "外部敏感上下文仅以脱敏形式参与。" : "调用方显式传入的外部上下文。"
    });
  });
}

function userBlock(message: string): ContextBlock {
  return makeBlock({
    id: "user:current",
    kind: "user",
    role: "user",
    source: "current_user_message",
    content: message,
    priority: 100,
    recency: 1,
    relevance: 1,
    importance: 1,
    confidence: 1,
    provenance: "request.message",
    reason: "当前用户消息必须始终保留。",
    required: true
  });
}

function selectBlocks(blocks: ContextBlock[], strategy: CompressionStrategy, budgetTokens: number) {
  if (strategy === "none") return { kept: blocks, summarized: [], dropped: [] };
  const required = blocks.filter((block) => block.required);
  const optional = blocks.filter((block) => !block.required);
  const ordered = strategy === "recent_only"
    ? optional.sort((a, b) => b.recency - a.recency || b.priority - a.priority)
    : optional.sort((a, b) => blockScore(b) - blockScore(a));
  const kept = [...required];
  const dropped: ContextBlock[] = [];
  let used = kept.reduce((sum, block) => sum + block.tokenCost, 0);
  for (const block of ordered) {
    if (used + block.tokenCost <= budgetTokens) {
      kept.push(block);
      used += block.tokenCost;
    } else {
      dropped.push(block);
    }
  }
  const summarized = dropped.filter((block) => block.kind === "history" || block.kind === "memory").slice(0, 5);
  return { kept: kept.sort((a, b) => a.priority - b.priority), summarized, dropped };
}

function makeBlock(input: Omit<ContextBlock, "tokenCost" | "sensitive"> & { sensitive?: boolean }): ContextBlock {
  const sensitive = input.sensitive ?? false;
  const content = sensitive ? "[已脱敏敏感上下文]" : input.content;
  return {
    ...input,
    content,
    sensitive,
    tokenCost: estimateTokens(content)
  };
}

function blockScore(block: ContextBlock): number {
  return block.priority + block.relevance * 20 + block.importance * 18 + block.recency * 8 + block.confidence * 4;
}

function labelBlock(block: ContextBlock): string {
  return `${block.kind}:${block.id}:${block.reason}`;
}

function keywordRelevance(text: string, query: string): number {
  const haystack = tokenize(text);
  const needles = tokenize(query);
  if (!needles.size || !haystack.size) return 0.35;
  let hits = 0;
  for (const word of needles) if (haystack.has(word)) hits += 1;
  return clamp(hits / needles.size);
}

function tokenize(text: string): Set<string> {
  return new Set(String(text).toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((word) => word.length >= 2));
}

function recencyScore(value: string): number {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return 0.4;
  const ageDays = Math.max(0, (Date.now() - ts) / 86_400_000);
  return clamp(1 / (1 + ageDays / 30));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
