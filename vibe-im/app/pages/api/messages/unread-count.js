const { requireAuth } = require("../../../lib/http");
const { listConversations } = require("../../../lib/chat");

export default function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const count = listConversations(auth.user.id).reduce((total, conversation) => total + Number(conversation.unread || 0), 0);
  return res.json({ count, unreadCount: count });
}
