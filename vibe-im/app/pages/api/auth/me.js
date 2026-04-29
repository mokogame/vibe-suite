const { requireAuth } = require("../../../lib/http");

export default function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  res.json({ user: auth.publicUser, token: auth.token, transportKey: auth.transportKey });
};
