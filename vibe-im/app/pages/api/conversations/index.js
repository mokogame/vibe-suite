const { requireAuth } = require("../../../lib/http");
const { listConversations, ensureDirectConversation, createGroup } = require("../../../lib/chat");
const { getUserByUsername } = require("../../../lib/db");

export default function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  try {
    if (req.method === "GET") {
      return res.json({ conversations: listConversations(auth.user.id) });
    }
    if (req.method === "POST") {
      const { type, username, name, members = [] } = req.body || {};
      if (type === "direct") {
        const normalizedUsername = String(username || "").trim().replace(/^@+/, "").trim();
        const other = getUserByUsername(normalizedUsername);
        if (!other || other.status !== "active") return res.status(404).json({ error: "用户不存在" });
        const conversation = ensureDirectConversation(auth.user.id, other.id);
        return res.json({ conversation });
      }
      if (type === "group") {
        if (!name) return res.status(400).json({ error: "群名称不能为空" });
        const conversation = createGroup(auth.user.id, name, members);
        return res.json({ conversation });
      }
      return res.status(400).json({ error: "Invalid conversation type" });
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
