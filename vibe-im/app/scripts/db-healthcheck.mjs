import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { initDb, getDb } = require("../lib/db.js");
const { getDatabaseUrl } = require("../lib/data/database-url.js");

initDb();
const database = getDb();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const expectedTables = [
  "users",
  "sessions",
  "friendships",
  "friend_requests",
  "conversations",
  "conversation_members",
  "groups",
  "messages",
  "attachments",
  "schema_migrations"
];

const forbiddenTables = [
  "video_projects",
  "video_specs",
  "video_edit_events"
];

const tableRows = database.prepare(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
`).all();
const existingTables = new Set(tableRows.map(row => row.table_name));

for (const table of expectedTables) {
  assert(existingTables.has(table), `Missing table: ${table}`);
}
for (const table of forbiddenTables) {
  assert(!existingTables.has(table), `Business-specific deprecated table should not exist in core database: ${table}`);
}

const migrations = database.prepare("SELECT version FROM schema_migrations ORDER BY version ASC").all();
assert(migrations.some(row => row.version === "001_initial_schema"), "Missing migration record: 001_initial_schema");

const indexes = database.prepare(`
  SELECT indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
`).all();
const existingIndexes = new Set(indexes.map(row => row.indexname));
assert(existingIndexes.has("messages_conversation_id_seq_key"), "Missing message sequence unique index");

console.log(JSON.stringify({
  ok: true,
  databaseUrl: getDatabaseUrl().replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@"),
  migrations: migrations.map(row => row.version),
  checkedTables: expectedTables.length,
  forbiddenTables,
  checkedIndexes: 1
}, null, 2));
