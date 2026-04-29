const ref = (name: string) => ({ "$ref": `#/components/schemas/${name}` });
const ok = (description: string, schema?: object) => ({ description, ...(schema ? { content: { "application/json": { schema } } } : {}) });
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Vibe Claw API",
    version: "0.3.0",
    description: "第三方调用、多 Agent 协作、普通对话、协议对话、记忆、租约、Provider、队列和审计 API"
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    schemas: {
      Agent: objectSchema({ id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, instruction: { type: "string" }, status: { type: "string", enum: ["active", "disabled", "archived"] }, defaultModel: { type: "string" }, providerId: { type: ["string", "null"] }, createdAt: { type: "string" }, updatedAt: { type: "string" } }, ["id", "name", "instruction", "status", "defaultModel", "createdAt", "updatedAt"]),
      Provider: objectSchema({ id: { type: "string" }, name: { type: "string" }, type: { type: "string", enum: ["mock", "openai-compatible"] }, status: { type: "string", enum: ["active", "disabled"] }, baseUrl: { type: ["string", "null"] }, defaultModel: { type: "string" }, apiKeyRef: { type: ["string", "null"] }, timeoutMs: { type: "integer" }, maxRetries: { type: "integer" }, createdAt: { type: "string" }, updatedAt: { type: "string" } }, ["id", "name", "type", "status", "defaultModel"]),
      Run: objectSchema({ id: { type: "string" }, status: { type: "string" }, input: { type: "string" }, output: { type: ["string", "null"] }, totalTokens: { type: "integer" }, errorType: { type: ["string", "null"] }, errorMessage: { type: ["string", "null"] }, createdAt: { type: "string" }, updatedAt: { type: "string" } }),
      RunEvent: objectSchema({ id: { type: "string" }, runId: { type: "string" }, stepId: { type: ["string", "null"] }, status: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, visible: { type: "boolean" }, createdAt: { type: "string" } }),
      Memory: objectSchema({ id: { type: "string" }, agentId: { type: "string" }, type: { type: "string" }, scope: { type: "string" }, status: { type: "string" }, summary: { type: "string" }, content: { type: "string" }, source: { type: "string" }, createdAt: { type: "string" }, updatedAt: { type: "string" } }),
      Conversation: objectSchema({ id: { type: "string" }, agentId: { type: "string" }, mode: { type: "string" }, status: { type: "string" }, summary: { type: "string" }, createdAt: { type: "string" }, updatedAt: { type: "string" } }),
      Message: objectSchema({ id: { type: "string" }, conversationId: { type: "string" }, agentId: { type: "string" }, role: { type: "string" }, content: { type: "string" }, runId: { type: ["string", "null"] }, totalTokens: { type: "integer" }, createdAt: { type: "string" } }),
      Protocol: objectSchema({ id: { type: "string" }, agentId: { type: "string" }, name: { type: "string" }, version: { type: "string" }, inputSchema: { type: "object" }, outputSchema: { type: "object" }, status: { type: "string" } }),
      Lease: objectSchema({ id: { type: "string" }, agentId: { type: "string" }, status: { type: "string" }, expiresAt: { type: "string" }, maxCalls: { type: "integer" }, usedCalls: { type: "integer" }, tokenBudget: { type: "integer" }, usedTokens: { type: "integer" }, allowedProtocols: { type: "array", items: { type: "string" } } }),
      Token: objectSchema({ id: { type: "string" }, name: { type: "string" }, scopes: { type: "array", items: { type: "string" } }, status: { type: "string" }, createdAt: { type: "string" }, revokedAt: { type: ["string", "null"] } }),
      Tool: objectSchema({ name: { type: "string" }, description: { type: "string" }, requiredScope: { type: "string" }, inputSchema: { type: "object" } }),
      QueueStats: objectSchema({ pending: { type: "integer" }, active: { type: "integer" }, concurrency: { type: "integer" }, persisted: { type: "object" } }),
      CreateRunInput: objectSchema({ agentIds: { type: "array", items: { type: "string" } }, input: { type: "string" }, providerId: { type: "string" }, context: { type: "array" }, toolCalls: { type: "array" }, callbackUrl: { type: "string" }, callbackSecret: { type: "string" }, mode: { type: "string" } }, ["agentIds", "input"]),
      CreateMessageInput: objectSchema({ conversationId: { type: "string" }, message: { type: "string" }, context: { type: "array" }, compression: { type: "string" }, leaseId: { type: "string" } }, ["message"]),
      CreateProtocolInput: objectSchema({ name: { type: "string" }, version: { type: "string" }, inputSchema: { type: "object" }, outputSchema: { type: "object" } }, ["name", "version", "inputSchema", "outputSchema"]),
      CreateProtocolRunInput: objectSchema({ conversationId: { type: "string" }, protocol: { type: "string" }, input: { type: "object" }, context: { type: "array" }, leaseId: { type: "string" } }, ["protocol", "input"]),
      CreateMemoryInput: objectSchema({ type: { type: "string" }, scope: { type: "string" }, summary: { type: "string" }, content: { type: "string" }, source: { type: "string" } }, ["type", "summary", "content"]),
      CreateLeaseInput: objectSchema({ expiresAt: { type: "string" }, maxCalls: { type: "integer" }, tokenBudget: { type: "integer" }, allowedProtocols: { type: "array", items: { type: "string" } } }, ["expiresAt", "maxCalls", "tokenBudget"])
    }
  },
  paths: {
    "/health": { get: { security: [], summary: "健康检查", responses: { "200": ok("服务状态") } } },
    "/admin": { get: { security: [], summary: "后台控制台", responses: { "200": { description: "HTML 控制台" } } } },
    "/v1/agents": { get: { summary: "Agent 列表", responses: { "200": ok("Agent 列表", objectSchema({ agents: { type: "array", items: ref("Agent") } })) } }, post: { summary: "创建 Agent", requestBody: { content: { "application/json": { schema: objectSchema({ name: { type: "string" }, instruction: { type: "string" }, defaultModel: { type: "string" }, providerId: { type: ["string", "null"] } }, ["name", "instruction"]) } } }, responses: { "201": ok("已创建", objectSchema({ agent: ref("Agent") })) } } },
    "/v1/agents/{id}": { get: { summary: "Agent 详情", responses: { "200": ok("Agent", objectSchema({ agent: ref("Agent") })) } }, patch: { summary: "更新 Agent", responses: { "200": ok("Agent", objectSchema({ agent: ref("Agent") })) } } },
    "/v1/agents/{id}/messages": { post: { summary: "普通对话", requestBody: { content: { "application/json": { schema: ref("CreateMessageInput") } } }, responses: { "200": ok("对话结果", objectSchema({ conversation: ref("Conversation"), message: ref("Message"), run: ref("Run"), events: { type: "array", items: ref("RunEvent") } })) } } },
    "/v1/agents/{id}/protocols": { get: { summary: "协议列表", responses: { "200": ok("协议列表", objectSchema({ protocols: { type: "array", items: ref("Protocol") } })) } }, post: { summary: "注册协议", requestBody: { content: { "application/json": { schema: ref("CreateProtocolInput") } } }, responses: { "201": ok("协议", objectSchema({ protocol: ref("Protocol") })) } } },
    "/v1/agents/{id}/protocol-runs": { post: { summary: "协议运行", requestBody: { content: { "application/json": { schema: ref("CreateProtocolRunInput") } } }, responses: { "200": ok("协议成功"), "400": ok("输入校验失败"), "422": ok("输出校验失败") } } },
    "/v1/agents/{id}/memories": { get: { summary: "记忆列表", responses: { "200": ok("记忆", objectSchema({ memories: { type: "array", items: ref("Memory") } })) } }, post: { summary: "写入记忆", requestBody: { content: { "application/json": { schema: ref("CreateMemoryInput") } } }, responses: { "201": ok("记忆", objectSchema({ memory: ref("Memory") })) } } },
    "/v1/agents/{id}/conversations": { get: { summary: "Agent 最近会话", responses: { "200": ok("最近会话", objectSchema({ conversations: { type: "array", items: { type: "object" } } })) } } },
    "/v1/memories/{id}": { patch: { summary: "更新记忆状态", responses: { "200": ok("记忆", objectSchema({ memory: ref("Memory") })) } } },
    "/v1/agents/{id}/leases": { get: { summary: "租约列表", responses: { "200": ok("租约", objectSchema({ leases: { type: "array", items: ref("Lease") } })) } }, post: { summary: "创建租约", requestBody: { content: { "application/json": { schema: ref("CreateLeaseInput") } } }, responses: { "201": ok("租约", objectSchema({ lease: ref("Lease") })) } } },
    "/v1/conversations/{id}": { get: { summary: "会话详情", responses: { "200": ok("会话", objectSchema({ conversation: ref("Conversation"), messages: { type: "array", items: ref("Message") } })) } } },
    "/v1/runs": { get: { summary: "Run 列表", responses: { "200": ok("Run 列表") } }, post: { summary: "创建异步 Run", requestBody: { content: { "application/json": { schema: ref("CreateRunInput") } } }, responses: { "202": ok("已排队", objectSchema({ run: ref("Run"), queue: ref("QueueStats") })) } } },
    "/v1/runs/{id}": { get: { summary: "Run 详情", responses: { "200": ok("Run", objectSchema({ run: ref("Run"), events: { type: "array", items: ref("RunEvent") } })) } } },
    "/v1/queue": { get: { summary: "队列状态", responses: { "200": ok("队列", objectSchema({ queue: ref("QueueStats") })) } } },
    "/v1/providers": { get: { summary: "Provider 列表", responses: { "200": ok("Provider", objectSchema({ providers: { type: "array", items: ref("Provider") } })) } }, post: { summary: "创建 Provider", responses: { "201": ok("Provider", objectSchema({ provider: ref("Provider") })) } } },
    "/v1/providers/{id}": { get: { summary: "Provider 详情", responses: { "200": ok("Provider", objectSchema({ provider: ref("Provider") })) } }, patch: { summary: "更新 Provider", responses: { "200": ok("Provider", objectSchema({ provider: ref("Provider") })) } } },
    "/v1/tools": { get: { summary: "工具列表", responses: { "200": ok("工具", objectSchema({ tools: { type: "array", items: ref("Tool") } })) } } },
    "/v1/tokens": { get: { summary: "Token 列表", responses: { "200": ok("Token", objectSchema({ tokens: { type: "array", items: ref("Token") } })) } }, post: { summary: "创建 Token", responses: { "201": ok("Token") } } },
    "/v1/audit-events": { get: { summary: "审计事件", responses: { "200": ok("审计") } } }
  }
};
