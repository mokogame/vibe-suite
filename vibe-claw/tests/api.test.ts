import { describe, expect, it } from "vitest";
import { createServer } from "../src/api/server.js";

const auth = { authorization: "Bearer test-token" };

describe("Vibe Claw API", () => {
  it("exposes health without auth", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, service: "vibe-claw" });
  });

  it("exposes OpenAPI contract without auth", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      openapi: "3.1.0",
      info: { title: "Vibe Claw API" }
    });
  });

  it("rejects protected API without token", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const response = await app.inject({ method: "GET", url: "/v1/agents" });
    expect(response.statusCode).toBe(401);
  });

  it("creates an agent and runs it", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const createAgent = await app.inject({
      method: "POST",
      url: "/v1/agents",
      headers: auth,
      payload: {
        name: "Planner",
        instruction: "负责拆解任务"
      }
    });
    expect(createAgent.statusCode).toBe(201);
    const agentId = createAgent.json().agent.id;

    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: {
        agentIds: [agentId],
        input: "制定回归测试方案"
      }
    });

    expect(run.statusCode).toBe(201);
    const body = run.json();
    expect(body.run.status).toBe("completed");
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].startedAt).toEqual(expect.any(String));
    expect(body.steps[0].completedAt).toEqual(expect.any(String));
    expect(body.events.some((event: { status: string }) => event.status === "calling_model")).toBe(true);
    expect(body.run.totalTokens).toBeGreaterThan(0);
  });

  it("supports fixed sequential multi-agent collaboration", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const first = await createAgent(app, "Planner", "负责拆解任务");
    const second = await createAgent(app, "Reviewer", "负责审查方案风险");

    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: {
        agentIds: [first, second],
        input: "设计第三方 API 调用方案",
        context: ["必须保留审计事件"]
      }
    });

    expect(run.statusCode).toBe(201);
    const body = run.json();
    expect(body.run.status).toBe("completed");
    expect(body.steps).toHaveLength(2);
    expect(body.run.output).toContain("Reviewer");
    expect(body.events.filter((event: { status: string }) => event.status === "completed").length).toBeGreaterThanOrEqual(3);
  });

  it("records failed runs for invalid agents instead of hiding the error", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: {
        agentIds: ["missing-agent"],
        input: "hello"
      }
    });

    expect(run.statusCode).toBe(422);
    const body = run.json();
    expect(body.run.status).toBe("failed");
    expect(body.run.errorType).toBe("invalid_agent");
    expect(body.events.some((event: { status: string }) => event.status === "failed")).toBe(true);
  });

  it("rejects invalid single-mode run shape", async () => {
    const app = await createServer({ apiToken: "test-token" });
    const first = await createAgent(app, "A", "A");
    const second = await createAgent(app, "B", "B");
    const run = await app.inject({
      method: "POST",
      url: "/v1/runs",
      headers: auth,
      payload: {
        agentIds: [first, second],
        mode: "single",
        input: "hello"
      }
    });

    expect(run.statusCode).toBe(400);
  });
});

async function createAgent(app: Awaited<ReturnType<typeof createServer>>, name: string, instruction: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/agents",
    headers: auth,
    payload: { name, instruction }
  });
  expect(response.statusCode).toBe(201);
  return response.json().agent.id;
}
