const { requireAuth } = require("../../../../lib/http");
const { listMessages, saveAttachment, serializeMessage } = require("../../../../lib/chat");
const { sendChatMessage } = require("../../../../lib/chat-service");
const { decryptText } = require("../../../../lib/security");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "60mb"
    }
  }
};

export default function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const conversationId = req.query.id;
  try {
    if (req.method === "GET") {
      const messages = listMessages(auth.user.id, conversationId, auth.transportKey, req.query.afterSeq || 0, req.query.limit || 80);
      return res.json({ messages });
    }
    if (req.method === "POST") {
      const { type, encryptedText, attachment, attachmentId, replyToId } = req.body || {};
      let finalAttachmentId = attachmentId;
      if ((type === "image" || type === "file") && attachment) {
        finalAttachmentId = saveAttachment(auth.user.id, { ...attachment, kind: type }).id;
      }
      const text = type === "text" ? decryptText(encryptedText, auth.transportKey) : "";
      const row = sendChatMessage(auth.user.id, conversationId, { type, text, attachmentId: finalAttachmentId, replyToId });
      return res.json({ message: serializeMessage(row, auth.transportKey) });
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
