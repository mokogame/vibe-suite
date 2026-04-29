const { requireAuth } = require("../../../../../lib/http");
const { startAgentConversation } = require("../../../../../lib/vibe-claw");

export default async function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  try {
    if (req.method === "POST") {
      const result = await startAgentConversation(auth.user.id, req.query.id);
      return res.json(result);
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    res.status(error.status || 400).json({
      error: error.message,
      code: error.code || "VIBE_CLAW_AGENT_START_ERROR"
    });
  }
}
