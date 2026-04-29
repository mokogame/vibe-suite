const { requireAuth } = require("../../../lib/http");
const { getDb, publicUser, now } = require("../../../lib/db");
const { hashPassword, verifyPassword } = require("../../../lib/security");

export default function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (req.method === "PATCH") {
    const { displayName, currentPassword, newPassword } = req.body || {};
    if (displayName && String(displayName).trim().length >= 1) {
      getDb().prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?").run(String(displayName).trim(), now(), auth.user.id);
    }
    if (newPassword) {
      if (!verifyPassword(currentPassword || "", auth.user.password_hash)) return res.status(400).json({ error: "当前密码不正确" });
      getDb().prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(newPassword), now(), auth.user.id);
    }
    const updated = getDb().prepare("SELECT * FROM users WHERE id = ?").get(auth.user.id);
    return res.json({ user: publicUser(updated) });
  }
  res.status(405).json({ error: "Method not allowed" });
};
