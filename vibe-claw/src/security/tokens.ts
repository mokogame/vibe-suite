import { createHash, timingSafeEqual } from "node:crypto";
import { newId, nowIso } from "../core/ids.js";
import type { ApiToken, AuthActor } from "../types.js";
import type { MemoryStore } from "../store/memory-store.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class TokenRegistry {
  constructor(private readonly store: MemoryStore) {}

  registerPlainToken(name: string, token: string, scopes: string[] = ["*"]): ApiToken {
    return this.store.addToken({
      id: newId("token"),
      tokenHash: hashToken(token),
      name,
      scopes,
      status: "active",
      createdAt: nowIso(),
      revokedAt: null
    });
  }

  authenticate(token: string, requiredScope: string): AuthActor | null {
    const incoming = Buffer.from(hashToken(token));
    const matched = this.store.listTokens().find((candidate) => {
      const expected = Buffer.from(candidate.tokenHash);
      return expected.length === incoming.length && timingSafeEqual(expected, incoming);
    });

    if (!matched || matched.status !== "active") return null;
    if (!hasScope(matched.scopes, requiredScope)) return null;
    return { tokenId: matched.id, name: matched.name, scopes: matched.scopes };
  }
}

function hasScope(scopes: string[], requiredScope: string): boolean {
  if (scopes.includes("*")) return true;
  if (scopes.includes(requiredScope)) return true;
  const [resource] = requiredScope.split(":");
  return scopes.includes(`${resource}:*`);
}
