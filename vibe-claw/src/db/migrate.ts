import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;

export async function migrate(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await pool.query(`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`);
    const migrationsDir = join(process.cwd(), "db", "migrations");
    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const existing = await pool.query(`select version from schema_migrations where version=$1`, [version]);
      const sql = await readFile(join(migrationsDir, file), "utf8");
      if (existing.rowCount === 0) {
        await pool.query("begin");
        await pool.query(sql);
        await pool.query(`insert into schema_migrations (version) values ($1)`, [version]);
        await pool.query("commit");
      } else {
        await applyIdempotentMaintenance(pool, sql);
      }
    }
  } catch (error) {
    await pool.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await pool.end();
  }
}

async function applyIdempotentMaintenance(pool: pg.Pool, sql: string): Promise<void> {
  const statements = sql
    .split(";\n")
    .map((statement) => statement.trim())
    .filter((statement) => {
      const normalized = statement.toLowerCase();
      return (
        normalized.startsWith("create index if not exists") ||
        normalized.startsWith("create table if not exists") ||
        /^alter\s+table\s+\S+\s+add\s+column\s+if\s+not\s+exists/.test(normalized)
      );
    });
  for (const statement of statements) {
    await pool.query(statement);
  }
}
