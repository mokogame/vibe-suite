import type { FastifyInstance } from "fastify";
import type { ApiContext, AuthedRequest } from "../context.js";
import { addAudit, filterScope, scopeOf, sameScope, withIdempotency } from "../route-utils.js";
import { createProviderSchema, parseBody, updateProviderSchema } from "../schemas.js";

export function registerProviderRoutes(app: FastifyInstance, { store }: ApiContext): void {
  app.get("/v1/providers", async (request) => ({ providers: filterScope(await store.listProviders(), scopeOf(request as AuthedRequest)) }));

  app.post("/v1/providers", async (request, reply) => {
    const body = parseBody(createProviderSchema, request.body);
    const scope = scopeOf(request as AuthedRequest);
    return withIdempotency(store, request as AuthedRequest, reply, async () => {
      const providerConfig = await store.createProvider({ ...body, ...scope });
      await addAudit(store, request as AuthedRequest, "provider.create", "provider", providerConfig.id, "success", {
        name: providerConfig.name,
        type: providerConfig.type,
        apiKeyRef: providerConfig.apiKeyRef ? maskSecretRef(providerConfig.apiKeyRef) : null
      });
      return { statusCode: 201, body: { provider: providerConfig } };
    });
  });

  app.get<{ Params: { id: string } }>("/v1/providers/:id", async (request, reply) => {
    const providerConfig = await store.getProvider(request.params.id);
    if (!providerConfig || !sameScope(providerConfig, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Provider 不存在" });
    return { provider: providerConfig };
  });

  app.patch<{ Params: { id: string } }>("/v1/providers/:id", async (request, reply) => {
    const body = parseBody(updateProviderSchema, request.body);
    const existing = await store.getProvider(request.params.id);
    if (!existing || !sameScope(existing, scopeOf(request as AuthedRequest))) return reply.status(404).send({ error: "Provider 不存在" });
    const providerConfig = await store.updateProvider(existing.id, body);
    if (!providerConfig) return reply.status(404).send({ error: "Provider 不存在" });
    await addAudit(store, request as AuthedRequest, "provider.update", "provider", providerConfig.id, "success", { fields: Object.keys(body) });
    return { provider: providerConfig };
  });
}

function maskSecretRef(ref: string): string {
  if (ref.length <= 10) return ref[0] + "*".repeat(Math.max(0, ref.length - 2)) + ref.at(-1);
  return `${ref.slice(0, 4)}${"*".repeat(Math.min(24, ref.length - 8))}${ref.slice(-4)}`;
}
