const NOTION_DATABASE_ID = "33da7f1b413c803ab06fe6cf4e569639";
const NOTION_VERSION = "2022-06-28";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const notionToken = process.env.notion_api || process.env.NOTION_API;
  if (!notionToken) {
    return res.status(500).json({ error: "Missing Notion token in environment variables." });
  }

  try {
    const payload = normalizePayload(req.body);

    const notionResponse = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties: {
          Session_ID: {
            title: [
              {
                text: {
                  content: payload.sessionId,
                },
              },
            ],
          },
          Timestamp_Start: {
            date: {
              start: payload.timestampStart,
            },
          },
          Session_Duration_Sec: {
            number: payload.sessionDurationSec,
          },
          Energy_RMS_dB: {
            number: payload.energyRmsDb,
          },
          Energy_Peak_Max: {
            number: payload.energyPeakMax,
          },
          Pitch_Variance_Hz: {
            number: payload.pitchVarianceHz,
          },
          Pacing_Attack_Rate: {
            number: payload.pacingAttackRate,
          },
          Silence_Ratio: {
            number: payload.silenceRatio,
          },
          Calculated_Entropy: {
            number: payload.calculatedEntropy,
          },
        },
      }),
    });

    const notionData = await notionResponse.json();

    if (!notionResponse.ok) {
      return res.status(notionResponse.status).json({
        error: "Failed to create Notion page.",
        notion: notionData,
      });
    }

    return res.status(200).json({
      ok: true,
      pageId: notionData.id,
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid request payload.",
    });
  }
};

function normalizePayload(body = {}) {
  const payload = {
    sessionId: String(body.sessionId || "").trim(),
    timestampStart: String(body.timestampStart || "").trim(),
    sessionDurationSec: toFiniteNumber(body.sessionDurationSec),
    energyRmsDb: toFiniteNumber(body.energyRmsDb),
    energyPeakMax: toFiniteNumber(body.energyPeakMax),
    pitchVarianceHz: toFiniteNumber(body.pitchVarianceHz),
    pacingAttackRate: toFiniteNumber(body.pacingAttackRate),
    silenceRatio: toFiniteNumber(body.silenceRatio),
    calculatedEntropy: toFiniteNumber(body.calculatedEntropy),
  };

  if (!payload.sessionId) {
    throw new Error("`sessionId` is required.");
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
