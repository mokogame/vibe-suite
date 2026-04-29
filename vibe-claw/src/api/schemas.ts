import { z } from "zod";

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  instruction: z.string().trim().min(1).max(4000),
  contract: z.object({
    role: z.string().trim().min(1).max(200).optional(),
    mission: z.string().trim().min(1).max(2000).optional(),
    boundaries: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    style: z.string().trim().min(1).max(1000).optional(),
    outputContract: z.string().trim().min(1).max(2000).optional(),
    toolPolicy: z.string().trim().min(1).max(2000).optional(),
    memoryPolicy: z.string().trim().min(1).max(2000).optional(),
    handoffPolicy: z.string().trim().min(1).max(2000).optional(),
    safetyPolicy: z.string().trim().min(1).max(2000).optional(),
    version: z.string().trim().min(1).max(40).optional()
  }).optional(),
  defaultModel: z.string().trim().min(1).max(120).optional(),
  providerId: z.string().trim().min(1).nullable().optional()
});

export const updateAgentSchema = createAgentSchema.partial().extend({
  status: z.enum(["active", "disabled", "archived"]).optional()
}).refine((value) => Object.keys(value).length > 0, "至少提供一个更新字段");

const contextItemSchema = z.object({
  source: z.enum(["user", "system", "agent", "memory", "tool"]).optional(),
  content: z.string().trim().min(1).max(20000),
  priority: z.number().int().min(0).max(100).optional(),
  sensitive: z.boolean().optional()
});

export const createRunSchema = z.object({
  agentIds: z.array(z.string().trim().min(1)).min(1).max(10),
  input: z.string().trim().min(1).max(20000),
  context: z.array(z.union([z.string().trim().min(1).max(20000), contextItemSchema])).max(20).optional(),
  toolCalls: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    input: z.record(z.unknown()).optional()
  })).max(10).optional(),
  callbackUrl: z.string().trim().url().max(1000).optional(),
  callbackSecret: z.string().trim().min(8).max(200).optional(),
  mode: z.enum(["single", "sequential"]).optional(),
  providerId: z.string().trim().min(1).optional()
}).superRefine((value, ctx) => {
  if (value.mode === "single" && value.agentIds.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agentIds"],
      message: "single 模式只能指定一个 Agent"
    });
  }
});


const providerBaseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(["mock", "openai-compatible"]),
  baseUrl: z.string().trim().url().max(1000).nullable().optional(),
  defaultModel: z.string().trim().min(1).max(120),
  apiKeyRef: z.string().trim().min(1).max(200).nullable().optional(),
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
  maxRetries: z.number().int().min(0).max(10).optional()
});

export const createProviderSchema = providerBaseSchema.superRefine((value, ctx) => {
  if (value.type === "openai-compatible" && !value.baseUrl) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["baseUrl"], message: "openai-compatible provider 必须配置 baseUrl" });
  }
});

export const updateProviderSchema = providerBaseSchema.partial().extend({
  status: z.enum(["active", "disabled"]).optional()
}).refine((value) => Object.keys(value).length > 0, "至少提供一个更新字段");


export const createMemorySchema = z.object({
  type: z.enum(["profile", "semantic", "episodic", "working"]),
  scope: z.enum(["agent", "conversation", "tenant", "lease"]).default("agent"),
  summary: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(20000),
  source: z.string().trim().min(1).max(120).default("api"),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  provenance: z.string().trim().min(1).max(500).optional(),
  expiresAt: z.string().trim().datetime().nullable().optional()
});

export const createLeaseSchema = z.object({
  expiresAt: z.string().trim().datetime(),
  maxCalls: z.number().int().min(1).max(100000),
  tokenBudget: z.number().int().min(1).max(10000000),
  allowedProtocols: z.array(z.string().trim().min(1).max(120)).max(50).default([])
});

export const createMessageSchema = z.object({
  conversationId: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).max(20000),
  context: z.array(z.union([z.string().trim().min(1).max(20000), contextItemSchema])).max(20).optional(),
  compression: z.enum(["none", "recent_only", "rolling_summary", "semantic_recall", "hybrid", "protocol_minimal"]).default("hybrid"),
  leaseId: z.string().trim().min(1).optional()
});

export const createProtocolSchema = z.object({
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(40),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown())
});

export const createProtocolRunSchema = z.object({
  conversationId: z.string().trim().min(1).optional(),
  protocol: z.string().trim().min(1).max(180),
  input: z.record(z.unknown()),
  context: z.array(z.union([z.string().trim().min(1).max(20000), contextItemSchema])).max(20).optional(),
  leaseId: z.string().trim().min(1).optional()
});

export const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.string().trim().min(1).max(80)).min(1).max(50).default(["*"]),
  tenantId: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().trim().min(1).max(120).optional(),
  expiresAt: z.string().trim().datetime().nullable().optional(),
  allowedIps: z.array(z.string().trim().min(1).max(80)).max(100).default([])
});

export const createWebhookSubscriptionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url().max(1000),
  secretRef: z.string().trim().min(1).max(200).nullable().optional(),
  eventTypes: z.array(z.string().trim().min(1).max(120)).min(1).max(50).default(["run.completed"])
});

export const updateWebhookSubscriptionSchema = createWebhookSubscriptionSchema.partial().extend({
  status: z.enum(["active", "disabled"]).optional()
}).refine((value) => Object.keys(value).length > 0, "至少提供一个更新字段");

export const replayWebhookSchema = z.object({
  secret: z.string().trim().min(1).max(200).optional()
});

export const updateStorageConfigSchema = z.object({
  storageMode: z.enum(["memory", "postgres"]),
  databaseUrl: z.string().trim().max(2000).optional()
});

export const resetDataSchema = z.object({
  confirm: z.literal("RESET_CURRENT_STORE")
});

export function parseBody<T>(schema: z.Schema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    throw new ValidationError(message);
  }
  return result.data;
}

export class ValidationError extends Error {
  readonly statusCode = 400;
}
