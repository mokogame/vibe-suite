import { estimateTokens } from "../model/providers.js";
import type { CompressionStrategy, ContextItem } from "../types.js";

export type CompressionResult = {
  context: ContextItem[];
  originalTokens: number;
  compressedTokens: number;
  kept: string[];
  summarized: string[];
  dropped: string[];
};

export function compressContext(context: ContextItem[], strategy: CompressionStrategy, budgetTokens: number): CompressionResult {
  const originalTokens = estimateTokens(context.map((item) => item.content).join("\n"));
  if (strategy === "none") {
    return result(context, originalTokens, context.map(label), [], []);
  }
  const sorted = [...context].sort((a, b) => b.priority - a.priority);
  const kept: ContextItem[] = [];
  const dropped: ContextItem[] = [];
  let used = 0;
  for (const item of sorted) {
    const cost = estimateTokens(item.content);
    if (used + cost <= budgetTokens) {
      kept.push(item);
      used += cost;
    } else {
      dropped.push(item);
    }
  }
  const summarized = strategy === "rolling_summary" || strategy === "hybrid" ? dropped.slice(0, 3).map(label) : [];
  const summaryItems: ContextItem[] = summarized.length > 0 ? [{ source: "system", content: `上下文摘要：${summarized.join("；")}`, priority: 75 }] : [];
  return result([...kept, ...summaryItems].sort((a, b) => a.priority - b.priority), originalTokens, kept.map(label), summarized, dropped.map(label));
}

function result(context: ContextItem[], originalTokens: number, kept: string[], summarized: string[], dropped: string[]): CompressionResult {
  return { context, originalTokens, compressedTokens: estimateTokens(context.map((item) => item.content).join("\n")), kept, summarized, dropped };
}

function label(item: ContextItem): string {
  return `${item.source}:${item.content.slice(0, 80)}`;
}
