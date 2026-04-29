import { createServer } from "./api/server.js";
import { loadRuntimeEnv } from "./config/runtime-config.js";

await loadRuntimeEnv();

const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? "0.0.0.0";

const app = await createServer();
await app.listen({ port, host });

console.log(`[startup] Vibe Claw is running on http://localhost:${port}`);
