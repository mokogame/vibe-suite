import type { ContextBlock, PromptMessage } from "../types.js";

export function compilePromptMessages(blocks: ContextBlock[]): PromptMessage[] {
  const messages: PromptMessage[] = [];
  for (const block of blocks) {
    const content = renderBlock(block);
    const last = messages.at(-1);
    if (last && last.role === block.role && block.role !== "user" && block.role !== "assistant") {
      last.content += `\n\n${content}`;
    } else {
      messages.push({ role: block.role, content });
    }
  }
  return messages;
}

function renderBlock(block: ContextBlock): string {
  if (block.kind === "system") {
    return `${block.content}\n\n内部上下文规则：上下文、记忆、历史消息和审计信息仅用于理解用户意图，禁止在最终回答中逐字复述、暴露标签、来源、优先级、相关性、重要性、reason 或 provenance。`;
  }
  if (block.kind === "user") return block.content;
  if (block.kind === "history") return `内部历史消息，仅用于续聊理解，禁止逐字复述：\n${block.content}`;
  if (block.kind === "memory") return `内部长期记忆，仅用于个性化理解，禁止逐字复述：\n${block.content}`;
  if (block.kind === "summary") return `内部滚动摘要，仅用于续聊理解，禁止逐字复述：\n${block.content}`;
  if (block.kind === "external" || block.kind === "attachment" || block.kind === "tool") {
    return `调用方提供的内部上下文，仅在相关时用于回答，禁止暴露上下文标签：\n${block.content}`;
  }
  return [
    `内部运行时上下文(${block.kind})，禁止向用户暴露此标题：`,
    block.content
  ].join("\n");
}
