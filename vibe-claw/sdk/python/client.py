from __future__ import annotations

import json
import urllib.request


class VibeClawClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, path: str, method: str = "GET", body: dict | None = None, headers: dict | None = None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {self.token}",
                **(headers or {}),
            },
        )
        try:
            with urllib.request.urlopen(request) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            payload = json.loads(exc.read().decode("utf-8") or "{}")
            raise RuntimeError(payload.get("message") or payload.get("error") or "Vibe Claw request failed") from exc

    def list_agents(self):
        return self.request("/v1/agents")

    def create_agent(self, payload: dict):
        return self.request("/v1/agents", "POST", payload)

    def send_message(self, agent_id: str, payload: dict):
        return self.request(f"/v1/agents/{agent_id}/messages", "POST", payload)

    def create_run(self, payload: dict, idempotency_key: str | None = None):
        headers = {"idempotency-key": idempotency_key} if idempotency_key else None
        return self.request("/v1/runs", "POST", payload, headers)
