const { requireAuth } = require("../../../../lib/http");
const { syncVibeClawAgents, listMappedAgents, publicConfig, diagnoseVibeClaw } = require("../../../../lib/vibe-claw");

export default async function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  try {
    if (req.method === "GET") {
      const sync = req.query.sync !== "0";
      const health = await diagnoseVibeClaw();
      const agents = sync && health.ok ? await syncVibeClawAgents() : listMappedAgents();
      return res.json({ agents, config: publicConfig(), health });
    }
    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    res.status(error.status || 400).json({
      error: error.message,
      code: error.code || "VIBE_CLAW_AGENTS_ERROR"
    });
  }
}
