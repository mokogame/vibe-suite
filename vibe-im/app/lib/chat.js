const fs = require("node:fs");
const path = require("node:path");
const { getDb, id, now, publicUser, getUserById, getUserByUsername, uploadDir, transaction } = require("./db");
const { encryptText, decryptText } = require("./security");
const { invalidateUserReadCaches } = require("./read-cache");

const STORE_KEY = process.env.MESSAGE_STORE_KEY || "vibe-im-local-message-store-key-change-me";
function rowUser(prefix = "") {
  return `
    ${prefix}id AS id,
    ${prefix}username AS username,
    ${prefix}display_name AS display_name,
    ${prefix}avatar_url AS avatar_url,
    ${prefix}role AS role,
    ${prefix}status AS status
  `;
}

function ensureDirectConversation(userA, userB) {
  if (!userA || !userB || userA === userB) throw new Error("不能和自己发起单聊");
  const database = getDb();
  const existing = database.prepare(`
    SELECT c.*
    FROM conversations c
    JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
    JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
    WHERE c.type = 'direct'
    LIMIT 1
  `).get(userA, userB);
  if (existing) return existing;

  const createdAt = now();
  const conversationId = id();
  transaction(() => {
    database.prepare(`
      INSERT INTO conversations (id, type, title, created_by, created_at, updated_at)
      VALUES (?, 'direct', NULL, ?, ?, ?)
    `).run(conversationId, userA, createdAt, createdAt);
    for (const userId of [userA, userB]) {
      database.prepare(`
        INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at)
        VALUES (?, ?, ?, 'member', ?)
      `).run(id(), conversationId, userId, createdAt);
    }
  });
  return database.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
}

function createGroup(ownerId, name, memberUsernames = []) {
  const database = getDb();
  const createdAt = now();
  const conversationId = id();
  const groupId = id();
  const users = [ownerId];
  for (const username of memberUsernames) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) continue;
    const user = getUserByUsername(normalizedUsername);
    if (!user || user.status !== "active") throw new Error("用户不存在");
    if (user.id === ownerId) continue;
    if (!users.includes(user.id)) users.push(user.id);
    if (users.length > 200) throw new Error("群聊成员已达上限");
  }
  transaction(() => {
    database.prepare(`
      INSERT INTO conversations (id, type, title, created_by, created_at, updated_at)
      VALUES (?, 'group', ?, ?, ?, ?)
    `).run(conversationId, name, ownerId, createdAt, createdAt);
    database.prepare(`
      INSERT INTO groups (id, conversation_id, name, owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(groupId, conversationId, name, ownerId, createdAt, createdAt);
    users.forEach(userId => {
      database.prepare(`
        INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (conversation_id, user_id) DO NOTHING
      `).run(id(), conversationId, userId, userId === ownerId ? "owner" : "member", createdAt);
    });
  });
  return database.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
}

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .replace(/^@+/, "")
    .trim();
}

function areFriends(userId, friendId) {
  return Boolean(getDb().prepare(`
    SELECT id FROM friendships WHERE user_id = ? AND friend_id = ?
  `).get(userId, friendId));
}

function addFriend(userId, friendUsername) {
  const normalizedUsername = normalizeUsername(friendUsername);
  if (!normalizedUsername) throw new Error("Username is required");
  const friend = getUserByUsername(normalizedUsername);
  if (!friend || friend.status !== "active") throw new Error("User not found");
  if (friend.id === userId) throw new Error("Cannot add yourself");
  const database = getDb();
  const createdAt = now();
  transaction(() => {
    database.prepare(`
      INSERT INTO friendships (id, user_id, friend_id, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, friend_id) DO NOTHING
    `).run(id(), userId, friend.id, createdAt);
    database.prepare(`
      INSERT INTO friendships (id, user_id, friend_id, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, friend_id) DO NOTHING
    `).run(id(), friend.id, userId, createdAt);
  });
  invalidateUserReadCaches().catch(() => {});
  return publicUser(friend);
}

function listFriends(userId) {
  return getDb().prepare(`
    SELECT u.*
    FROM friendships f
    JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? AND u.status = 'active'
    ORDER BY u.display_name ASC
  `).all(userId).map(publicUser);
}

function addMemberByUsername(actorId, conversationId, username) {
  const database = getDb();
  const conv = database.prepare("SELECT type FROM conversations WHERE id = ?").get(conversationId);
  if (!conv) throw new Error("Conversation not found");
  if (conv.type !== "group") throw new Error("只有群聊可以邀请成员");

  const actor = database.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(conversationId, actorId);
  if (!actor) throw new Error("Conversation not found");
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) throw new Error("请输入 username");
  const member = getUserByUsername(normalizedUsername);
  if (!member || member.status !== "active") throw new Error("用户不存在");
  const existing = database.prepare(`
    SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?
  `).get(conversationId, member.id);
  if (existing) return { ...publicUser(member), alreadyMember: true };
  const count = database.prepare("SELECT COUNT(*) AS count FROM conversation_members WHERE conversation_id = ?").get(conversationId).count;
  if (count >= 200) throw new Error("群聊成员已达上限");
  database.prepare(`
    INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at)
    VALUES (?, ?, ?, 'member', ?)
    ON CONFLICT (conversation_id, user_id) DO NOTHING
  `).run(id(), conversationId, member.id, now());
  const actorUser = getUserById(actorId);
  const message = createSystemMessage(conversationId, actorId, `${actorUser.display_name} 邀请 ${member.display_name} 加入群聊`);
  return { ...publicUser(member), alreadyMember: false, systemMessage: message };
}

function removeMember(actorId, conversationId, memberId) {
  const database = getDb();
  const conv = database.prepare("SELECT type FROM conversations WHERE id = ?").get(conversationId);
  if (!conv) throw new Error("Conversation not found");
  if (conv.type !== "group") throw new Error("只有群聊可以移除成员");

  const actor = database.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(conversationId, actorId);
  if (!actor || !["owner", "admin"].includes(actor.role)) throw new Error("只有群聊管理员可以移除成员");
  if (actorId === memberId) throw new Error("不能移除自己");

  const target = database.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(conversationId, memberId);
  if (!target) throw new Error("成员不存在");
  if (target.role === "owner") throw new Error("不能移除群主");
  if (actor.role === "admin" && target.role === "admin") throw new Error("管理员不能移除其他管理员");

  const actorUser = getUserById(actorId);
  const targetUser = getUserById(memberId);
  database.prepare("DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?").run(conversationId, memberId);
  const message = createSystemMessage(conversationId, actorId, `${actorUser.display_name} 将 ${targetUser.display_name} 移出群聊`);
  return { ok: true, systemMessage: message };
}

function dissolveGroup(actorId, conversationId) {
  const database = getDb();
  const conv = database.prepare("SELECT type, title FROM conversations WHERE id = ?").get(conversationId);
  if (!conv) throw new Error("Conversation not found");
  if (conv.type !== "group") throw new Error("只有群聊可以解散");

  const actor = database.prepare("SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(conversationId, actorId);
  if (!actor || actor.role !== "owner") throw new Error("只有群主可以解散群聊");
  const members = database.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(conversationId).map(row => row.user_id);
  transaction(() => {
    database.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
  });
  return { ok: true, conversationId, title: conv.title || "群聊", members };
}

function deleteDirectConversation(actorId, conversationId) {
  const database = getDb();
  const conv = database.prepare("SELECT type, title FROM conversations WHERE id = ?").get(conversationId);
  if (!conv) throw new Error("Conversation not found");
  if (conv.type !== "direct") throw new Error("Only direct conversations can be deleted here");

  const actor = database.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?").get(conversationId, actorId);
  if (!actor) throw new Error("Conversation not found");

  const members = database.prepare("SELECT user_id FROM conversation_members WHERE conversation_id = ?").all(conversationId).map(row => row.user_id);
  transaction(() => {
    database.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
  });
  return { ok: true, conversationId, title: conv.title || "单聊", members };
}

function getConversationForUser(userId, conversationId) {
  const conversation = getDb().prepare(`
    SELECT c.*
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = ? AND cm.user_id = ?
  `).get(conversationId, userId);
  if (!conversation) return null;
  return conversation;
}

function listConversations(userId) {
  const rows = getDb().prepare(`
    SELECT *
    FROM (
      SELECT c.*, cm.last_read_seq,
        (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id) AS member_count,
        (SELECT MAX(seq) FROM messages m WHERE m.conversation_id = c.id) AS latest_seq,
        (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY seq DESC LIMIT 1) AS latest_content,
        (SELECT type FROM messages m WHERE m.conversation_id = c.id ORDER BY seq DESC LIMIT 1) AS latest_type,
        (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY seq DESC LIMIT 1) AS latest_at
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE cm.user_id = ?
    ) conversations_with_latest
    ORDER BY COALESCE(latest_at, updated_at) DESC
  `).all(userId);
  return rows.map(row => {
    let latestPlain = row.latest_type === "text" && row.latest_content
      ? decryptText(JSON.parse(row.latest_content), STORE_KEY)
      : row.latest_type ? `[${row.latest_type}]` : "";
    const other = row.type === "direct" ? getDirectOtherUser(userId, row.id) : null;
    return {
      id: row.id,
      type: row.type,
      title: row.type === "group" ? (row.title || "未命名群聊") : (other ? other.display_name : "单聊"),
      memberCount: row.member_count,
      latestText: latestPlain,
      latestAt: row.latest_at,
      unread: Math.max(0, Number(row.latest_seq || 0) - Number(row.last_read_seq || 0)),
      isAgent: other?.role === "agent",
      otherUser: other ? publicUser(other) : null
    };
  });
}

function conversationTitle(userId, conversation) {
  if (conversation.type === "group") return conversation.title || "未命名群聊";
  const other = getDirectOtherUser(userId, conversation.id);
  return other ? other.display_name : "单聊";
}

function getDirectOtherUser(userId, conversationId) {
  return getDb().prepare(`
    SELECT u.* FROM users u
    JOIN conversation_members cm ON cm.user_id = u.id
    WHERE cm.conversation_id = ? AND u.id != ?
    LIMIT 1
  `).get(conversationId, userId);
}

function listMembers(userId, conversationId) {
  if (!getConversationForUser(userId, conversationId)) throw new Error("Conversation not found");
  return getDb().prepare(`
    SELECT u.*, cm.role, cm.joined_at
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ?
    ORDER BY cm.joined_at ASC
  `).all(conversationId).map(row => ({ ...publicUser(row), memberRole: row.role, joinedAt: row.joined_at }));
}

function extractMentions(text) {
  const usernames = Array.from(new Set(String(text || "").match(/@([a-zA-Z0-9_]+)/g)?.map(v => v.slice(1)) || []));
  if (!usernames.length) return [];
  return usernames.map(username => getUserByUsername(username)).filter(Boolean).map(publicUser);
}

function saveAttachment(ownerId, body) {
  const dataUrl = body.data || "";
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const mime = body.mimeType || match?.[1] || "application/octet-stream";
  const raw = Buffer.from(match?.[2] || body.base64 || "", "base64");
  const limit = body.kind === "image" ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
  if (!raw.length) throw new Error("Empty file");
  if (raw.length > limit) throw new Error("File too large");
  const attachmentId = id();
  const safeName = path.basename(body.fileName || "upload.bin").replace(/[^\w.\- ]+/g, "_");
  const storagePath = path.join(uploadDir, `${attachmentId}-${safeName}`);
  fs.writeFileSync(storagePath, raw);
  getDb().prepare(`
    INSERT INTO attachments (id, owner_id, file_name, mime_type, file_size, storage_path, kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(attachmentId, ownerId, safeName, mime, raw.length, storagePath, body.kind === "image" ? "image" : "file", now());
  return getDb().prepare("SELECT * FROM attachments WHERE id = ?").get(attachmentId);
}

function lockConversationMessageSequence(database, conversationId) {
  database.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(conversationId);
}

function createMessage(senderId, conversationId, input) {
  const database = getDb();
  const conv = getConversationForUser(senderId, conversationId);
  if (!conv) throw new Error("Conversation not found");
  let content = null;
  let attachmentId = null;
  let mentions = [];
  if (input.type === "text") {
    const plain = input.text || "";
    mentions = extractMentions(plain);
    content = JSON.stringify(encryptText(plain, STORE_KEY));
  } else {
    attachmentId = input.attachmentId;
  }
  const messageId = id();
  const createdAt = now();
  transaction(() => {
    lockConversationMessageSequence(database, conversationId);
    const seq = Number(database.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM messages WHERE conversation_id = ?").get(conversationId).next_seq);
    database.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, seq, type, content, attachment_id, reply_to_id, mentions_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(messageId, conversationId, senderId, seq, input.type, content, attachmentId, input.replyToId || null, JSON.stringify(mentions), createdAt);
    database.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(createdAt, conversationId);
  });
  return getMessage(messageId);
}

function updateTextMessage(senderId, messageId, text) {
  const database = getDb();
  const row = database.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
  if (!row) throw new Error("Message not found");
  if (row.sender_id !== senderId) throw new Error("Only sender can update message");
  if (row.type !== "text") throw new Error("Only text messages can be updated");
  const content = JSON.stringify(encryptText(text || "", STORE_KEY));
  const mentions = extractMentions(text || "");
  database.prepare("UPDATE messages SET content = ?, mentions_json = ? WHERE id = ?").run(content, JSON.stringify(mentions), messageId);
  return getMessage(messageId);
}

function createSystemMessage(conversationId, senderId, text) {
  const database = getDb();
  const messageId = id();
  const createdAt = now();
  transaction(() => {
    lockConversationMessageSequence(database, conversationId);
    const seq = Number(database.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM messages WHERE conversation_id = ?").get(conversationId).next_seq);
    database.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, seq, type, content, attachment_id, reply_to_id, mentions_json, created_at)
      VALUES (?, ?, ?, ?, 'system', ?, NULL, NULL, '[]', ?)
    `).run(messageId, conversationId, senderId, seq, text, createdAt);
    database.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(createdAt, conversationId);
  });
  return getMessage(messageId);
}

function getGroupConversation(conversationId) {
  const conv = getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
  if (!conv) throw new Error("Conversation not found");
  if (conv.type !== "group") throw new Error("Only group conversations support members");
  return conv;
}

function systemActorForConversation(conversationId, actorId = null) {
  if (actorId) return actorId;
  const conv = getDb().prepare("SELECT created_by FROM conversations WHERE id = ?").get(conversationId);
  if (!conv?.created_by) throw new Error("System actor is required");
  return conv.created_by;
}

function ensureGroupMember(conversationId, userId, input = {}) {
  const database = getDb();
  getGroupConversation(conversationId);
  const member = getUserById(userId);
  if (!member) throw new Error("Group member not found");
  const timestamp = input.joinedAt || now();
  const result = database.prepare(`
    INSERT INTO conversation_members (id, conversation_id, user_id, role, joined_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (conversation_id, user_id) DO NOTHING
  `).run(id(), conversationId, userId, input.role || "member", timestamp);
  return { member, joined: Boolean(result.changes) };
}

function getMessage(messageId) {
  return getDb().prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar_url, u.role, u.status,
      a.file_name, a.mime_type, a.file_size, a.kind
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN attachments a ON a.id = m.attachment_id
    WHERE m.id = ?
  `).get(messageId);
}

function serializeMessage(row, transportKey) {
  const sender = publicUser({
    id: row.sender_id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    role: row.role,
    status: row.status
  });
  let encryptedText = null;
  if (row.type === "text" && row.content) {
    const plain = decryptText(JSON.parse(row.content), STORE_KEY);
    encryptedText = encryptText(plain, transportKey);
  }
  const conversation = getDb().prepare("SELECT type FROM conversations WHERE id = ?").get(row.conversation_id);
  const mentions = JSON.parse(row.mentions_json || "[]");
  return {
    id: row.id,
    conversationId: row.conversation_id,
    conversationType: conversation?.type || null,
    sender,
    seq: row.seq,
    type: row.type,
    systemText: row.type === "system" ? row.content : null,
    encryptedText,
    attachment: row.attachment_id ? {
      id: row.attachment_id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSize: row.file_size,
      kind: row.kind,
      url: `/api/files/${row.attachment_id}`
    } : null,
    replyToId: row.reply_to_id,
    mentions,
    createdAt: row.created_at
  };
}

function listMessages(userId, conversationId, transportKey, afterSeq = 0, limit = 80) {
  if (!getConversationForUser(userId, conversationId)) throw new Error("Conversation not found");
  return getDb().prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar_url, u.role, u.status,
      a.file_name, a.mime_type, a.file_size, a.kind
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    LEFT JOIN attachments a ON a.id = m.attachment_id
    WHERE m.conversation_id = ? AND m.seq > ?
    ORDER BY m.seq ASC
    LIMIT ?
  `).all(conversationId, Number(afterSeq), Number(limit)).map(row => serializeMessage(row, transportKey));
}

function markRead(userId, conversationId, seq) {
  getDb().prepare(`
    UPDATE conversation_members
    SET last_read_seq = GREATEST(last_read_seq, ?)
    WHERE conversation_id = ? AND user_id = ?
  `).run(Number(seq), conversationId, userId);
}

module.exports = {
  ensureDirectConversation,
  createGroup,
  addMemberByUsername,
  removeMember,
  dissolveGroup,
  deleteDirectConversation,
  addFriend,
  listFriends,
  areFriends,
  getConversationForUser,
  listConversations,
  listMembers,
  saveAttachment,
  createMessage,
  updateTextMessage,
  createSystemMessage,
  ensureGroupMember,
  getMessage,
  serializeMessage,
  listMessages,
  markRead
};
