const { requireAuth } = require("../../../lib/http");
const { getConversationForUser, listMembers, markRead, deleteDirectConversation } = require("../../../lib/chat");
const { inviteGroupMember, removeGroupMember } = require("../../../lib/chat-service");
const { broadcastConversationDeleted } = require("../../../lib/realtime");

export default function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const conversationId = req.query.id;
  try {
    if (req.method === "GET") {
      const conversation = getConversationForUser(auth.user.id, conversationId);
      if (!conversation) return res.status(404).json({ error: "Conversation not found" });
      return res.json({ conversation, members: listMembers(auth.user.id, conversationId) });
    }
    if (req.method === "PATCH") {
      const { action, username, memberId, seq } = req.body || {};
      if (action === "invite") {
        const member = inviteGroupMember(auth.user.id, conversationId, username);
        return res.json({ member });
      }
      if (action === "removeMember") {
        const result = removeGroupMember(auth.user.id, conversationId, memberId);
        return res.json(result);
      }
      if (action === "read") {
        markRead(auth.user.id, conversationId, seq || 0);
        return res.json({ ok: true });
      }
      return res.status(400).json({ error: "Invalid action" });
    }
    if (req.method === "DELETE") {
      const result = deleteDirectConversation(auth.user.id, conversationId);
      broadcastConversationDeleted(result);
      return res.json({ ok: true });
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
