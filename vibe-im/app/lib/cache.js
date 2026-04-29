const { createClient } = require("redis");

const CACHE_KEY = Symbol.for("vibe-im.cache");
const state = globalThis[CACHE_KEY] || {
  client: null,
  connecting: null,
  disabledUntil: 0,
  memory: new Map()
};
globalThis[CACHE_KEY] = state;

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const KEY_PREFIX = process.env.CACHE_PREFIX || "vibe-im";

function namespaced(key) {
  return `${KEY_PREFIX}:${key}`;
}

function getMemory(key) {
  const item = state.memory.get(key);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    state.memory.delete(key);
    return null;
  }
  return item.value;
}

function setMemory(key, value, ttlSeconds) {
  state.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function getClient() {
  if (Date.now() < state.disabledUntil) return null;
  if (state.client?.isOpen) return state.client;
  if (!state.connecting) {
    state.client = createClient({ url: REDIS_URL });
    state.client.on("error", () => {
      state.disabledUntil = Date.now() + 5000;
    });
    state.connecting = state.client.connect()
      .then(() => state.client)
      .catch(() => {
        state.disabledUntil = Date.now() + 5000;
        state.client = null;
        return null;
      })
      .finally(() => {
        state.connecting = null;
      });
  }
  return state.connecting;
}

async function getJson(key) {
  const fullKey = namespaced(key);
  const cached = getMemory(fullKey);
  if (cached !== null) return cached;
  const client = await getClient();
  if (!client) return null;
  try {
    const value = await client.get(fullKey);
    if (!value) return null;
    const parsed = JSON.parse(value);
    setMemory(fullKey, parsed, 1);
    return parsed;
  } catch {
    return null;
  }
}

async function setJson(key, value, ttlSeconds) {
  const fullKey = namespaced(key);
  setMemory(fullKey, value, ttlSeconds);
  const client = await getClient();
  if (!client) return;
  try {
    await client.set(fullKey, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    // Memory fallback already contains the value.
  }
}

async function del(key) {
  const fullKey = namespaced(key);
  state.memory.delete(fullKey);
  const client = await getClient();
  if (!client) return;
  try {
    await client.del(fullKey);
  } catch {}
}

async function delByPrefix(prefix) {
  const fullPrefix = namespaced(prefix);
  for (const key of state.memory.keys()) {
    if (key.startsWith(fullPrefix)) state.memory.delete(key);
  }
  const client = await getClient();
  if (!client) return;
  try {
    const keys = [];
    for await (const key of client.scanIterator({ MATCH: `${fullPrefix}*`, COUNT: 100 })) {
      keys.push(key);
      if (keys.length >= 100) {
        await client.del(keys.splice(0, keys.length));
      }
    }
    if (keys.length) await client.del(keys);
  } catch {}
}

async function getOrSetJson(key, ttlSeconds, producer) {
  const cached = await getJson(key);
  if (cached !== null) return { value: cached, cacheHit: true };
  const value = await producer();
  await setJson(key, value, ttlSeconds);
  return { value, cacheHit: false };
}

module.exports = {
  getJson,
  setJson,
  del,
  delByPrefix,
  getOrSetJson
};
