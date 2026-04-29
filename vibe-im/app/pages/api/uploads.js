const { requireAuth } = require("../../lib/http");
const { saveAttachment } = require("../../lib/chat");

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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { kind, fileName, mimeType, data, base64 } = req.body || {};
    if (!["image", "file"].includes(kind)) return res.status(400).json({ error: "Invalid upload kind" });
    const attachment = saveAttachment(auth.user.id, { kind, fileName, mimeType, data, base64 });
    return res.json({
      attachment: {
        id: attachment.id,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
        fileSize: attachment.file_size,
        kind: attachment.kind,
        url: `/api/files/${attachment.id}`
      }
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
