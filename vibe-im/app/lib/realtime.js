const { getDb, getUserByUsername } = require("./db");
const {
  serializeMessage,
  listConversations,
  listMessages,
  listMembers,
  markRead,
  dissolveGroup,
  deleteDirectConversation,
  ensureDirectConversation,
  createGroup
} = require("./chat");
const { decryptText } = require("./security");
const { onChatMessage } = require("./chat-events");
const { inviteGroupMember, removeGroupMember, sendChatMessage } = require("./chat-service");

const SOCKET_REGISTRY_KEY = Symbol.for("vibe-im.socketsByUser");
const socketsByUser = globalThis[SOCKET_REGISTRY_KEY] || new Map();
globalThis[SOCKET_REGISTRY_KEY] = socketsByUser;

function registerSocket(userId, ws) {
  const set = socketsByUser.get(userId) || new Set();
  set.add(ws);
  socketsByUser.set(userId, set);
}

function unregisterSocket(userId, ws) {
  const set = socketsByUser.get(userId);
  if (!set) return;
  set.delete(ws);
  if (!set.size) socketsByUser.delete(userId);
}

function getSocketTransportKey(ws) {
  const session = ws.identity.sessionId
    ? getDb().prepare("SELECT transport_key FROM sessions WHERE id = ?").get(ws.identity.sessionId)
    : null;
  return ws.identity.transportKey || session?.transport_key;
}

function sendResponse(ws, requestId, payload) {
  ws.send(JSON.stringify({ type: "response", requestId, ...payload }));
}

function broadcastMessage(messageRow) {
  const members = getDb().prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(messageRow.conversation_id);
  for (const member of members) {
    const sockets = socketsByUser.get(member.user_id);
    if (!sockets) continue;
    for (const ws of sockets) {
      const transportKey = getSocketTransportKey(ws);
      if (!transportKey) continue;
      ws.send(JSON.stringify({ type: "message", message: serializeMessage(messageRow, transportKey) }));
    }
  }
}

function broadcastMessageUpdate(messageRow) {
  const members = getDb().prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(messageRow.conversation_id);
  for (const member of members) {
    const sockets = socketsByUser.get(member.user_id);
    if (!sockets) continue;
    for (const ws of sockets) {
      const transportKey = getSocketTransportKey(ws);
      if (!transportKey) continue;
      ws.send(JSON.stringify({ type: "message_update", message: serializeMessage(messageRow, transportKey) }));
    }
  }
}

function broadcastConversationDeleted(result) {
  for (const userId of result.members || []) {
    const sockets = socketsByUser.get(userId);
    if (!sockets) continue;
    for (const ws of sockets) {
      ws.send(JSON.stringify({
        type: "conversation_deleted",
        conversationId: result.conversationId,
        title: result.title
      }));
    }
  }
}

const CHAT_EVENT_SUBSCRIPTION_KEY = Symbol.for("vibe-im.realtime-chat-event-subscription");
if (!globalThis[CHAT_EVENT_SUBSCRIPTION_KEY]) {
  globalThis[CHAT_EVENT_SUBSCRIPTION_KEY] = onChatMessage(messageRow => {
    broadcastMessage(messageRow);
  });
}

async function handleSocketMessage(ws, raw) {
  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return;
  }

  try {
    const transportKey = getSocketTransportKey(ws);
    if (event.type === "list_conversations") {
      return sendResponse(ws, event.requestId, { conversations: listConversations(ws.identity.userId) });
    }
    if (event.type === "create_direct") {
      const other = getUserByUsername(event.username || "");
      if (!other) throw new Error("User not found");
      const conversation = ensureDirectConversation(ws.identity.userId, other.id);
      return sendResponse(ws, event.requestId, { conversation });
    }
    if (event.type === "create_group") {
      const conversation = createGroup(ws.identity.userId, event.name, event.members || []);
      return sendResponse(ws, event.requestId, { conversation });
    }
    if (event.type === "get_messages") {
      const messages = listMessages(ws.identity.userId, event.conversationId, transportKey, event.afterSeq || 0, event.limit || 80);
      return sendResponse(ws, event.requestId, { messages });
    }
    if (event.type === "get_conversation") {
      const members = listMembers(ws.identity.userId, event.conversationId);
      return sendResponse(ws, event.requestId, { members });
    }
    if (event.type === "mark_read") {
      markRead(ws.identity.userId, event.conversationId, event.seq || 0);
      return sendResponse(ws, event.requestId, { ok: true });
    }
    if (event.type === "invite_member") {
      const member = inviteGroupMember(ws.identity.userId, event.conversationId, event.username);
      return sendResponse(ws, event.requestId, { member });
    }
    if (event.type === "remove_member") {
      const result = removeGroupMember(ws.identity.userId, event.conversationId, event.memberId);
      return sendResponse(ws, event.requestId, result);
    }
    if (event.type === "dissolve_group") {
      const result = dissolveGroup(ws.identity.userId, event.conversationId);
      broadcastConversationDeleted(result);
      return sendResponse(ws, event.requestId, { ok: true });
    }
    if (event.type === "delete_direct_conversation") {
      const result = deleteDirectConversation(ws.identity.userId, event.conversationId);
      broadcastConversationDeleted(result);
      return sendResponse(ws, event.requestId, { ok: true });
    }
    if (event.type === "send_message") {
      const text = event.messageType === "text" ? decryptText(event.encryptedText, transportKey) : "";
      const row = sendChatMessage(ws.identity.userId, event.conversationId, {
        type: event.messageType,
        text,
        attachmentId: event.attachmentId,
        replyToId: event.replyToId
      });
      if (event.requestId) sendResponse(ws, event.requestId, { ok: true, message: serializeMessage(row, transportKey) });
      return;
    }
    if (event.requestId) {
      return sendResponse(ws, event.requestId, { error: `Unsupported WebSocket request type: ${event.type || "unknown"}` });
    }
  } catch (error) {
    if (event.requestId) sendResponse(ws, event.requestId, { error: error.message });
    else ws.send(JSON.stringify({ type: "error", error: error.message }));
  }
}

module.exports = {
  registerSocket,
  unregisterSocket,
  broadcastMessage,
  broadcastMessageUpdate,
  broadcastConversationDeleted,
  handleSocketMessage
};
