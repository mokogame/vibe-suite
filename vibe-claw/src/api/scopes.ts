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
  if (url.startsWith("/v1/tools")) return "tools:read";
  if (url.startsWith("/v1/tokens")) return method === "GET" ? "tokens:read" : "tokens:write";
  if (url.startsWith("/v1/audit-events")) return "audit:read";
  return "*";
}
