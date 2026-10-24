// The phone app: the instrument with the patch and the accelerometer mappings
// the page's Phone tab gave it (config.json), a keyboard, and the AudioWorklet
// of the page (elements-processor.js) at 32 kHz. Installed from its address, it
// plays offline (service-worker.js). Built with its options, it also has an
// ON/OFF button holding a note (as the SmartFaust apps' switch), and the
// faust-ui interface of every control (faust-ui/, GPL-3.0-or-later).
import { controlKey } from "./faust-wasm-dsp.js";
import { MotionMapper } from "./motion.js";

const SAMPLE_RATE = 32000;
// Motion is applied at most this often (the sensor fires at 60 Hz or more).
const MOTION_PERIOD = 1 / 30;
// No sensor event this long after the start: no accelerometer.
const NO_SENSOR_SECONDS = 2;

const config = await fetch("config.json").then((r) => r.json());
const TEXT = {
  en: {
    start: "Touch to start", loading: "Loading…", running: "32 kHz", motion: "motion on",
    noMotion: "no accelerometer", denied: "motion refused", hold: "Hold", follow: "Motion",
    none: "No parameter follows the phone's motion.", octave: "C", controls: "Controls",
  },
  fr: {
    start: "Touchez pour commencer", loading: "Chargement…", running: "32 kHz", motion: "mouvement actif",
    noMotion: "pas d'accéléromètre", denied: "mouvement refusé", hold: "Maintien", follow: "Mouvement",
    none: "Aucun paramètre ne suit le mouvement du téléphone.", octave: "Do", controls: "Commandes",
  },
};
const t = (k) => (TEXT[config.lang] || TEXT.en)[k];
const $ = (id) => document.getElementById(id);

const audio = { ctx: null, node: null };
const send = (m) => audio.node && audio.node.port.postMessage(m);
const android = /Android/i.test(navigator.userAgent);
const mapper = new MotionMapper(config.mappings, { android });
const steps = config.steps || {};
let following = true;
let sensed = false;
let lastApplied = -Infinity;
const sent = new Map();
// The controls' values: the patch, then what the motion and faust-ui change.
const current = new Map(Object.entries(config.patch));
// Controls the phone leaves to its keyboard.
const KEYBOARD = new Set(["freq", "gain", "gate"]);
let faustUI = null;
const addresses = new Map(); // key -> faust-ui address

// A control changed by the motion, faust-ui or the patch: to the DSPs, and to
// faust-ui's widget unless the change comes from it.
function setValue(key, value, from) {
  current.set(key, value);
  send({ type: "control", key, value });
  if (faustUI && from !== "ui" && addresses.has(key)) faustUI.paramChangeByDSP(addresses.get(key), value);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});

// --- Starting: audio and motion permission within the same touch (iOS asks
// for both during a user gesture).
async function start() {
  if (audio.ctx) return;
  $("start-text").textContent = t("loading");
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  audio.ctx = ctx;
  ctx.resume().catch(() => {});
  let permission = Promise.resolve("granted");
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    permission = DeviceMotionEvent.requestPermission().catch(() => "denied");
  }
  try {
    const [voice, body] = await Promise.all([loadDsp("voice"), loadDsp("body")]);
    await ctx.audioWorklet.addModule("elements-processor.js");
    const node = new AudioWorkletNode(ctx, "elements", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { voice, body, polyphony: config.polyphony },
    });
    node.connect(ctx.destination);
    audio.node = node;
    for (const [key, value] of current) send({ type: "control", key, value });
    $("start").hidden = true;
    status();
  } catch (err) {
    $("start-text").textContent = String(err);
    return;
  }
  if ((await permission) !== "granted") {
    $("status").textContent = `${t("running")} · ${t("denied")}`;
    return;
  }
  window.addEventListener("devicemotion", onMotion);
  setTimeout(() => {
    if (!sensed && config.mappings.length) status();
  }, NO_SENSOR_SECONDS * 1000);
  keepAwake();
}

// A DSP of the app: its JSON, its module compiled from the bytes (some iOS
// versions refuse streaming compilation of an installed app's wasm).
async function loadDsp(name) {
  const [json, bytes] = await Promise.all([
    fetch(`dsp/${name}.json`).then((r) => r.json()),
    fetch(`dsp/${name}.wasm`).then((r) => r.arrayBuffer()),
  ]);
  return { json, module: await WebAssembly.compile(bytes) };
}

function status() {
  const parts = [t("running")];
  if (config.mappings.length) parts.push(sensed ? t("motion") : t("noMotion"));
  $("status").textContent = parts.join(" · ");
}

// The screen stays on while the app plays, where the browser allows it.
async function keepAwake() {
  try {
    if (navigator.wakeLock) await navigator.wakeLock.request("screen");
  } catch {
    // Refused or unsupported: the screen may sleep.
  }
}

document.addEventListener("visibilitychange", () => {
  if (!audio.ctx) return;
  if (document.visibilityState === "hidden") audio.ctx.suspend();
  else {
    audio.ctx.resume();
    keepAwake();
  }
});

$("start").addEventListener("click", start);
$("start").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") start();
});

// --- Motion.
const rows = new Map();
function buildMotion() {
  const root = $("motion");
  root.innerHTML = "";
  if (!config.mappings.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = t("none");
    root.appendChild(p);
    return;
  }
  for (const m of config.mappings) {
    const row = document.createElement("div");
    row.className = "map";
    row.innerHTML = `<div class="top"><span class="name"></span><span class="axis"></span></div>
      <div class="meter"><div></div></div>`;
    row.querySelector(".name").textContent = config.labels[m.key] || m.key;
    row.querySelector(".axis").textContent = `${m.axis.toUpperCase()} · ${config.curveNames[m.curve] || m.curve}`;
    root.appendChild(row);
    rows.set(m.key, row);
  }
}

function onMotion(e) {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x === null) return;
  if (!sensed) {
    sensed = true;
    status();
  }
  const now = e.timeStamp / 1000;
  mapper.update(g, now);
  if (!following || now - lastApplied < MOTION_PERIOD) return;
  lastApplied = now;
  apply(mapper.values());
}

// The mapped controls, sent when they moved; their meters.
function apply(values) {
  for (const [key, raw] of values) {
    const value = steps[key] >= 1 ? Math.round(raw) : raw;
    const range = config.ranges[key];
    const row = rows.get(key);
    if (row && range) {
      const f = (value - range.min) / (range.max - range.min || 1);
      row.querySelector(".meter > div").style.width = `${(100 * Math.min(1, Math.max(0, f))).toFixed(1)}%`;
    }
    const last = sent.get(key);
    if (last !== undefined && Math.abs(value - last) < 1e-4) continue;
    sent.set(key, value);
    setValue(key, value, "motion");
  }
}

$("follow").addEventListener("click", () => {
  following = !following;
  $("follow").setAttribute("aria-pressed", String(following));
  if (!following) {
    // Back to the patch's values.
    for (const m of config.mappings) {
      const value = config.patch[m.key];
      if (value !== undefined) setValue(m.key, value, "patch");
    }
    sent.clear();
  }
});

// --- Keyboard: two octaves, glissando with every finger, a hold switch.
const BLACK = [1, 3, 6, 8, 10];
let octave = config.octave ?? 4;
const pointers = new Map(); // pointer id -> key
const sounding = new Map(); // key -> count of pointers holding it
const held = new Set(); // keys the hold keeps sounding
let holding = false;

function firstKey() {
  return 12 * (octave + 1);
}

function buildKeyboard() {
  const kb = $("keyboard");
  kb.innerHTML = "";
  const first = firstKey();
  const whites = [];
  for (let k = first; k <= first + 24; k += 1) if (!BLACK.includes(k % 12)) whites.push(k);
  const width = 100 / whites.length;
  for (let k = first; k <= first + 24; k += 1) {
    const el = document.createElement("div");
    el.className = "key";
    el.dataset.key = String(k);
    if (BLACK.includes(k % 12)) {
      el.classList.add("black");
      const left = whites.indexOf(k - 1) + 1;
      el.style.left = `calc(${left * width}% - ${width * 0.3}%)`;
      el.style.width = `${width * 0.6}%`;
    } else if (k % 12 === 0) {
      el.innerHTML = `<span class="label">${t("octave")}${Math.floor(k / 12) - 1}</span>`;
    }
    kb.appendChild(el);
  }
  $("octave").textContent = `${t("octave")}${octave}`;
  showKeys();
}

function showKeys() {
  for (const el of document.querySelectorAll("#keyboard .key")) {
    const k = Number(el.dataset.key);
    el.classList.toggle("down", sounding.has(k));
    el.classList.toggle("held", !sounding.has(k) && held.has(k));
  }
}

function press(key) {
  sounding.set(key, (sounding.get(key) || 0) + 1);
  if (sounding.get(key) === 1) {
    held.delete(key);
    send({ type: "noteOn", key, velocity: config.velocity });
  }
  showKeys();
}

function lift(key) {
  const n = (sounding.get(key) || 0) - 1;
  if (n > 0) sounding.set(key, n);
  else {
    sounding.delete(key);
    if (holding) held.add(key);
    else send({ type: "noteOff", key });
  }
  showKeys();
}

const keyAt = (x, y) => {
  const el = document.elementFromPoint(x, y);
  const k = el && el.closest && el.closest("#keyboard .key");
  return k ? Number(k.dataset.key) : -1;
};

const kb = $("keyboard");
kb.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  kb.setPointerCapture(e.pointerId);
  const key = keyAt(e.clientX, e.clientY);
  pointers.set(e.pointerId, key);
  if (key >= 0) press(key);
});
kb.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  const key = keyAt(e.clientX, e.clientY);
  const before = pointers.get(e.pointerId);
  if (key === before) return;
  pointers.set(e.pointerId, key);
  if (before >= 0) lift(before);
  if (key >= 0) press(key);
});
const release = (e) => {
  if (!pointers.has(e.pointerId)) return;
  const key = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (key >= 0) lift(key);
};
kb.addEventListener("pointerup", release);
kb.addEventListener("pointercancel", release);

$("hold").addEventListener("click", () => {
  holding = !holding;
  $("hold").setAttribute("aria-pressed", String(holding));
  if (!holding) {
    for (const key of held) send({ type: "noteOff", key });
    held.clear();
    showKeys();
  }
});

function setOctave(o) {
  octave = Math.max(1, Math.min(6, o));
  buildKeyboard();
}
$("octave-down").addEventListener("click", () => setOctave(octave - 1));
$("octave-up").addEventListener("click", () => setOctave(octave + 1));

// --- ON/OFF: a note held while it is on, released (to its resonance) when off.
let on = false;
$("onoff").addEventListener("click", () => {
  if (!config.onoff) return;
  on = !on;
  $("onoff").setAttribute("aria-pressed", String(on));
  $("onoff").textContent = on ? "ON" : "OFF";
  send(on ? { type: "noteOn", key: config.onoff.key, velocity: config.velocity } : { type: "noteOff", key: config.onoff.key });
});

// --- faust-ui: every control of the voice and the body but the keyboard's,
// built the first time its panel opens.
function mergedUI(voiceUi, bodyUi) {
  const seen = new Set();
  const keep = (items) => {
    const out = [];
    for (const item of items || []) {
      if (Array.isArray(item.items)) {
        const kids = keep(item.items);
        if (kids.length) out.push({ ...item, items: kids });
      } else if (item.address) {
        const key = controlKey(item.address);
        if (KEYBOARD.has(key) || seen.has(key)) continue;
        seen.add(key);
        addresses.set(key, item.address);
        out.push(item);
      }
    }
    return out;
  };
  const top = (ui) => keep(ui).flatMap((g) => (Array.isArray(g.items) ? g.items : [g]));
  return [{ type: "vgroup", label: config.name, items: [...top(voiceUi), ...top(bodyUi)] }];
}

async function openControls() {
  const panel = $("controls");
  panel.hidden = !panel.hidden;
  $("controls-toggle").setAttribute("aria-pressed", String(!panel.hidden));
  document.body.classList.toggle("controls-open", !panel.hidden);
  $("keyboard").hidden = !panel.hidden || config.keyboard === false;
  if (panel.hidden) return;
  if (faustUI) {
    faustUI.resize();
    return;
  }
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "faust-ui/index.css";
  document.head.appendChild(css);
  const [{ FaustUI }, voiceJson, bodyJson] = await Promise.all([
    import("./faust-ui/index.js"),
    fetch("dsp/voice.json").then((r) => r.json()),
    fetch("dsp/body.json").then((r) => r.json()),
  ]);
  const root = document.createElement("div");
  root.className = "faust-ui-root";
  panel.appendChild(root);
  faustUI = new FaustUI({ ui: mergedUI(voiceJson.ui, bodyJson.ui), root, listenWindowMessage: false, listenWindowResize: true });
  faustUI.paramChangeByUI = (path, value) => setValue(controlKey(path), value, "ui");
  root.style.minWidth = `${faustUI.minWidth}px`;
  root.style.minHeight = `${faustUI.minHeight}px`;
  for (const [key, value] of current) if (addresses.has(key)) faustUI.paramChangeByDSP(addresses.get(key), value);
  faustUI.resize();
}
$("controls-toggle").addEventListener("click", openControls);

$("start-text").textContent = t("start");
$("hold").textContent = t("hold");
$("follow").textContent = t("follow");
$("follow").hidden = !config.mappings.length;
$("controls-toggle").textContent = t("controls");
$("controls-toggle").hidden = !config.faustUI;
$("onoff").hidden = !config.onoff;
$("onoff").textContent = "OFF";
if (config.keyboard === false) {
  document.body.classList.add("no-keyboard");
  for (const id of ["keyboard", "octave-down", "octave", "octave-up", "hold"]) $(id).hidden = true;
}
buildMotion();
buildKeyboard();
