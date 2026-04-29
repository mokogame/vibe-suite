import { createServer } from "./api/server.js";
import { loadRuntimeEnv } from "./config/runtime-config.js";
import { migrate } from "./db/migrate.js";

await loadRuntimeEnv();

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? "0.0.0.0";
const connectionString = process.env.VIBE_CLAW_DATABASE_URL ?? process.env.DATABASE_URL;

if (process.env.VIBE_CLAW_STORAGE_MODE !== "memory" && connectionString) {
  await migrate(connectionString);
  console.log("[startup] Postgres migrations are up to date");
}

const app = await createServer();
await app.listen({ port, host });

console.log(`[startup] Vibe Claw is running on http://localhost:${port}`);
