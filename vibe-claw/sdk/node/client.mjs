export class VibeClawClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.message || body.error || "Vibe Claw request failed"), { response: body, status: response.status });
    return body;
  }

  listAgents() {
    return this.request("/v1/agents");
  }

  createAgent(input) {
    return this.request("/v1/agents", { method: "POST", body: JSON.stringify(input) });
  }

  sendMessage(agentId, input) {
    return this.request(`/v1/agents/${agentId}/messages`, { method: "POST", body: JSON.stringify(input) });
  }

  createRun(input, idempotencyKey) {
    return this.request("/v1/runs", { method: "POST", headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {}, body: JSON.stringify(input) });
  }
}
