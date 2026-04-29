import { newId, nowIso } from "./ids.js";
import type { Store } from "../store/store.js";
import type { ModelProvider } from "../model/providers.js";
import { ProviderError, estimateTokens } from "../model/providers.js";
import { DEFAULT_PROJECT_ID, DEFAULT_TENANT_ID, type AuthActor, type ContextItem, type CreateRunInput, type ResourceScope, type RunStatus } from "../types.js";
import { runTool } from "../tools/registry.js";

const DEFAULT_MODEL_TIMEOUT_MS = 90_000;
const DEFAULT_CONTEXT_TOKEN_BUDGET = 6000;

export class Orchestrator {
  constructor(
    private readonly store: Store,
    private readonly provider: ModelProvider,
    private readonly options: {
      modelTimeoutMs?: number;
      contextTokenBudget?: number;
      resolveProvider?: (providerId: string | undefined, agentProviderId: string | null) => Promise<ModelProvider>;
      onUsage?: (usage: { actor: AuthActor; agentId: string; provider: string; model: string; totalTokens: number; latencyMs: number }) => Promise<void>;
    } = {}
  ) {}

  async createRun(requestId: string, actor: AuthActor, input: CreateRunInput) {
    const run = await this.store.createRun(input.input, { tenantId: actor.tenantId, projectId: actor.projectId });
    await this.audit(requestId, actor.name, "run.create", "run", run.id, "success", {
      agentIds: input.agentIds,
      mode: input.mode ?? "sequential"
    });
    await this.event(run.id, null, "queued", "已排队", "第三方调用已创建 Agent run，正在等待后台执行。" );
    return run;
  }

  startRun(requestId: string, actor: AuthActor, runId: string, input: CreateRunInput): void {
    void this.executeRun(requestId, actor, runId, input).catch(async (error) => {
      const failure = normalizeFailure(error);
      await this.store.updateRun(runId, {
        status: "failed",
        errorType: failure.type,
        errorMessage: failure.message
      });
      await this.event(runId, null, "failed", "运行失败", failure.message);
      await this.audit(requestId, actor.name, "run.failed", "run", runId, "failed", failure);
    });
  }

  async executeRun(requestId: string, actor: AuthActor, runId: string, input: CreateRunInput) {
    try {
      let currentInput = input.input;
      let finalOutput = "";
      let totalTokens = 0;
      const context = normalizeContext(input.context ?? []);
      for (const toolCall of input.toolCalls ?? []) {
        const result = await runTool(toolCall, actor);
        context.push({ source: "tool", content: `工具 ${result.name} 输出：${result.output}`, priority: 70 });
        await this.audit(requestId, actor.name, "tool.call.completed", "run", runId, "success", { tool: result.name });
      }

      for (const agentId of input.agentIds) {
        await this.assertNotCancelled(runId);
        const agent = await this.store.getAgent(agentId);
        if (!agent || !sameScope(agent, actor) || agent.status !== "active") {
          throw new RunFailure("invalid_agent", `Agent 不存在或不可用：${agentId}`);
        }

        const step = await this.store.createStep({
          runId,
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

        await this.transitionRun(runId, "building_context");
        await this.transitionStep(step.id, "building_context", "正在整理上下文", `${agent.name} 正在整理输入、共享上下文和上一步输出。`);

        const stepContext = trimContext(
          finalOutput ? [...context, { source: "agent", content: `上一位 Agent 输出：${finalOutput}`, priority: 80 }] : context,
          this.options.contextTokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET
        );
        await this.audit(requestId, actor.name, "run.context.injected", "step", step.id, "success", {
          contextCount: stepContext.length,
          sensitiveCount: stepContext.filter((item) => item.sensitive).length,
          estimatedTokens: estimateTokens(stepContext.map((item) => item.content).join("\n"))
        });

        const runtimeProvider = await this.resolveProvider(input.providerId, agent.providerId);
        await this.transitionRun(runId, "calling_model");
        await this.transitionStep(step.id, "calling_model", "正在调用模型", `${agent.name} 正在通过 ${runtimeProvider.name} 生成回复。`);
        await this.audit(requestId, actor.name, "provider.call.started", "step", step.id, "success", {
          agentId: agent.id,
          provider: runtimeProvider.name,
          model: agent.defaultModel
        });

        const providerStartedAt = Date.now();
        const result = await runtimeProvider.call({
          requestId,
          runId,
          stepId: step.id,
          agent,
          input: currentInput,
          context: stepContext,
          timeoutMs: this.options.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS
        });

        const latencyMs = Date.now() - providerStartedAt;

        await this.transitionRun(runId, "validating_output");
        await this.transitionStep(step.id, "validating_output", "正在校验输出", `${agent.name} 的输出已生成，正在进行基础校验。`);

        if (!result.text.trim()) {
          throw new RunFailure("empty_model_output", "模型输出为空");
        }

        finalOutput = result.text;
        currentInput = result.text;
        totalTokens += result.totalTokens;
        await this.store.updateStep(step.id, {
          status: "completed",
          output: result.text,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          totalTokens: result.totalTokens,
          completedAt: nowIso()
        });
        await this.event(runId, step.id, "completed", "步骤完成", `${agent.name} 已完成本步骤。`);
        await this.audit(requestId, actor.name, "provider.call.completed", "step", step.id, "success", {
          provider: result.provider,
          model: result.model,
          totalTokens: result.totalTokens,
          latencyMs,
          contextSummary: stepContext.map((item) => `${item.source}:${item.content.slice(0, 80)}`).join(" | ")
        });
        await this.options.onUsage?.({ actor, agentId: agent.id, provider: result.provider, model: result.model, totalTokens: result.totalTokens, latencyMs });
        await this.audit(requestId, actor.name, "run.step.completed", "step", step.id, "success", {
          agentId: agent.id,
          provider: result.provider,
          model: result.model,
          totalTokens: result.totalTokens,
          latencyMs
        });
        const currentIndex = input.agentIds.indexOf(agentId);
        const nextAgentId = input.agentIds[currentIndex + 1];
        if (nextAgentId) {
          await this.event(runId, step.id, "building_context", "正在移交任务", `${agent.name} 已完成，正在移交给下一个 Agent。`);
          await this.audit(requestId, actor.name, "handoff.completed", "run", runId, "success", { fromAgentId: agent.id, toAgentId: nextAgentId });
        }
      }

      const completedRun = await this.store.updateRun(runId, {
        status: "completed",
        output: finalOutput,
        totalTokens
      });
      await this.event(runId, null, "completed", "运行完成", "Agent run 已完成。" );
      await this.store.addArtifact({ runId, type: "text", name: "final-output", content: finalOutput });
      await this.audit(requestId, actor.name, "run.completed", "run", runId, "success", { totalTokens });
      return {
        run: completedRun,
        steps: await this.store.listSteps(runId),
        events: await this.store.listEvents(runId)
      };
    } catch (error) {
      const failure = normalizeFailure(error);
      const failedRun = await this.store.updateRun(runId, {
        status: failure.type === "cancelled" ? "cancelled" : "failed",
        errorType: failure.type,
        errorMessage: failure.message
      });
      await this.event(runId, null, failedRun.status, failedRun.status === "cancelled" ? "运行已取消" : "运行失败", failure.message);
      await this.audit(requestId, actor.name, "run.failed", "run", runId, failedRun.status === "cancelled" ? "success" : "failed", failure);
      return {
        run: failedRun,
        steps: await this.store.listSteps(runId),
        events: await this.store.listEvents(runId)
      };
    }
  }

  async cancelRun(requestId: string, actor: AuthActor, runId: string) {
    const run = await this.store.getRun(runId);
    if (!run) return null;
    if (["completed", "failed", "cancelled"].includes(run.status)) return run;
    const cancelled = await this.store.updateRun(runId, {
      status: "cancelled",
      errorType: "cancelled",
      errorMessage: "用户请求取消运行"
    });
    await this.event(runId, null, "cancelled", "运行已取消", "用户请求取消运行。" );
    await this.audit(requestId, actor.name, "run.cancelled", "run", runId, "success", {});
    return cancelled;
  }

  private async resolveProvider(runProviderId: string | undefined, agentProviderId: string | null): Promise<ModelProvider> {
    const providerId = runProviderId ?? agentProviderId ?? undefined;
    if (this.options.resolveProvider) return this.options.resolveProvider(providerId, agentProviderId);
    return this.provider;
  }

  private async assertNotCancelled(runId: string) {
    const run = await this.store.getRun(runId);
    if (run?.status === "cancelled") throw new RunFailure("cancelled", "运行已取消");
  }

  private async transitionRun(runId: string, status: RunStatus) {
    await this.store.updateRun(runId, { status });
  }

  private async transitionStep(stepId: string, status: RunStatus, title: string, summary: string) {
    const step = await this.store.updateStep(stepId, {
      status,
      startedAt: status === "building_context" ? nowIso() : undefined
    });
    await this.event(step.runId, step.id, status, title, summary);
  }

  private async event(runId: string, stepId: string | null, status: RunStatus, title: string, summary: string) {
    await this.store.addEvent({ runId, stepId, status, title, summary, visible: true });
  }

  private async audit(
    requestId: string,
    actor: string,
    action: string,
    targetType: string,
    targetId: string,
    status: "success" | "failed",
    metadata: Record<string, unknown>
  ) {
    await this.store.addAudit({
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

function sameScope(resource: ResourceScope, actor: ResourceScope): boolean {
  return (resource.tenantId ?? DEFAULT_TENANT_ID) === (actor.tenantId ?? DEFAULT_TENANT_ID)
    && (resource.projectId ?? DEFAULT_PROJECT_ID) === (actor.projectId ?? DEFAULT_PROJECT_ID);
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
  if (error instanceof ProviderError) return { type: `provider_${error.type}`, message: error.message };
  if (error instanceof Error) return { type: "provider_error", message: error.message };
  return { type: "unknown_error", message: "未知错误" };
}

function normalizeContext(context: CreateRunInput["context"]): ContextItem[] {
  return (context ?? []).map((item) => {
    if (typeof item === "string") {
      return { source: "user", content: item, priority: 50, sensitive: false };
    }
    return {
      source: item.source ?? "user",
      content: item.content,
      priority: item.priority ?? 50,
      sensitive: item.sensitive ?? false
    };
  });
}

function trimContext(context: ContextItem[], tokenBudget: number): ContextItem[] {
  const sorted = [...context].sort((a, b) => b.priority - a.priority);
  const selected: ContextItem[] = [];
  let used = 0;
  for (const item of sorted) {
    const cost = estimateTokens(item.content);
    if (used + cost > tokenBudget) continue;
    selected.push(item);
    used += cost;
  }
  return selected.sort((a, b) => a.priority - b.priority);
}
