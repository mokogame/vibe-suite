import { z } from "zod";

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  instruction: z.string().trim().min(1).max(4000),
  defaultModel: z.string().trim().min(1).max(120).optional()
});

export const createRunSchema = z.object({
  agentIds: z.array(z.string().trim().min(1)).min(1).max(10),
  input: z.string().trim().min(1).max(20000),
  context: z.array(z.string().max(20000)).max(20).optional(),
  mode: z.enum(["single", "sequential"]).optional()
}).superRefine((value, ctx) => {
  if (value.mode === "single" && value.agentIds.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agentIds"],
      message: "single 模式只能指定一个 Agent"
    });
  }
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
