import { createHash } from "node:crypto";
import type { FastifyReply } from "fastify";
import { newId, nowIso } from "../core/ids.js";
import type { Store } from "../store/store.js";
import { DEFAULT_PROJECT_ID, DEFAULT_TENANT_ID, type AuthActor, type ResourceScope } from "../types.js";
import type { AuthedRequest } from "./context.js";

export function requestIdOf(request: AuthedRequest): string {
  return request.requestId ?? newId("req");
}

export function actorOf(request: AuthedRequest): AuthActor {
  return normalizeActor(request.actor);
}

export function normalizeActor(actor: AuthActor | undefined): AuthActor {
  return {
    tokenId: actor?.tokenId ?? "unknown",
    name: actor?.name ?? "unknown",
    scopes: actor?.scopes ?? [],
    tenantId: actor?.tenantId ?? DEFAULT_TENANT_ID,
    projectId: actor?.projectId ?? DEFAULT_PROJECT_ID
  };
}

export function scopeOf(requestOrActor: AuthedRequest | AuthActor | undefined): Required<ResourceScope> {
  const actor = "headers" in (requestOrActor ?? {}) ? (requestOrActor as AuthedRequest).actor : requestOrActor as AuthActor | undefined;
  return {
    tenantId: actor?.tenantId ?? DEFAULT_TENANT_ID,
    projectId: actor?.projectId ?? DEFAULT_PROJECT_ID
  };
}

export function sameScope(resource: ResourceScope | null | undefined, scope: ResourceScope): boolean {
  return (resource?.tenantId ?? DEFAULT_TENANT_ID) === (scope.tenantId ?? DEFAULT_TENANT_ID)
    && (resource?.projectId ?? DEFAULT_PROJECT_ID) === (scope.projectId ?? DEFAULT_PROJECT_ID);
}

export function filterScope<T extends ResourceScope>(items: T[], scope: ResourceScope): T[] {
  return items.filter((item) => sameScope(item, scope));
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
  const actor = actorOf(request);
  await store.addAudit({
    id: newId("audit"),
    ...scopeOf(actor),
    requestId: requestIdOf(request),
    actor: actor.name,
    action,
    targetType,
    targetId,
    status,
    metadata: {
      ...metadata,
      sourceIp: request.ip,
      userAgent: request.headers["user-agent"] ?? null
    },
    createdAt: nowIso()
  });
}

export async function withIdempotency(
  store: Store,
  request: AuthedRequest,
  reply: FastifyReply,
  handler: () => Promise<{ statusCode: number; body: Record<string, unknown> }>
): Promise<FastifyReply | Record<string, unknown>> {
  const key = request.headers["idempotency-key"]?.toString().trim();
  if (!key) {
    const result = await handler();
    return reply.status(result.statusCode).send(result.body);
  }

  const scope = scopeOf(request);
  const actor = actorOf(request).tokenId;
  const method = request.method.toUpperCase();
  const path = request.routeOptions.url ?? request.url.split("?")[0] ?? request.url;
  const bodyHash = createHash("sha256").update(JSON.stringify(request.body ?? null)).digest("hex");
  await store.cleanupExpiredIdempotencyRecords(nowIso());
  const existing = await store.getIdempotencyRecord(scope, actor, method, path, key);
  if (existing) {
    if (existing.bodyHash !== bodyHash) {
      return reply.status(409).send({ error: "Idempotency-Key 已被不同请求体使用" });
    }
    return reply.status(existing.statusCode).send(existing.responseBody);
  }

  const result = await handler();
  await store.saveIdempotencyRecord({
    id: newId("idem"),
    ...scope,
    actor,
    method,
    path,
    idempotencyKey: key,
    bodyHash,
    statusCode: result.statusCode,
    responseBody: result.body,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: nowIso()
  });
  return reply.status(result.statusCode).send(result.body);
}
