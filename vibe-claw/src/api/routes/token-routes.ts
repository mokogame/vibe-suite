import type { FastifyInstance } from "fastify";
import { newId, nowIso } from "../../core/ids.js";
import { createPlainToken, hashToken } from "../../security/tokens.js";
import type { ApiContext, AuthedRequest } from "../context.js";
import { actorOf, filterScope, scopeOf, sameScope, withIdempotency } from "../route-utils.js";
import { createTokenSchema, parseBody } from "../schemas.js";

export function registerTokenRoutes(app: FastifyInstance, { store }: ApiContext): void {
  app.get("/v1/tokens", async (request) => ({ tokens: filterScope(await store.listTokens(), scopeOf(request as AuthedRequest)).map(sanitizeToken) }));

  app.post("/v1/tokens", async (request, reply) => {
    const body = parseBody(createTokenSchema, request.body);
    const actor = actorOf(request as AuthedRequest);
    const scope = { tenantId: body.tenantId ?? actor.tenantId, projectId: body.projectId ?? actor.projectId };
    return withIdempotency(store, request as AuthedRequest, reply, async () => {
      const plainToken = createPlainToken();
      const token = await store.addToken({
        id: newId("token"),
        ...scope,
        tokenHash: hashToken(plainToken),
        name: body.name,
        scopes: body.scopes ?? ["*"],
        status: "active",
        expiresAt: body.expiresAt ?? null,
        allowedIps: body.allowedIps ?? [],
        lastUsedAt: null,
        lastUsedIp: null,
        createdAt: nowIso(),
        revokedAt: null
      });
      return { statusCode: 201, body: { token: sanitizeToken(token), plainToken } };
    });
  });

  app.post<{ Params: { id: string } }>("/v1/tokens/:id/revoke", async (request, reply) => {
    const existing = await store.getToken(request.params.id);
    if (!existing || !sameScope(existing, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Token 不存在" });
    const token = await store.revokeToken(existing.id, nowIso());
    if (!token) return reply.status(404).send({ error: "Token 不存在" });
    return { token: sanitizeToken(token) };
  });

  app.post<{ Params: { id: string } }>("/v1/tokens/:id/rotate", async (request, reply) => {
    const existing = await store.getToken(request.params.id);
    if (!existing || !sameScope(existing, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Token 不存在" });
    await store.revokeToken(existing.id, nowIso());
    const plainToken = createPlainToken();
    const rotated = await store.addToken({
      id: newId("token"),
      tenantId: existing.tenantId,
      projectId: existing.projectId,
      tokenHash: hashToken(plainToken),
      name: `${existing.name} rotated`,
      scopes: existing.scopes,
      status: "active",
      expiresAt: existing.expiresAt,
      allowedIps: existing.allowedIps,
      lastUsedAt: null,
      lastUsedIp: null,
      createdAt: nowIso(),
      revokedAt: null
    });
    return reply.status(201).send({ token: sanitizeToken(rotated), plainToken, revokedTokenId: existing.id });
  });
}

function sanitizeToken<T extends { tokenHash: string }>(token: T): Omit<T, "tokenHash"> {
  const { tokenHash: _tokenHash, ...safe } = token;
  return safe;
}
