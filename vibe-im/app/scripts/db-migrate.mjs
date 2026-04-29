import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { initDb, getDb } = require("../lib/db.js");

initDb();
const migrations = getDb().prepare("SELECT version FROM schema_migrations ORDER BY version").all().map(row => row.version);
console.log(JSON.stringify({
  ok: true,
  migrations,
  migrationCount: migrations.length
}, null, 2));
