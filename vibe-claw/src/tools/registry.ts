import type { AuthActor } from "../types.js";

export type ToolCallInput = {
  name: string;
  input?: Record<string, unknown>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  requiredScope: string;
  inputSchema: Record<string, unknown>;
};

export type ToolCallResult = {
  name: string;
  output: string;
};

type ToolHandler = (input: Record<string, unknown>) => Promise<string> | string;

type ToolRegistration = ToolDefinition & {
  run: ToolHandler;
};

const tools = new Map<string, ToolRegistration>([
  [
    "clock.now",
    {
      name: "clock.now",
      description: "返回当前 ISO 时间",
      requiredScope: "tools:clock",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      run: () => new Date().toISOString()
    }
  ],
  [
    "text.echo",
    {
      name: "text.echo",
      description: "回显输入 text 字段，用于联调工具上下文",
      requiredScope: "tools:text",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string", maxLength: 2000 } },
        required: ["text"]
      },
      run: (input) => String(input.text ?? "")
    }
  ]
]);

export function listTools(actor?: AuthActor): ToolDefinition[] {
  return [...tools.values()]
    .filter((tool) => !actor || hasScope(actor.scopes, tool.requiredScope))
    .map(({ run: _run, ...definition }) => definition);
}

export async function runTool(call: ToolCallInput, actor: AuthActor): Promise<ToolCallResult> {
  const tool = tools.get(call.name);
  if (!tool) throw new Error(`工具不存在或未授权：${call.name}`);
  if (!hasScope(actor.scopes, tool.requiredScope)) throw new Error(`缺少工具权限：${tool.requiredScope}`);
  validateToolInput(tool, call.input ?? {});
  const output = await tool.run(call.input ?? {});
  return { name: call.name, output };
}

function validateToolInput(tool: ToolRegistration, input: Record<string, unknown>): void {
  if (tool.name === "text.echo" && typeof input.text !== "string") {
    throw new Error("text.echo 需要 string 类型 text 字段");
  }
}

function hasScope(scopes: string[], requiredScope: string): boolean {
  if (scopes.includes("*")) return true;
  if (scopes.includes(requiredScope)) return true;
  const [resource] = requiredScope.split(":");
  return scopes.includes(`${resource}:*`);
}
