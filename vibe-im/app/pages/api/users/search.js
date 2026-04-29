const { requireAuth } = require("../../../lib/http");
const { getDb, publicUser } = require("../../../lib/db");
const { getJson, setJson } = require("../../../lib/cache");
const { makeUserGraphCacheKey } = require("../../../lib/read-cache");

export default async function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const q = String(req.query.q || "").trim().replace(/^@+/, "").trim().slice(0, 64);
  if (!q) return res.json({ users: [] });
  const cacheKey = await makeUserGraphCacheKey("users:search", auth.user.id, q);
  const cached = await getJson(cacheKey);
  if (cached) return res.json({ users: cached, cache: "hit" });
  const users = getDb().prepare(`
    SELECT users.*,
      CASE WHEN friendships.id IS NULL THEN 0 ELSE 1 END AS is_friend
    FROM users
    LEFT JOIN friendships ON friendships.user_id = ? AND friendships.friend_id = users.id
    WHERE users.status = 'active'
      AND users.id != ?
      AND (users.username LIKE ? OR users.display_name LIKE ?)
    ORDER BY users.username ASC
    LIMIT 20
  `).all(auth.user.id, auth.user.id, `%${q}%`, `%${q}%`).map(row => ({ ...publicUser(row), isFriend: Boolean(row.is_friend) }));
  await setJson(cacheKey, users, 10);
  res.json({ users });
};
