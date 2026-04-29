const { getUserByUsername, createSession, publicUser } = require("../../../lib/db");
const { verifyPassword } = require("../../../lib/security");
const { setSessionCookie } = require("../../../lib/http");

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { username, password } = req.body || {};
  const user = getUserByUsername(username || "");
  if (!user || user.status !== "active" || !verifyPassword(password || "", user.password_hash)) {
    return res.status(401).json({ error: "账号或密码错误" });
  }
  const { token, session } = createSession(user.id);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user), token, transportKey: session.transport_key });
};
