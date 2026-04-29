const { requireAdmin } = require("../../../lib/http");
const { getDb, id, now, publicUser } = require("../../../lib/db");
const { hashPassword } = require("../../../lib/security");
const { getJson, setJson } = require("../../../lib/cache");
const { invalidateUserReadCaches, makeUserGraphCacheKey } = require("../../../lib/read-cache");

export default async function handler(req, res) {
  const auth = requireAdmin(req, res);
  if (!auth) return;
  const database = getDb();
  if (req.method === "GET") {
    const cacheKey = await makeUserGraphCacheKey("admin:users");
    const cached = await getJson(cacheKey);
    if (cached) return res.json({ users: cached, cache: "hit" });
    const users = database.prepare("SELECT * FROM users ORDER BY created_at DESC").all().map(publicUser);
    await setJson(cacheKey, users, 30);
    return res.json({ users });
  }
  if (req.method === "POST") {
    const { username, password = "password123", displayName, role = "user" } = req.body || {};
    if (!username || !displayName) return res.status(400).json({ error: "username and displayName are required" });
    const createdAt = now();
    try {
      database.prepare(`
        INSERT INTO users (id, username, password_hash, display_name, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(id(), username, hashPassword(password), displayName, role === "admin" ? "admin" : "user", createdAt, createdAt);
      await invalidateUserReadCaches();
      return res.json({ ok: true });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }
  if (req.method === "PATCH") {
    const { userId, status, displayName } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId is required" });
    if (status) database.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), userId);
    if (displayName) database.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(displayName, now(), userId);
    await invalidateUserReadCaches();
    return res.json({ ok: true });
  }
  res.status(405).json({ error: "Method not allowed" });
};
