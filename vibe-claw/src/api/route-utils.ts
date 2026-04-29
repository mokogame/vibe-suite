import { newId, nowIso } from "../core/ids.js";
import type { Store } from "../store/store.js";
import type { AuthActor } from "../types.js";
import type { AuthedRequest } from "./context.js";

export function requestIdOf(request: AuthedRequest): string {
  return request.requestId ?? newId("req");
}

export function actorOf(request: AuthedRequest): AuthActor {
  return request.actor ?? { tokenId: "unknown", name: "unknown", scopes: [] };
}

export async function addAudit(
  store: Store,
  request: AuthedRequest,
  action: string,
  targetType: string,
  targetId: string,
  status: "success" | "failed",
  metadata: Record<string, unknown>
): Promise<void> {
  await store.addAudit({
    id: newId("audit"),
    requestId: requestIdOf(request),
    actor: actorOf(request).name,
    action,
    targetType,
    targetId,
    status,
    metadata,
    createdAt: nowIso()
  });
}
