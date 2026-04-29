const fs = require("node:fs");
const { getAuth } = require("../../../lib/http");
const { getDb } = require("../../../lib/db");

function getFileUserId(req) {
  const auth = getAuth(req);
  if (auth) return auth.user.id;
  return null;
}

export default function handler(req, res) {
  const userId = getFileUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const attachment = getDb().prepare(`
    SELECT a.*
    FROM attachments a
    JOIN messages m ON m.attachment_id = a.id
    JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
    WHERE a.id = ?
    LIMIT 1
  `).get(userId, req.query.id);
  if (!attachment || !fs.existsSync(attachment.storage_path)) return res.status(404).json({ error: "File not found" });
  res.setHeader("Content-Type", attachment.mime_type);
  res.setHeader("Content-Length", attachment.file_size);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.file_name)}"`);
  fs.createReadStream(attachment.storage_path).pipe(res);
};
