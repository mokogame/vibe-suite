const fs = require("node:fs");
const path = require("node:path");
const Libpq = require("libpq");
const {
  hashPassword,
  randomToken,
  sha256,
  makeTransportKey
} = require("./security");
const { getDatabaseUrl } = require("./data/database-url");

const root = process.cwd();
const runtimeRoot = process.env.VIBE_RUNTIME_DIR
  ? path.resolve(process.env.VIBE_RUNTIME_DIR)
  : path.resolve(root, "..");
const dataDir = path.join(runtimeRoot, "data");
const uploadDir = path.join(runtimeRoot, "uploads");
const migrationsDir = path.resolve(__dirname, "..", "db", "migrations");
const databaseUrl = getDatabaseUrl();

let connection = null;
let db = null;
let transactionDepth = 0;

function now() {
  return new Date().toISOString();
}

function normalizeParams(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

function translateSql(sql, args) {
  const original = String(sql || "");
  if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) {
    const values = [];
    const indexes = new Map();
    const namedSql = original.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
      if (!indexes.has(name)) {
        indexes.set(name, values.length + 1);
        values.push(args[0][name]);
      }
      return `$${indexes.get(name)}`;
    });
    if (values.length) return { sql: namedSql, values };
  }

  const values = normalizeParams(args);
  let index = 0;
  const positionalSql = original.replace(/\?/g, () => `$${++index}`);
  return { sql: positionalSql, values };
}

class PostgresStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
  }

  get(...args) {
    const result = this.database.query(this.sql, args);
    return result.rows[0] || undefined;
  }

  all(...args) {
    const result = this.database.query(this.sql, args);
    return result.rows;
  }

  run(...args) {
    const result = this.database.query(this.sql, args);
    return {
      changes: result.rowCount || 0,
      rowCount: result.rowCount || 0
    };
  }
}

class PostgresDatabase {
  constructor(pgConnection) {
    this.connection = pgConnection;
  }

  query(sql, args = []) {
    const translated = translateSql(sql, args);
    const values = translated.values.map(value => value == null ? null : String(value));
    if (values.length) this.connection.execParams(translated.sql, values);
    else this.connection.exec(translated.sql);
    const status = this.connection.resultStatus();
    if (status === "PGRES_FATAL_ERROR" || status === "PGRES_BAD_RESPONSE") {
      throw new Error(this.connection.resultErrorMessage() || this.connection.errorMessage() || "Postgres query failed");
    }
    const rows = [];
    const rowCount = this.connection.ntuples();
    const fieldCount = this.connection.nfields();
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const row = {};
      for (let fieldIndex = 0; fieldIndex < fieldCount; fieldIndex += 1) {
        const name = this.connection.fname(fieldIndex);
        row[name] = this.connection.getisnull(rowIndex, fieldIndex)
          ? null
          : coercePgValue(this.connection.getvalue(rowIndex, fieldIndex), this.connection.ftype(fieldIndex));
      }
      rows.push(row);
    }
    return {
      rows,
      rowCount: Number(this.connection.cmdTuples() || rowCount || 0)
    };
  }

  exec(sql) {
    this.connection.exec(String(sql || ""));
    const status = this.connection.resultStatus();
    if (status === "PGRES_FATAL_ERROR" || status === "PGRES_BAD_RESPONSE") {
      throw new Error(this.connection.resultErrorMessage() || this.connection.errorMessage() || "Postgres exec failed");
    }
  }

  prepare(sql) {
    return new PostgresStatement(this, sql);
  }
}

function coercePgValue(value, oid) {
  if (value == null) return null;
  if (oid === 20 || oid === 21 || oid === 23) return Number(value);
  if (oid === 700 || oid === 701 || oid === 1700) return Number(value);
  return value;
}

function initDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  if (!connection) {
    connection = new Libpq();
    connection.connectSync(databaseUrl);
    db = new PostgresDatabase(connection);
    db.exec("SET client_min_messages TO warning");
  }
  runMigrations();
  seedAdmin();
}

function runMigrations() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  if (!fs.existsSync(migrationsDir)) return [];
  const files = fs.readdirSync(migrationsDir)
    .filter(file => /^\d+_.+\.sql$/.test(file))
    .sort();
  const applied = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const current = database.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version);
    if (current) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    transaction(() => {
      database.exec(sql);
      database.prepare(`
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `).run(version, file, now());
    });
    applied.push(version);
  }
  return applied;
}

function getDb() {
  if (!db) initDb();
  return db;
}

function transaction(fn) {
  const database = getDb();
  const savepoint = `sp_${transactionDepth + 1}`;
  const ownsClient = transactionDepth === 0;
  if (ownsClient) database.exec("BEGIN");
  else database.exec(`SAVEPOINT ${savepoint}`);

  transactionDepth += 1;
  try {
    const result = fn(database);
    transactionDepth -= 1;
    if (ownsClient) database.exec("COMMIT");
    else database.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    transactionDepth -= 1;
    if (ownsClient) database.exec("ROLLBACK");
    else database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  } finally {
  }
}

function id() {
  return cryptoRandom();
}

function cryptoRandom() {
  return require("node:crypto").randomUUID();
}

function seedAdmin() {
  const database = getDb();
  const row = database.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (row) return;
  const createdAt = now();
  database.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'admin', 'active', ?, ?)
  `).run(id(), "admin", hashPassword("admin123"), "Administrator", createdAt, createdAt);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    role: user.role,
    status: user.status
  };
}

function createSession(userId) {
  const token = randomToken("sess");
  const createdAt = now();
  const row = {
    id: id(),
    user_id: userId,
    token_hash: sha256(token),
    transport_key: makeTransportKey(),
    created_at: createdAt,
    expires_at: null
  };
  getDb().prepare(`
    INSERT INTO sessions (id, user_id, token_hash, transport_key, created_at, expires_at)
    VALUES (@id, @user_id, @token_hash, @transport_key, @created_at, @expires_at)
  `).run(row);
  return { token, session: row };
}

function getSessionByToken(token) {
  if (!token) return null;
  return getDb().prepare(`
    SELECT sessions.*, users.status AS user_status
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE token_hash = ?
  `).get(sha256(token));
}

function deleteSession(token) {
  if (!token) return;
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

function getUserById(userId) {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function getUserByUsername(username) {
  return getDb().prepare("SELECT * FROM users WHERE lower(username) = lower(?)").get(username);
}

module.exports = {
  initDb,
  getDb,
  now,
  id,
  uploadDir,
  publicUser,
  createSession,
  getSessionByToken,
  deleteSession,
  getUserById,
  getUserByUsername,
  transaction,
  runMigrations
};
