import type { ContextItem, ModelCallInput, ModelCallOutput, PromptMessage } from "../types.js";

export interface ModelProvider {
  readonly name: string;
  call(input: ModelCallInput): Promise<ModelCallOutput>;
}

export class ProviderError extends Error {
  constructor(
    readonly type: "timeout" | "rate_limited" | "upstream_error" | "invalid_response",
    message: string
  ) {
    super(message);
  }
}

export class MockModelProvider implements ModelProvider {
  readonly name = "mock";

  async call(input: ModelCallInput): Promise<ModelCallOutput> {
    const compiled = input.messages?.map((message) => `[${message.role}] ${message.content}`).join(" | ");
    const contextText = compiled ? `\n上下文：${compiled}` : input.context.length > 0 ? `\n上下文：${formatContext(input.context)}` : "";
    const text = `${input.agent.name}：${input.agent.instruction}\n收到：${input.input}${contextText}`;
    const inputTokens = estimateTokens(`${input.agent.instruction}\n${input.input}\n${formatContext(input.context)}`);
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
    private readonly defaultModel: string,
    private readonly maxRetries = 2
  ) {
    this.name = name;
  }

  async call(input: ModelCallInput): Promise<ModelCallOutput> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.callOnce(input);
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === this.maxRetries) break;
        await sleep(200 * (attempt + 1));
      }
    }
    throw lastError;
  }

  private async callOnce(input: ModelCallInput): Promise<ModelCallOutput> {
    const model = input.agent.defaultModel === "mock" ? this.defaultModel : input.agent.defaultModel;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: normalizeProviderMessages(input.messages ?? fallbackMessages(input)),
          temperature: 0.2
        })
      });

      const body = (await response.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        error?: { message?: string; type?: string };
      };

      if (!response.ok) {
        if (response.status === 429) throw new ProviderError("rate_limited", body.error?.message ?? "模型供应商限流");
        throw new ProviderError("upstream_error", body.error?.message ?? `模型供应商返回 ${response.status}`);
      }

      const text = body.choices?.[0]?.message?.content ?? "";
      if (!text) throw new ProviderError("invalid_response", "模型供应商响应缺少文本内容");
      const inputTokens = body.usage?.prompt_tokens ?? estimateTokens(`${input.input}\n${formatContext(input.context)}`);
      const outputTokens = body.usage?.completion_tokens ?? estimateTokens(text);
      return {
        text,
        inputTokens,
        outputTokens,
        totalTokens: body.usage?.total_tokens ?? inputTokens + outputTokens,
        provider: this.name,
        model
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ProviderError("timeout", "模型调用超时");
      }
      throw new ProviderError("upstream_error", error instanceof Error ? error.message : "模型调用失败");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createDefaultProvider(): ModelProvider {
  const apiKey = process.env.VIBE_CLAW_OPENAI_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return new MockModelProvider();

  const baseUrl = process.env.VIBE_CLAW_OPENAI_BASE_URL ?? "https://api.deepseek.com/v1";
  const model = process.env.VIBE_CLAW_MODEL ?? "deepseek-chat";
  const retries = Number(process.env.VIBE_CLAW_PROVIDER_RETRIES ?? 2);
  return new OpenAiCompatibleProvider("openai-compatible", baseUrl, apiKey, model, retries);
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function formatContext(context: ContextItem[]): string {
  return context.map(renderContextItem).join(" | ");
}

function renderContextItem(item: ContextItem): string {
  const content = item.sensitive ? "[已脱敏敏感上下文]" : item.content;
  return `[${item.source}; priority=${item.priority}] ${content}`;
}

function fallbackMessages(input: ModelCallInput): PromptMessage[] {
  return [
    { role: "system", content: input.agent.instruction },
    ...input.context.map((item) => ({ role: item.source === "agent" ? "assistant" as const : "user" as const, content: renderContextItem(item) })),
    { role: "user", content: input.input }
  ];
}

function normalizeProviderMessages(messages: PromptMessage[]): Array<{ role: "system" | "user" | "assistant"; content: string; name?: string }> {
  return messages.map((message) => {
    if (message.role === "developer") return { role: "system", content: `[developer]\n${message.content}`, name: message.name };
    if (message.role === "tool") return { role: "user", content: `[tool]\n${message.content}`, name: message.name };
    return { role: message.role, content: message.content, name: message.name };
  });
}

function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError && ["timeout", "rate_limited", "upstream_error"].includes(error.type);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import type { ModelProviderConfig } from "../types.js";

export function createProviderFromConfig(config: ModelProviderConfig): ModelProvider {
  if (config.status !== "active") throw new ProviderError("upstream_error", "Provider 已禁用");
  if (config.type === "mock") return new MockModelProvider();
  if (config.type === "openai-compatible") {
    const keyName = config.apiKeyRef;
    const apiKey = keyName ? resolveSecretRef(keyName) : undefined;
    if (!apiKey) throw new ProviderError("upstream_error", `Provider 缺少 API key 环境变量：${keyName ?? "未配置"}`);
    if (!config.baseUrl) throw new ProviderError("upstream_error", "Provider 缺少 baseUrl");
    return new OpenAiCompatibleProvider(config.name, config.baseUrl, apiKey, config.defaultModel, config.maxRetries);
  }
  throw new ProviderError("upstream_error", "不支持的 Provider 类型");
}

export function resolveSecretRef(ref: string): string | undefined {
  if (ref.startsWith("env:")) return process.env[ref.slice("env:".length)];
  if (ref.startsWith("secret://env/")) return process.env[ref.slice("secret://env/".length)];
  if (ref.startsWith("vault://") || ref.startsWith("kms://")) {
    const envName = ref.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
    return process.env[envName];
  }
  if (/^(sk-|vcl_|dsk_)/.test(ref)) return ref;
  return process.env[ref];
}
