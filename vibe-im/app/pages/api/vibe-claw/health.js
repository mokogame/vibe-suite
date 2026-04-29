const { requireAuth } = require("../../../lib/http");
const { diagnoseVibeClaw } = require("../../../lib/vibe-claw");

export default async function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const health = await diagnoseVibeClaw();
  return res.status(health.ok ? 200 : 200).json({ health });
}
