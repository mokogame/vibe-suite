import type { FastifyInstance } from "fastify";
import type { ApiContext } from "../context.js";

export function registerQueueRoutes(app: FastifyInstance, context: ApiContext): void {
  app.get("/v1/queue", async () => ({ queue: await queueStats(context) }));
}

export async function queueStats({ store, queue }: ApiContext) {
  const persisted = await store.listQueueTasks();
  return {
    ...queue.stats(),
    persisted: {
      queued: persisted.filter((task) => task.status === "queued").length,
      running: persisted.filter((task) => task.status === "running").length,
      completed: persisted.filter((task) => task.status === "completed").length,
      failed: persisted.filter((task) => task.status === "failed").length
    }
  };
}
