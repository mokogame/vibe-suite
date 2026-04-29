import type { FastifyInstance } from "fastify";
import type { ApiContext, AuthedRequest } from "../context.js";
import { addAudit } from "../route-utils.js";
import { createProviderSchema, parseBody, updateProviderSchema } from "../schemas.js";

export function registerProviderRoutes(app: FastifyInstance, { store }: ApiContext): void {
  app.get("/v1/providers", async () => ({ providers: await store.listProviders() }));

  app.post("/v1/providers", async (request, reply) => {
    const body = parseBody(createProviderSchema, request.body);
    const providerConfig = await store.createProvider(body);
    await addAudit(store, request as AuthedRequest, "provider.create", "provider", providerConfig.id, "success", {
      name: providerConfig.name,
      type: providerConfig.type,
      apiKeyRef: providerConfig.apiKeyRef
    });
    return reply.status(201).send({ provider: providerConfig });
  });

  app.get<{ Params: { id: string } }>("/v1/providers/:id", async (request, reply) => {
    const providerConfig = await store.getProvider(request.params.id);
    if (!providerConfig) return reply.status(404).send({ error: "Provider 不存在" });
    return { provider: providerConfig };
  });

  app.patch<{ Params: { id: string } }>("/v1/providers/:id", async (request, reply) => {
    const body = parseBody(updateProviderSchema, request.body);
    const providerConfig = await store.updateProvider(request.params.id, body);
    if (!providerConfig) return reply.status(404).send({ error: "Provider 不存在" });
    await addAudit(store, request as AuthedRequest, "provider.update", "provider", providerConfig.id, "success", { fields: Object.keys(body) });
    return { provider: providerConfig };
  });
}
