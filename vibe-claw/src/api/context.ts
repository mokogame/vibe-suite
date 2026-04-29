import type { FastifyRequest } from "fastify";
import type { Orchestrator } from "../core/orchestrator.js";
import type { RunQueue } from "../core/run-queue.js";
import type { Store } from "../store/store.js";
import type { AuthActor } from "../types.js";

export type AuthedRequest = FastifyRequest & {
  actor?: AuthActor;
  requestId?: string;
};

export type ApiContext = {
  store: Store;
  orchestrator: Orchestrator;
  queue: RunQueue;
};
