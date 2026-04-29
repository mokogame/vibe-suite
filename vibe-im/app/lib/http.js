const { getSessionByToken, getUserById, publicUser } = require("./db");

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `vibe_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "vibe_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function getAuth(req) {
  const token = parseCookies(req).vibe_session || req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const session = getSessionByToken(token);
  if (!session || session.user_status !== "active") return null;
  const user = getUserById(session.user_id);
  if (!user || user.status !== "active") return null;
  return { token, session, user, publicUser: publicUser(user), transportKey: session.transport_key };
}

function requireAuth(req, res) {
  const auth = getAuth(req);
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return auth;
}

function requireAdmin(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  if (auth.user.role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return null;
  }
  return auth;
}

module.exports = {
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getAuth,
  requireAuth,
  requireAdmin
};
