import { newId, nowIso } from "../core/ids.js";
import type { Agent, AgentRun, ApiToken, AuditEvent, RunEvent, RunStep } from "../types.js";

export type CreateAgentData = {
  name: string;
  description?: string;
  instruction: string;
  defaultModel?: string;
};

export class MemoryStore {
  private agents = new Map<string, Agent>();
  private runs = new Map<string, AgentRun>();
  private steps = new Map<string, RunStep>();
  private events = new Map<string, RunEvent>();
  private tokens = new Map<string, ApiToken>();
  private audits = new Map<string, AuditEvent>();

  createAgent(data: CreateAgentData): Agent {
    const now = nowIso();
    const agent: Agent = {
      id: newId("agent"),
      name: data.name,
      description: data.description ?? "",
      instruction: data.instruction,
      status: "active",
      defaultModel: data.defaultModel ?? "mock",
      createdAt: now,
      updatedAt: now
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  listAgents(): Agent[] {
    return [...this.agents.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getAgent(id: string): Agent | null {
    return this.agents.get(id) ?? null;
  }

  createRun(input: string): AgentRun {
    const now = nowIso();
    const run: AgentRun = {
      id: newId("run"),
      status: "queued",
      input,
      output: null,
      totalTokens: 0,
      errorType: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now
    };
    this.runs.set(run.id, run);
    return run;
  }

  updateRun(id: string, patch: Partial<AgentRun>): AgentRun {
    const current = this.mustGetRun(id);
    const next = { ...current, ...withoutUndefined(patch), updatedAt: nowIso() };
    this.runs.set(id, next);
    return next;
  }

  getRun(id: string): AgentRun | null {
    return this.runs.get(id) ?? null;
  }

  mustGetRun(id: string): AgentRun {
    const run = this.getRun(id);
    if (!run) throw new Error(`Run not found: ${id}`);
    return run;
  }

  listRuns(): AgentRun[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  createStep(data: Omit<RunStep, "id">): RunStep {
    const step = { ...data, id: newId("step") };
    this.steps.set(step.id, step);
    return step;
  }

  updateStep(id: string, patch: Partial<RunStep>): RunStep {
    const current = this.steps.get(id);
    if (!current) throw new Error(`Step not found: ${id}`);
    const next = { ...current, ...withoutUndefined(patch) };
    this.steps.set(id, next);
    return next;
  }

  listSteps(runId: string): RunStep[] {
    return [...this.steps.values()].filter((step) => step.runId === runId);
  }

  addEvent(data: Omit<RunEvent, "id" | "createdAt">): RunEvent {
    const event: RunEvent = { ...data, id: newId("event"), createdAt: nowIso() };
    this.events.set(event.id, event);
    return event;
  }

  listEvents(runId: string): RunEvent[] {
    return [...this.events.values()]
      .filter((event) => event.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  addToken(token: ApiToken): ApiToken {
    this.tokens.set(token.id, token);
    return token;
  }

  listTokens(): ApiToken[] {
    return [...this.tokens.values()];
  }

  addAudit(event: AuditEvent): AuditEvent {
    this.audits.set(event.id, event);
    return event;
  }

  listAuditEvents(): AuditEvent[] {
    return [...this.audits.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
