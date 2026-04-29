import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { newId, nowIso } from "../core/ids.js";
import { DEFAULT_PROJECT_ID, DEFAULT_TENANT_ID, type ApiToken, type AuthActor, type ResourceScope } from "../types.js";
import type { Store } from "../store/store.js";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createPlainToken(): string {
  return `vcl_${randomBytes(24).toString("base64url")}`;
}

export class TokenRegistry {
  constructor(private readonly store: Store) {}

  async registerPlainToken(name: string, token: string, scopes: string[] = ["*"], scope: ResourceScope = {}, options: { expiresAt?: string | null; allowedIps?: string[] } = {}): Promise<ApiToken> {
    return this.store.addToken({
      id: newId("token"),
      tenantId: scope.tenantId ?? DEFAULT_TENANT_ID,
      projectId: scope.projectId ?? DEFAULT_PROJECT_ID,
      tokenHash: hashToken(token),
      name,
      scopes,
      status: "active",
      expiresAt: options.expiresAt ?? null,
      allowedIps: options.allowedIps ?? [],
      lastUsedAt: null,
      lastUsedIp: null,
      createdAt: nowIso(),
      revokedAt: null
    });
  }

  async createToken(name: string, scopes: string[], scope: ResourceScope = {}, options: { expiresAt?: string | null; allowedIps?: string[] } = {}): Promise<{ token: ApiToken; plainToken: string }> {
    const plainToken = createPlainToken();
    const token = await this.registerPlainToken(name, plainToken, scopes, scope, options);
    return { token, plainToken };
  }

  async authenticate(token: string, requiredScope: string, ip?: string | null): Promise<AuthActor | null> {
    const incoming = Buffer.from(hashToken(token));
    const tokens = await this.store.listTokens();
    const matched = tokens.find((candidate) => {
      const expected = Buffer.from(candidate.tokenHash);
      return expected.length === incoming.length && timingSafeEqual(expected, incoming);
    });

    if (!matched || matched.status !== "active") return null;
    if (matched.expiresAt && matched.expiresAt <= nowIso()) return null;
    if (matched.allowedIps.length > 0 && (!ip || !matched.allowedIps.includes(ip))) return null;
    if (!hasScope(matched.scopes, requiredScope)) return null;
    await this.store.markTokenUsed(matched.id, nowIso(), ip ?? null);
    return {
      tokenId: matched.id,
      name: matched.name,
      scopes: matched.scopes,
      tenantId: matched.tenantId ?? DEFAULT_TENANT_ID,
      projectId: matched.projectId ?? DEFAULT_PROJECT_ID
    };
  }
}

function hasScope(scopes: string[], requiredScope: string): boolean {
  if (scopes.includes("*")) return true;
  if (scopes.includes(requiredScope)) return true;
  const [resource] = requiredScope.split(":");
  return scopes.includes(`${resource}:*`);
}
