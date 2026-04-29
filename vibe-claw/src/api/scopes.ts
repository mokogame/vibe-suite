export function scopeFor(method: string, url: string): string {
  if (url.startsWith("/v1/agents") && url.includes("/messages")) return "runs:write";
  if (url.startsWith("/v1/agents") && url.includes("/protocol-runs")) return "runs:write";
  if (url.startsWith("/v1/agents") && url.includes("/memories")) return method === "GET" ? "memories:read" : "memories:write";
  if (url.startsWith("/v1/memories")) return "memories:write";
  if (url.startsWith("/v1/conversations")) return "runs:read";
  if (url.startsWith("/v1/agents")) return method === "GET" ? "agents:read" : "agents:write";
  if (url.startsWith("/v1/runs")) return method === "GET" ? "runs:read" : "runs:write";
  if (url.startsWith("/v1/providers")) return method === "GET" ? "providers:read" : "providers:write";
  if (url.startsWith("/v1/queue")) return "runs:read";
  if (url.startsWith("/v1/metrics")) return "audit:read";
  if (url.startsWith("/v1/version")) return "docs:read";
  if (url.startsWith("/v1/developer-docs")) return "docs:read";
  if (url.startsWith("/v1/admin/storage-config")) return method === "GET" ? "admin:read" : "admin:write";
  if (url.startsWith("/v1/admin/restart")) return "admin:write";
  if (url.startsWith("/v1/admin/reset-data")) return "admin:write";
  if (url.startsWith("/v1/usage")) return "usage:read";
  if (url.startsWith("/v1/billing")) return "billing:read";
  if (url.startsWith("/v1/webhook-subscriptions")) return method === "GET" ? "webhooks:read" : "webhooks:write";
  if (url.startsWith("/v1/webhook-deliveries")) return method === "GET" ? "webhooks:read" : "webhooks:write";
  if (url.startsWith("/v1/tools")) return "tools:read";
  if (url.startsWith("/v1/tokens")) return method === "GET" ? "tokens:read" : "tokens:write";
  if (url.startsWith("/v1/audit-events")) return "audit:read";
  return "*";
}
