import type { ModelCallInput, ModelCallOutput } from "../types.js";

export interface ModelProvider {
  readonly name: string;
  call(input: ModelCallInput): Promise<ModelCallOutput>;
}

export class MockModelProvider implements ModelProvider {
  readonly name = "mock";

  async call(input: ModelCallInput): Promise<ModelCallOutput> {
    const contextText = input.context.length > 0 ? `\n上下文：${input.context.join(" | ")}` : "";
    const text = `${input.agent.name}：${input.agent.instruction}\n收到：${input.input}${contextText}`;
    const inputTokens = estimateTokens(`${input.agent.instruction}\n${input.input}\n${input.context.join("\n")}`);
    const outputTokens = estimateTokens(text);
    return {
      text,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      provider: this.name,
      model: input.agent.defaultModel
    };
  }
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly name: string;

  constructor(
    name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly defaultModel: string
  ) {
    this.name = name;
  }

  async call(input: ModelCallInput): Promise<ModelCallOutput> {
    const model = input.agent.defaultModel === "mock" ? this.defaultModel : input.agent.defaultModel;
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.agent.instruction },
          ...input.context.map((content) => ({ role: "system", content })),
          { role: "user", content: input.input }
        ],
        temperature: 0.2
      })
    });

    const body = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      error?: { message?: string; type?: string };
    };

    if (!response.ok) {
      throw new Error(body.error?.message ?? `Model provider failed with ${response.status}`);
    }

    const text = body.choices?.[0]?.message?.content ?? "";
    const inputTokens = body.usage?.prompt_tokens ?? estimateTokens(input.input);
    const outputTokens = body.usage?.completion_tokens ?? estimateTokens(text);
    return {
      text,
      inputTokens,
      outputTokens,
      totalTokens: body.usage?.total_tokens ?? inputTokens + outputTokens,
      provider: this.name,
      model
    };
  }
}

export function createDefaultProvider(): ModelProvider {
  const apiKey = process.env.VIBE_CLAW_OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return new MockModelProvider();

  const baseUrl = process.env.VIBE_CLAW_OPENAI_BASE_URL ?? "https://api.deepseek.com/v1";
  const model = process.env.VIBE_CLAW_MODEL ?? "deepseek-chat";
  return new OpenAiCompatibleProvider("openai-compatible", baseUrl, apiKey, model);
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}
