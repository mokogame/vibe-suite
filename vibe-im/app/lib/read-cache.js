const { getJson, setJson } = require("./cache");

const USER_GRAPH_VERSION_KEY = "version:user-graph:v1";
const VERSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function sanitizePart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .slice(0, 120);
}

async function getUserGraphVersion() {
  return (await getJson(USER_GRAPH_VERSION_KEY)) || "1";
}

async function makeUserGraphCacheKey(kind, ...parts) {
  const version = await getUserGraphVersion();
  return [kind, `v${version}`, ...parts.map(sanitizePart)].join(":");
}

async function invalidateUserReadCaches() {
  const version = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await setJson(USER_GRAPH_VERSION_KEY, version, VERSION_TTL_SECONDS);
  return version;
}

module.exports = {
  getUserGraphVersion,
  makeUserGraphCacheKey,
  invalidateUserReadCaches
};
