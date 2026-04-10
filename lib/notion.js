const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || "33da7f1b413c803ab06fe6cf4e569639";
const NOTION_VERSION = "2022-06-28";

function getNotionToken() {
  return process.env.notion_api || process.env.NOTION_API || "";
}

function getSessionDatabaseId() {
  return NOTION_DATABASE_ID;
}

async function notionFetch(path, options = {}) {
  const notionToken = getNotionToken();
  if (!notionToken) {
    throw new Error("Missing Notion token in environment variables.");
  }

  const response = await fetch(`https://api.notion.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...(options.headers || {}),
    },
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.message || "Notion request failed.";
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

async function createSessionPage(payload) {
  return notionFetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        Session_ID: {
          title: [{ text: { content: payload.sessionId } }],
        },
        User_ID: {
          rich_text: [{ text: { content: payload.userId } }],
        },
        Timestamp_Start: {
          date: { start: payload.timestampStart },
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
}

async function querySessionsByUser(userId, limit = 24) {
  const data = await notionFetch(`/v1/databases/${NOTION_DATABASE_ID}/query`, {
    method: "POST",
    body: JSON.stringify({
      page_size: limit,
      filter: {
        property: "User_ID",
        rich_text: {
          equals: userId,
        },
      },
      sorts: [
        {
          property: "Timestamp_Start",
          direction: "descending",
        },
      ],
    }),
  });

  return (data.results || []).map(parseSessionPage);
}

function parseSessionPage(page) {
  const properties = page.properties || {};

  return {
    pageId: page.id,
    sessionId: readTitle(properties.Session_ID),
    userId: readRichText(properties.User_ID),
    timestampStart: readDate(properties.Timestamp_Start),
    sessionDurationSec: readNumber(properties.Session_Duration_Sec),
    energyRmsDb: readNumber(properties.Energy_RMS_dB),
    energyPeakMax: readNumber(properties.Energy_Peak_Max),
    pitchVarianceHz: readNumber(properties.Pitch_Variance_Hz),
    pacingAttackRate: readNumber(properties.Pacing_Attack_Rate),
    silenceRatio: readNumber(properties.Silence_Ratio),
    calculatedEntropy: readNumber(properties.Calculated_Entropy),
  };
}

function readTitle(property) {
  return (property?.title || []).map((item) => item.plain_text || "").join("").trim();
}

function readRichText(property) {
  return (property?.rich_text || []).map((item) => item.plain_text || "").join("").trim();
}

function readNumber(property) {
  return Number.isFinite(property?.number) ? property.number : 0;
}

function readDate(property) {
  return property?.date?.start || null;
}

module.exports = {
  createSessionPage,
  getSessionDatabaseId,
  querySessionsByUser,
};
