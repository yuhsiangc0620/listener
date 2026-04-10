// ── Audio state ───────────────────────────────────────────────
let audioContext = null;
let analyser = null;
let sourceNode = null;
let stream = null;

const timeData = new Uint8Array(2048);
const freqData = new Uint8Array(1024);

const featureState = {
  rms: 0.04,
  peak: 0.06,
  centroid: 0.14,
  centroidVariance: 0.03,
  attackRate: 0.08,
  silenceRatio: 0.34,
  entropy: 0.18,
};

const history = {
  rms: [],
  centroid: [],
  attacks: [],
  silence: [],
};

const fallback = {
  time: 0,
  enabled: true,
};

// ── Canvas + Particles ────────────────────────────────────────
const canvas = document.getElementById("flameCanvas");
const ctx = canvas.getContext("2d");

let canvasSize = 0;
let centerX = 0;
let centerY = 0;
let fieldRadius = 0;
let particles = [];

const DOT_GAP = 17;
const DOT_BASE_RADIUS = DOT_GAP * 0.31;

// Flame color gradient stops (dist 0 = center, 1 = edge)
const COLOR_STOPS = [
  { t: 0.00, r: 255, g: 252, b: 228 }, // white-hot core
  { t: 0.18, r: 255, g: 208, b: 96  }, // bright amber
  { t: 0.42, r: 255, g: 128, b: 16  }, // orange
  { t: 0.65, r: 228, g: 62,  b: 4   }, // deep orange
  { t: 0.84, r: 136, g: 20,  b: 2   }, // dark red-orange
  { t: 1.00, r: 52,  g: 6,   b: 1   }, // near-black
];

function buildParticles() {
  particles = [];
  for (let y = DOT_GAP / 2; y < canvasSize; y += DOT_GAP) {
    for (let x = DOT_GAP / 2; x < canvasSize; x += DOT_GAP) {
      const dx = x - centerX;
      const dy = y - centerY;
      const norm = Math.sqrt(dx * dx + dy * dy) / fieldRadius;
      if (norm <= 1.0) {
        particles.push({
          x,
          y,
          norm,
          angle: Math.atan2(dy, dx),
          phase: Math.random() * Math.PI * 2,
          speed: 1.8 + Math.random() * 3.5,
        });
      }
    }
  }
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const logical = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.78);
  canvas.style.width = logical + "px";
  canvas.style.height = logical + "px";
  canvas.width = logical * dpr;
  canvas.height = logical * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvasSize = logical;
  centerX = logical / 2;
  centerY = logical / 2;
  fieldRadius = logical * 0.46;
  buildParticles();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ── Helpers ───────────────────────────────────────────────────
function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function variance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

function pushLimited(arr, val, size) {
  arr.push(val);
  if (arr.length > size) arr.shift();
}

function sampleGradient(t) {
  t = clamp(t);
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const tt = (t - a.t) / (b.t - a.t);
      return {
        r: Math.round(lerp(a.r, b.r, tt)),
        g: Math.round(lerp(a.g, b.g, tt)),
        b: Math.round(lerp(a.b, b.b, tt)),
      };
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1];
}

// ── Drawing ───────────────────────────────────────────────────
function drawParticles(timestamp) {
  ctx.clearRect(0, 0, canvasSize, canvasSize);

  const time = timestamp / 1000;
  const fs = featureState;

  const energyBoost = fs.rms * 0.52 + fs.peak * 0.26 + fs.entropy * 0.08;
  const reachScale = 0.50 + energyBoost * 0.74;
  const heatShift = fs.centroid * 0.35;
  const globalBright = 1.0 + fs.peak * 0.24 + fs.rms * 0.12;

  for (const p of particles) {
    // Organic boundary: layered angular harmonics create a non-circular,
    // slowly-shifting silhouette — like fire viewed from above.
    const shapeWobble =
      0.062 * Math.sin(p.angle * 3 + time * 0.48) +
      0.038 * Math.sin(p.angle * 5 - time * 0.73) +
      0.022 * Math.cos(p.angle * 8 + time * 0.31) +
      0.014 * Math.sin(p.angle * 11 + time * 0.19);

    const effectiveDist = p.norm / (reachScale * (1.0 + shapeWobble));
    if (effectiveDist > 1.04) continue;

    const t = clamp(effectiveDist);

    const flicker = 0.78 + 0.22 * Math.sin(time * p.speed + p.phase);

    let { r, g, b } = sampleGradient(t);

    // Higher centroid → warmer/brighter, push toward yellow-white
    g = clamp(g + heatShift * 44 * (1 - t * 0.75), 0, 255);
    b = clamp(b + heatShift * 22 * (1 - t * 0.85), 0, 255);

    r = clamp(r * globalBright, 0, 255);
    g = clamp(g * globalBright, 0, 255);
    b = clamp(b * globalBright, 0, 255);

    let alpha = flicker * (1 - t * 0.14);
    if (t > 0.80) {
      alpha *= (1 - (t - 0.80) / 0.22);
    }
    if (alpha < 0.018) continue;

    // Steeper power-curve falloff: edge particles become much smaller than center.
    const dotR = DOT_BASE_RADIUS * lerp(1.22, 0.22, Math.pow(t, 0.72)) * (1 + fs.rms * 0.22);

    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, dotR), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${alpha.toFixed(3)})`;
    ctx.fill();
  }
}

// ── Audio analysis ────────────────────────────────────────────
function analyzeAudio() {
  analyser.getByteTimeDomainData(timeData);
  analyser.getByteFrequencyData(freqData);

  let rmsSum = 0;
  let peak = 0;
  let weightedFreq = 0;
  let freqEnergy = 0;

  for (let i = 0; i < timeData.length; i++) {
    const n = (timeData[i] - 128) / 128;
    const a = Math.abs(n);
    rmsSum += n * n;
    if (a > peak) peak = a;
  }

  for (let i = 0; i < freqData.length; i++) {
    const m = freqData[i] / 255;
    weightedFreq += m * i;
    freqEnergy += m;
  }

  const rms = Math.sqrt(rmsSum / timeData.length);
  const centroid = freqEnergy > 0 ? weightedFreq / (freqEnergy * freqData.length) : 0;

  const prevRms = history.rms.length ? history.rms[history.rms.length - 1] : rms;
  const attack = clamp((rms - prevRms) * 12 + peak * 0.2);
  const silent = rms < 0.035 ? 1 : 0;

  pushLimited(history.rms, rms, 30);
  pushLimited(history.centroid, centroid, 36);
  pushLimited(history.attacks, attack, 24);
  pushLimited(history.silence, silent, 48);

  const centroidVariance = clamp(variance(history.centroid) * 18);
  const attackRate = clamp(history.attacks.reduce((s, v) => s + v, 0) / Math.max(history.attacks.length, 1));
  const silenceRatio = clamp(history.silence.reduce((s, v) => s + v, 0) / Math.max(history.silence.length, 1));
  const entropy = clamp(rms * 1.6 + peak * 0.7 + centroidVariance * 0.65 + attackRate * 0.45 - silenceRatio * 0.24);

  featureState.rms = lerp(featureState.rms, clamp(rms * 3.2), 0.24);
  featureState.peak = lerp(featureState.peak, clamp(peak * 1.8), 0.28);
  featureState.centroid = lerp(featureState.centroid, clamp(centroid * 1.8), 0.18);
  featureState.centroidVariance = lerp(featureState.centroidVariance, centroidVariance, 0.18);
  featureState.attackRate = lerp(featureState.attackRate, attackRate, 0.2);
  featureState.silenceRatio = lerp(featureState.silenceRatio, silenceRatio, 0.08);
  featureState.entropy = lerp(featureState.entropy, entropy, 0.14);
}

function runFallback(deltaSeconds) {
  fallback.time += deltaSeconds;
  const wA = (Math.sin(fallback.time * 1.2) + 1) * 0.5;
  const wB = (Math.sin(fallback.time * 2.1 + 0.8) + 1) * 0.5;
  const wC = (Math.sin(fallback.time * 0.7 + 1.9) + 1) * 0.5;
  featureState.rms = lerp(featureState.rms, 0.08 + wA * 0.18, 0.08);
  featureState.peak = lerp(featureState.peak, 0.12 + wB * 0.24, 0.08);
  featureState.centroid = lerp(featureState.centroid, 0.35 + wC * 0.18, 0.08);
  featureState.centroidVariance = lerp(featureState.centroidVariance, 0.1 + wB * 0.18, 0.08);
  featureState.attackRate = lerp(featureState.attackRate, 0.12 + wA * 0.26, 0.08);
  featureState.silenceRatio = lerp(featureState.silenceRatio, 0.34 + wC * 0.12, 0.06);
  featureState.entropy = lerp(featureState.entropy, 0.2 + wB * 0.22, 0.08);
}

// ── Microphone ────────────────────────────────────────────────
async function setupMicrophone() {
  if (audioContext && analyser) return;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia unavailable (requires https or localhost).");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    audioContext = new AudioContext();
    if (audioContext.state !== "running") await audioContext.resume();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
    sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNode.connect(analyser);
    fallback.enabled = false;
  } catch {
    fallback.enabled = true;
  }
}

function bindGestureToMic() {
  const handler = () => setupMicrophone();
  document.addEventListener("pointerdown", handler, { passive: true, capture: true });
  document.addEventListener("touchstart", handler, { passive: true, capture: true });
  document.addEventListener("click", handler, { passive: true, capture: true });
  document.addEventListener("keydown", handler, { passive: true, capture: true });
}

// ── Main loop ─────────────────────────────────────────────────
let lastTimestamp = performance.now();

function tick(timestamp) {
  const delta = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  if (analyser) {
    analyzeAudio();
  } else if (fallback.enabled) {
    runFallback(delta);
  }

  drawParticles(timestamp);
  requestAnimationFrame(tick);
}

// ── Visibility ────────────────────────────────────────────────
window.addEventListener("visibilitychange", () => {
  if (document.hidden && audioContext?.state === "running") {
    audioContext.suspend();
  } else if (!document.hidden && audioContext?.state === "suspended") {
    audioContext.resume();
  }
});

bindGestureToMic();
requestAnimationFrame(tick);
