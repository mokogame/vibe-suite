import { migrate } from "../src/db/migrate.js";

const connectionString = process.env.VIBE_CLAW_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("缺少 VIBE_CLAW_DATABASE_URL 或 DATABASE_URL");
}

await migrate(connectionString);
console.log("[db] migrations applied");
