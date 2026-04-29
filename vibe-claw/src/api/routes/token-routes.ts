import type { FastifyInstance } from "fastify";
import { newId, nowIso } from "../../core/ids.js";
import { createPlainToken, hashToken } from "../../security/tokens.js";
import type { ApiContext } from "../context.js";
import { createTokenSchema, parseBody } from "../schemas.js";

export function registerTokenRoutes(app: FastifyInstance, { store }: ApiContext): void {
  app.get("/v1/tokens", async () => ({ tokens: (await store.listTokens()).map(sanitizeToken) }));

  app.post("/v1/tokens", async (request, reply) => {
    const body = parseBody(createTokenSchema, request.body);
    const plainToken = createPlainToken();
    const token = await store.addToken({
      id: newId("token"),
      tokenHash: hashToken(plainToken),
      name: body.name,
      scopes: body.scopes ?? ["*"],
      status: "active",
      createdAt: nowIso(),
      revokedAt: null
    });
    return reply.status(201).send({ token: sanitizeToken(token), plainToken });
  });

  app.post<{ Params: { id: string } }>("/v1/tokens/:id/revoke", async (request, reply) => {
    const token = await store.revokeToken(request.params.id, nowIso());
    if (!token) return reply.status(404).send({ error: "Token 不存在" });
    return { token: sanitizeToken(token) };
  });
}

function sanitizeToken<T extends { tokenHash: string }>(token: T): Omit<T, "tokenHash"> {
  const { tokenHash: _tokenHash, ...safe } = token;
  return safe;
}
