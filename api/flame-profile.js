const { querySessionsByUser } = require("../lib/notion");
const { DEFAULT_PROFILE, synthesizeFlameProfile } = require("../lib/gemini");

const profileCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 10;

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const userId = String(req.query?.userId || "").trim();
  if (!userId) {
    return res.status(400).json({ error: "`userId` is required." });
  }

  try {
    const cached = getCachedProfile(userId);
    if (cached) {
      return res.status(200).json({ ok: true, profile: cached, cached: true });
    }

    const sessions = await querySessionsByUser(userId);
    const profile = sessions.length
      ? await synthesizeFlameProfile(sessions)
      : { ...DEFAULT_PROFILE, sampleCount: 0, source: "default", updatedAt: new Date().toISOString() };

    profileCache.set(userId, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      profile,
    });

    return res.status(200).json({ ok: true, profile, cached: false });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: error instanceof Error ? error.message : "Failed to fetch flame profile.",
      details: error?.payload || null,
    });
  }
};

function getCachedProfile(userId) {
  const record = profileCache.get(userId);
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    profileCache.delete(userId);
    return null;
  }
  return record.profile;
}
