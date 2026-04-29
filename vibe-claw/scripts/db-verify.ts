import { migrate } from "../src/db/migrate.js";
import { loadRuntimeEnv } from "../src/config/runtime-config.js";
import { PostgresStore } from "../src/store/postgres-store.js";

await loadRuntimeEnv();

const connectionString = process.env.VIBE_CLAW_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.log("[db:verify] skipped: missing VIBE_CLAW_DATABASE_URL or DATABASE_URL");
  process.exit(0);
}

await migrate(connectionString);
const store = new PostgresStore({ connectionString });
try {
  const health = await store.healthCheck();
  if (!health.ok) throw new Error(health.error ?? "database healthcheck failed");
  const agent = await store.createAgent({ name: "DB Verify Agent", instruction: "verify", defaultModel: "mock" });
  const run = await store.createRun("verify run");
  await store.addEvent({ runId: run.id, stepId: null, status: "queued", title: "验证事件", summary: "数据库验证事件", visible: true });
  const events = await store.listEvents(run.id);
  if (events.length === 0) throw new Error("event roundtrip failed");
  await store.createProvider({ name: "DB Verify Provider", type: "mock", defaultModel: "mock" });
  await store.createMemory({ agentId: agent.id, type: "semantic", scope: "agent", summary: "verify", content: "verify", source: "db:verify", createdBy: "db:verify" });
  console.log("[db:verify] ok");
} finally {
  await store.close();
}
