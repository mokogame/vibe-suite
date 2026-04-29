const { parseCookies, clearSessionCookie } = require("../../../lib/http");
const { deleteSession } = require("../../../lib/db");

export default function handler(req, res) {
  const token = parseCookies(req).vibe_session;
  deleteSession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
};
