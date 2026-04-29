const { requireAdmin } = require("../../../lib/http");
const { publicConfig, saveConfig, diagnoseVibeClaw } = require("../../../lib/vibe-claw");

export default async function handler(req, res) {
  const auth = requireAdmin(req, res);
  if (!auth) return;

  try {
    if (req.method === "GET") {
      const health = await diagnoseVibeClaw();
      return res.json({ config: publicConfig(), health });
    }
    if (req.method === "PATCH") {
      const config = saveConfig(req.body || {});
      const health = await diagnoseVibeClaw();
      return res.json({ ok: true, config, health });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(400).json({ error: error.message, code: error.code || "VIBE_CLAW_CONFIG_ERROR" });
  }
}
