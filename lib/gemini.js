const DEFAULT_PROFILE = Object.freeze({
  sizeScale: 1,
  edgeParticleScale: 0.22,
  shapeAmplitude: 0.136,
  shapeFrequencyBias: 1,
  warmthBias: 0,
});

function getGeminiKey() {
  return process.env.gemini_api || process.env.GEMINI_API || "";
}

async function synthesizeFlameProfile(sessions) {
  const summary = summarizeSessions(sessions);
  const heuristicProfile = buildHeuristicProfile(summary);

  if (sessions.length < 4 || !getGeminiKey()) {
    return finalizeProfile(heuristicProfile, summary, "heuristic");
  }

  try {
    const geminiProfile = await requestGeminiProfile(summary, heuristicProfile);
    return finalizeProfile({ ...heuristicProfile, ...geminiProfile }, summary, "gemini");
  } catch {
    return finalizeProfile(heuristicProfile, summary, "heuristic");
  }
}

function summarizeSessions(sessions) {
  const sampleCount = sessions.length;
  if (!sampleCount) {
    return {
      sampleCount: 0,
      averageRmsDb: -42,
      averagePeakMax: 0.12,
      averagePitchVarianceHz: 120,
      averageAttackRate: 0.12,
      averageSilenceRatio: 0.34,
      averageEntropy: 0.2,
      averageDurationSec: 8,
    };
  }

  return {
    sampleCount,
    averageRmsDb: average(sessions.map((session) => session.energyRmsDb)),
    averagePeakMax: average(sessions.map((session) => session.energyPeakMax)),
    averagePitchVarianceHz: average(sessions.map((session) => session.pitchVarianceHz)),
    averageAttackRate: average(sessions.map((session) => session.pacingAttackRate)),
    averageSilenceRatio: average(sessions.map((session) => session.silenceRatio)),
    averageEntropy: average(sessions.map((session) => session.calculatedEntropy)),
    averageDurationSec: average(sessions.map((session) => session.sessionDurationSec)),
  };
}

function buildHeuristicProfile(summary) {
  const energy = normalize(summary.averageRmsDb, -60, -12);
  const peak = clamp(summary.averagePeakMax, 0, 1);
  const pitchVariance = normalize(summary.averagePitchVarianceHz, 40, 900);
  const attack = clamp(summary.averageAttackRate, 0, 1);
  const silence = clamp(summary.averageSilenceRatio, 0, 1);
  const entropy = clamp(summary.averageEntropy, 0, 1);

  return {
    sizeScale: 0.9 + energy * 0.18 + attack * 0.08 - silence * 0.08,
    edgeParticleScale: 0.14 + silence * 0.12 + entropy * 0.1,
    shapeAmplitude: 0.04 + pitchVariance * 0.05 + attack * 0.06,
    shapeFrequencyBias: 0.9 + pitchVariance * 0.22 - silence * 0.08,
    warmthBias: -0.06 + entropy * 0.18 + peak * 0.1 - silence * 0.08,
  };
}

async function requestGeminiProfile(summary, heuristicProfile) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(getGeminiKey())}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildPrompt(summary, heuristicProfile),
              },
            ],
          },
        ],
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini request failed.");
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  const parsed = JSON.parse(extractJson(text));

  return {
    sizeScale: parsed.sizeScale,
    edgeParticleScale: parsed.edgeParticleScale,
    shapeAmplitude: parsed.shapeAmplitude,
    shapeFrequencyBias: parsed.shapeFrequencyBias,
    warmthBias: parsed.warmthBias,
  };
}

function buildPrompt(summary, heuristicProfile) {
  return [
    "You adapt a generative fire visualization for one anonymous user.",
    "Return JSON only with keys: sizeScale, edgeParticleScale, shapeAmplitude, shapeFrequencyBias, warmthBias.",
    "Respect these hard ranges:",
    "sizeScale: 0.8 to 1.25",
    "edgeParticleScale: 0.12 to 0.5",
    "shapeAmplitude: 0.02 to 0.16",
    "shapeFrequencyBias: 0.85 to 1.25",
    "warmthBias: -0.2 to 0.3",
    "Favor small, smooth adjustments that reflect long-term tendencies rather than dramatic changes.",
    `Session summary: ${JSON.stringify(summary)}`,
    `Heuristic baseline: ${JSON.stringify(heuristicProfile)}`,
  ].join("\n");
}

function finalizeProfile(profile, summary, source) {
  return {
    sizeScale: clamp(finiteOr(profile.sizeScale, DEFAULT_PROFILE.sizeScale), 0.8, 1.25),
    edgeParticleScale: clamp(finiteOr(profile.edgeParticleScale, DEFAULT_PROFILE.edgeParticleScale), 0.12, 0.5),
    shapeAmplitude: clamp(finiteOr(profile.shapeAmplitude, DEFAULT_PROFILE.shapeAmplitude), 0.02, 0.16),
    shapeFrequencyBias: clamp(finiteOr(profile.shapeFrequencyBias, DEFAULT_PROFILE.shapeFrequencyBias), 0.85, 1.25),
    warmthBias: clamp(finiteOr(profile.warmthBias, DEFAULT_PROFILE.warmthBias), -0.2, 0.3),
    sampleCount: summary.sampleCount,
    source,
    updatedAt: new Date().toISOString(),
  };
}

function extractJson(text) {
  const trimmed = String(text || "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Gemini did not return JSON.");
  }
  return trimmed.slice(start, end + 1);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalize(value, min, max) {
  return clamp((value - min) / (max - min), 0, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

module.exports = {
  DEFAULT_PROFILE,
  synthesizeFlameProfile,
};
