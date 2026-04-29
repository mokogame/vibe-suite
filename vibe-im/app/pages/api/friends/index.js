const { requireAuth } = require("../../../lib/http");
const { addFriend, listFriends } = require("../../../lib/chat");
const { getJson, setJson } = require("../../../lib/cache");
const { invalidateUserReadCaches, makeUserGraphCacheKey } = require("../../../lib/read-cache");

export default async function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  try {
    if (req.method === "GET") {
      const cacheKey = await makeUserGraphCacheKey("friends", auth.user.id);
      const cached = await getJson(cacheKey);
      if (cached) return res.json({ friends: cached, cache: "hit" });
      const friends = listFriends(auth.user.id);
      await setJson(cacheKey, friends, 30);
      return res.json({ friends });
    }
    if (req.method === "POST") {
      const friend = addFriend(auth.user.id, req.body?.username);
      await invalidateUserReadCaches();
      return res.json({ friend });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
}
