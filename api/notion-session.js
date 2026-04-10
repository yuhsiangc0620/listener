const { createSessionPage, querySessionsByUser } = require("../lib/notion");
const { DEFAULT_PROFILE, synthesizeFlameProfile } = require("../lib/gemini");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const payload = normalizePayload(req.body);
    const notionData = await createSessionPage(payload);
    let profile = { ...DEFAULT_PROFILE, sampleCount: 0, source: "default", updatedAt: new Date().toISOString() };
    let learningWarning = null;

    try {
      const sessions = await querySessionsByUser(payload.userId);
      profile = sessions.length
        ? await synthesizeFlameProfile(sessions)
        : profile;
    } catch (error) {
      learningWarning = error instanceof Error ? error.message : "Failed to learn flame profile.";
    }

    return res.status(200).json({
      ok: true,
      pageId: notionData.id,
      profile,
      learningWarning,
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 400;
    return res.status(status).json({
      error: error instanceof Error ? error.message : "Invalid request payload.",
      details: error?.payload || null,
    });
  }
};

function normalizePayload(body = {}) {
  const rawBody = typeof body === "string" ? JSON.parse(body) : body;
  const payload = {
    sessionId: String(rawBody.sessionId || "").trim(),
    userId: String(rawBody.userId || "").trim(),
    timestampStart: String(rawBody.timestampStart || "").trim(),
    sessionDurationSec: toFiniteNumber(rawBody.sessionDurationSec),
    energyRmsDb: toFiniteNumber(rawBody.energyRmsDb),
    energyPeakMax: toFiniteNumber(rawBody.energyPeakMax),
    pitchVarianceHz: toFiniteNumber(rawBody.pitchVarianceHz),
    pacingAttackRate: toFiniteNumber(rawBody.pacingAttackRate),
    silenceRatio: toFiniteNumber(rawBody.silenceRatio),
    calculatedEntropy: toFiniteNumber(rawBody.calculatedEntropy),
  };

  if (!payload.sessionId) {
    throw new Error("`sessionId` is required.");
  }

  if (!payload.userId) {
    throw new Error("`userId` is required.");
  }

  if (!payload.timestampStart || Number.isNaN(Date.parse(payload.timestampStart))) {
    throw new Error("`timestampStart` must be a valid ISO date string.");
  }

  return payload;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error("All numeric fields must be valid numbers.");
  }
  return numeric;
}
