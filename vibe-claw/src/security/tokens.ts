import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { newId, nowIso } from "../core/ids.js";
import type { ApiToken, AuthActor } from "../types.js";
import type { Store } from "../store/store.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createPlainToken(): string {
  return `vcl_${randomBytes(24).toString("base64url")}`;
}

export class TokenRegistry {
  constructor(private readonly store: Store) {}

  async registerPlainToken(name: string, token: string, scopes: string[] = ["*"]): Promise<ApiToken> {
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

  async createToken(name: string, scopes: string[]): Promise<{ token: ApiToken; plainToken: string }> {
    const plainToken = createPlainToken();
    const token = await this.registerPlainToken(name, plainToken, scopes);
    return { token, plainToken };
  }

  async authenticate(token: string, requiredScope: string): Promise<AuthActor | null> {
    const incoming = Buffer.from(hashToken(token));
    const tokens = await this.store.listTokens();
    const matched = tokens.find((candidate) => {
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
