const {
  addMemberByUsername,
  createMessage,
  createSystemMessage,
  getConversationForUser,
  removeMember
} = require("./chat");
const { getDb } = require("./db");
const { publishChatMessage } = require("./chat-events");

function sendChatMessage(senderId, conversationId, input) {
  const message = createMessage(senderId, conversationId, input);
  return publishChatMessage(message);
}

function sendSystemMessage(conversationId, senderId, text) {
  const message = createSystemMessage(conversationId, senderId, String(text || ""));
  return publishChatMessage(message);
}

function sendConversationSystemMessage(actorId, conversationId, text) {
  return sendSystemMessage(conversationId, systemActorForConversation(conversationId, actorId), text);
}

function inviteGroupMember(actorId, conversationId, username) {
  const member = addMemberByUsername(actorId, conversationId, username);
  if (member.systemMessage) publishChatMessage(member.systemMessage);
  return member;
}

function removeGroupMember(actorId, conversationId, memberId) {
  const result = removeMember(actorId, conversationId, memberId);
  if (result.systemMessage) publishChatMessage(result.systemMessage);
  return result;
}

function systemActorForConversation(conversationId, actorId = null) {
  if (actorId) return actorId;
  const conv = getDb().prepare("SELECT created_by FROM conversations WHERE id = ?").get(conversationId);
  if (!conv?.created_by) throw new Error("System actor is required");
  return conv.created_by;
}

module.exports = {
  getConversationForUser,
  inviteGroupMember,
  removeGroupMember,
  sendChatMessage,
  sendConversationSystemMessage,
  sendSystemMessage
};
