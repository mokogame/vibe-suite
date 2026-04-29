import { newId, nowIso } from "./ids.js";
import type { MemoryStore } from "../store/memory-store.js";
import type { ModelProvider } from "../model/providers.js";
import type { AuthActor, CreateRunInput, RunStatus } from "../types.js";

export class Orchestrator {
  constructor(
    private readonly store: MemoryStore,
    private readonly provider: ModelProvider
  ) {}

  async runAgents(requestId: string, actor: AuthActor, input: CreateRunInput) {
    const run = this.store.createRun(input.input);
    this.audit(requestId, actor.name, "run.create", "run", run.id, "success", {
      agentIds: input.agentIds,
      mode: input.mode ?? "sequential"
    });
    this.event(run.id, null, "queued", "已排队", "第三方调用已创建 Agent run。");

    try {
      let currentInput = input.input;
      let finalOutput = "";
      let totalTokens = 0;
      const context = [...(input.context ?? [])];

      for (const agentId of input.agentIds) {
        const agent = this.store.getAgent(agentId);
        if (!agent || agent.status !== "active") {
          throw new RunFailure("invalid_agent", `Agent 不存在或不可用：${agentId}`);
        }

        const step = this.store.createStep({
          runId: run.id,
          agentId: agent.id,
          status: "queued",
          input: currentInput,
          output: null,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          startedAt: null,
          completedAt: null
        });

        this.transitionRun(run.id, "building_context");
        this.transitionStep(step.id, "building_context", "正在整理上下文", `${agent.name} 正在整理输入、共享上下文和上一步输出。`);

        const stepContext = finalOutput ? [...context, `上一位 Agent 输出：${finalOutput}`] : context;

        this.transitionRun(run.id, "calling_model");
        this.transitionStep(step.id, "calling_model", "正在调用模型", `${agent.name} 正在通过 ${this.provider.name} 生成回复。`);

        const result = await this.provider.call({
          requestId,
          runId: run.id,
          stepId: step.id,
          agent,
          input: currentInput,
          context: stepContext
        });

        this.transitionRun(run.id, "validating_output");
        this.transitionStep(step.id, "validating_output", "正在校验输出", `${agent.name} 的输出已生成，正在进行基础校验。`);

        if (!result.text.trim()) {
          throw new RunFailure("empty_model_output", "模型输出为空");
        }

        finalOutput = result.text;
        currentInput = result.text;
        totalTokens += result.totalTokens;
        this.store.updateStep(step.id, {
          status: "completed",
          output: result.text,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens: result.totalTokens,
          completedAt: nowIso()
        });
        this.event(run.id, step.id, "completed", "步骤完成", `${agent.name} 已完成本步骤。`);
        this.audit(requestId, actor.name, "run.step.completed", "step", step.id, "success", {
          agentId: agent.id,
          provider: result.provider,
          model: result.model,
          totalTokens: result.totalTokens
        });
      }

      const completedRun = this.store.updateRun(run.id, {
        status: "completed",
        output: finalOutput,
        totalTokens
      });
      this.event(run.id, null, "completed", "运行完成", "Agent run 已完成。");
      this.audit(requestId, actor.name, "run.completed", "run", run.id, "success", { totalTokens });
      return {
        run: completedRun,
        steps: this.store.listSteps(run.id),
        events: this.store.listEvents(run.id)
      };
    } catch (error) {
      const failure = normalizeFailure(error);
      const failedRun = this.store.updateRun(run.id, {
        status: "failed",
        errorType: failure.type,
        errorMessage: failure.message
      });
      this.event(run.id, null, "failed", "运行失败", failure.message);
      this.audit(requestId, actor.name, "run.failed", "run", run.id, "failed", failure);
      return {
        run: failedRun,
        steps: this.store.listSteps(run.id),
        events: this.store.listEvents(run.id)
      };
    }
  }

  private transitionRun(runId: string, status: RunStatus) {
    this.store.updateRun(runId, { status });
  }

  private transitionStep(stepId: string, status: RunStatus, title: string, summary: string) {
    const step = this.store.updateStep(stepId, {
      status,
      startedAt: status === "building_context" ? nowIso() : undefined
    });
    this.event(step.runId, step.id, status, title, summary);
  }

  private event(runId: string, stepId: string | null, status: RunStatus, title: string, summary: string) {
    this.store.addEvent({ runId, stepId, status, title, summary, visible: true });
  }

  private audit(
    requestId: string,
    actor: string,
    action: string,
    targetType: string,
    targetId: string,
    status: "success" | "failed",
    metadata: Record<string, unknown>
  ) {
    this.store.addAudit({
      id: newId("audit"),
      requestId,
      actor,
      action,
      targetType,
      targetId,
      status,
      metadata,
      createdAt: nowIso()
    });
  }
}

export class RunFailure extends Error {
  constructor(
    readonly type: string,
    message: string
  ) {
    super(message);
  }
}

function normalizeFailure(error: unknown): { type: string; message: string } {
  if (error instanceof RunFailure) return { type: error.type, message: error.message };
  if (error instanceof Error) return { type: "provider_error", message: error.message };
  return { type: "unknown_error", message: "未知错误" };
}
