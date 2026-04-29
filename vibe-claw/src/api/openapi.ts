export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Vibe Claw API",
    version: "0.1.0",
    description: "第三方调用、多 Agent 协作和运行审计 API"
  },
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer"
      }
    }
  },
  paths: {
    "/health": {
      get: {
        security: [],
        summary: "服务健康检查",
        responses: { "200": { description: "服务可用" } }
      }
    },
    "/v1/agents": {
      get: {
        summary: "查询 Agent 列表",
        responses: { "200": { description: "Agent 列表" } }
      },
      post: {
        summary: "创建 Agent",
        responses: { "201": { description: "Agent 已创建" } }
      }
    },
    "/v1/runs": {
      get: {
        summary: "查询运行列表",
        responses: { "200": { description: "运行列表" } }
      },
      post: {
        summary: "创建单 Agent 或多 Agent 顺序协作运行",
        responses: {
          "201": { description: "运行完成" },
          "422": { description: "运行失败并已记录失败状态" }
        }
      }
    },
    "/v1/runs/{id}": {
      get: {
        summary: "查询运行详情",
        responses: { "200": { description: "运行、步骤和事件" } }
      }
    },
    "/v1/runs/{id}/events": {
      get: {
        summary: "查询运行事件",
        responses: { "200": { description: "运行事件列表" } }
      }
    },
    "/v1/audit-events": {
      get: {
        summary: "查询审计事件",
        responses: { "200": { description: "审计事件列表" } }
      }
    }
  }
};
