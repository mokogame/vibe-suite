import type { FastifyInstance } from "fastify";
import { adminHtml } from "../admin-page.js";
import { openApiDocument } from "../openapi.js";

export function registerAdminRoutes(app: FastifyInstance): void {
  app.get("/openapi.json", async () => openApiDocument);
  app.get("/admin", async (_request, reply) => reply.type("text/html").send(adminHtml));
  app.get("/admin/:section", async (_request, reply) => reply.type("text/html").send(adminHtml));
}
