import type { Agent, AgentContract } from "../types.js";

export function defaultAgentContract(input: {
  name: string;
  description?: string;
  instruction: string;
  contract?: Partial<AgentContract> | null;
}): AgentContract {
  const base: AgentContract = baseAgentContract(input.name, input.description || input.instruction);
  return normalizeAgentContract({ ...base, ...(input.contract ?? {}) }, base);
}

export function normalizeAgentContract(contract: Partial<AgentContract> | null | undefined, fallback = baseAgentContract("Agent", "Assist the user.")): AgentContract {
  const next = { ...fallback, ...(contract ?? {}) };
  return {
    role: cleanText(next.role, fallback.role),
    mission: cleanText(next.mission, fallback.mission),
    boundaries: cleanStringList(next.boundaries),
    style: cleanText(next.style, fallback.style),
    outputContract: cleanText(next.outputContract, fallback.outputContract),
    toolPolicy: cleanText(next.toolPolicy, fallback.toolPolicy),
    memoryPolicy: cleanText(next.memoryPolicy, fallback.memoryPolicy),
    handoffPolicy: cleanText(next.handoffPolicy, fallback.handoffPolicy),
    safetyPolicy: cleanText(next.safetyPolicy, fallback.safetyPolicy),
    version: cleanText(next.version, fallback.version)
  };
}

function baseAgentContract(name: string, mission: string): AgentContract {
  return {
    role: name,
    mission,
    boundaries: [],
    style: "清晰、结构化、可执行。",
    outputContract: "按用户请求输出；需要时给出步骤、假设和下一步。",
    toolPolicy: "仅使用 Runtime 显式授权的工具；不得自行扩大权限。",
    memoryPolicy: "只在有明确价值、可追溯且不违反隐私边界时写入长期记忆。",
    handoffPolicy: "当任务超出职责、权限或能力边界时说明原因并请求人工或其他 Agent 介入。",
    safetyPolicy: "遵守平台安全边界，不泄露敏感上下文，不跨租户访问数据。",
    version: "1"
  };
}

export function compileAgentContract(agent: Agent): string {
  const contract = defaultAgentContract({
    name: agent.name,
    description: agent.description,
    instruction: agent.instruction,
    contract: agent.contract
  });
  const boundaries = contract.boundaries.length ? contract.boundaries.map((item) => `- ${item}`).join("\n") : "- 未配置额外边界。";
  return [
    `Agent Contract v${contract.version}`,
    `角色：${contract.role}`,
    `任务目标：${contract.mission}`,
    `原始指令：${agent.instruction}`,
    `行为边界：\n${boundaries}`,
    `表达风格：${contract.style}`,
    `输出契约：${contract.outputContract}`,
    `工具策略：${contract.toolPolicy}`,
    `记忆策略：${contract.memoryPolicy}`,
    `交接策略：${contract.handoffPolicy}`,
    `安全策略：${contract.safetyPolicy}`
  ].join("\n");
}

function cleanText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function cleanStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 20);
  }
  if (typeof value === "string") {
    return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
  }
  return [];
}
