import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { mkdir } from "node:fs/promises";

export type StorageMode = "memory" | "postgres";

export type RuntimeStorageConfig = {
  storageMode: StorageMode;
  activeStoreType?: string;
  databaseUrlConfigured: boolean;
  databaseUrlMasked: string | null;
  configPath: string;
  requiresRestart: boolean;
  externalEnvActive: boolean;
  warning: string | null;
};

const STORAGE_MODE_KEY = "VIBE_CLAW_STORAGE_MODE";
const DATABASE_URL_KEY = "VIBE_CLAW_DATABASE_URL";

export function runtimeConfigPath(): string {
  return process.env.VIBE_CLAW_RUNTIME_CONFIG_PATH || join(process.cwd(), ".env.local");
}

export async function loadRuntimeEnv(): Promise<void> {
  const entries = await readRuntimeEnvFile();
  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export async function readRuntimeStorageConfig(activeStoreType?: string): Promise<RuntimeStorageConfig> {
  const entries = await readRuntimeEnvFile();
  const explicitMode = normalizeStorageMode(entries[STORAGE_MODE_KEY] ?? process.env[STORAGE_MODE_KEY]);
  const configuredDatabaseUrl = entries[DATABASE_URL_KEY] ?? process.env[DATABASE_URL_KEY] ?? process.env.DATABASE_URL ?? "";
  const storageMode = explicitMode ?? (configuredDatabaseUrl ? "postgres" : "memory");
  const externalEnvActive = Boolean(process.env[DATABASE_URL_KEY] || process.env.DATABASE_URL || process.env[STORAGE_MODE_KEY]);
  return buildStorageConfig(storageMode, configuredDatabaseUrl, activeStoreType, externalEnvActive);
}

export async function saveRuntimeStorageConfig(input: { storageMode: StorageMode; databaseUrl?: string }, activeStoreType?: string): Promise<RuntimeStorageConfig> {
  const entries = await readRuntimeEnvFile();
  entries[STORAGE_MODE_KEY] = input.storageMode;
  if (input.storageMode === "postgres") {
    const databaseUrl = input.databaseUrl?.trim() || entries[DATABASE_URL_KEY] || process.env[DATABASE_URL_KEY] || process.env.DATABASE_URL || "";
    if (!databaseUrl) throw Object.assign(new Error("Postgres 模式必须填写数据库连接串"), { statusCode: 400 });
    entries[DATABASE_URL_KEY] = databaseUrl;
  } else {
    delete entries[DATABASE_URL_KEY];
  }
  await writeRuntimeEnvFile(entries);
  const externalEnvActive = Boolean(process.env[DATABASE_URL_KEY] || process.env.DATABASE_URL || process.env[STORAGE_MODE_KEY]);
  return buildStorageConfig(input.storageMode, entries[DATABASE_URL_KEY] ?? "", activeStoreType, externalEnvActive);
}

function buildStorageConfig(storageMode: StorageMode, databaseUrl: string, activeStoreType?: string, externalEnvActive = false): RuntimeStorageConfig {
  const memoryWarning = storageMode === "memory"
    ? "当前配置为内存模式，服务重启或热更新后 Provider、Agent、会话和记忆会丢失；正式 SaaS/API 服务应切换到 Postgres。"
    : null;
  const restartWarning = activeStoreType && activeStoreType !== storageMode
    ? `当前运行中的存储为 ${activeStoreType}，保存后的配置为 ${storageMode}，需要重启服务后生效。`
    : null;
  return {
    storageMode,
    activeStoreType,
    databaseUrlConfigured: Boolean(databaseUrl),
    databaseUrlMasked: databaseUrl ? maskDatabaseUrl(databaseUrl) : null,
    configPath: displayConfigPath(runtimeConfigPath()),
    requiresRestart: Boolean(activeStoreType && activeStoreType !== storageMode),
    externalEnvActive,
    warning: restartWarning ?? memoryWarning
  };
}

async function readRuntimeEnvFile(): Promise<Record<string, string>> {
  try {
    return parseEnv(await readFile(runtimeConfigPath(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeRuntimeEnvFile(entries: Record<string, string>): Promise<void> {
  const path = runtimeConfigPath();
  await mkdir(dirname(path), { recursive: true });
  const body = Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n");
  await writeFile(path, body ? `${body}\n` : "", "utf8");
}

function parseEnv(text: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    entries[key] = parseEnvValue(raw);
  }
  return entries;
}

function parseEnvValue(raw: string): string {
  if (!raw) return "";
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    if (raw.startsWith('"')) {
      try {
        return JSON.parse(raw) as string;
      } catch {
        return raw.slice(1, -1);
      }
    }
    return raw.slice(1, -1);
  }
  const commentIndex = raw.indexOf(" #");
  return (commentIndex >= 0 ? raw.slice(0, commentIndex) : raw).trim();
}

function normalizeStorageMode(value?: string): StorageMode | null {
  if (value === "memory" || value === "postgres") return value;
  return null;
}

function maskDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) url.password = "********";
    if (url.username) url.username = maskShort(url.username);
    return url.toString();
  } catch {
    if (value.length <= 12) return maskShort(value);
    return `${value.slice(0, 6)}***********************${value.slice(-4)}`;
  }
}

function maskShort(value: string): string {
  if (!value) return "";
  if (value.length <= 2) return "**";
  return `${value[0]}***${value[value.length - 1]}`;
}

function displayConfigPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
}
