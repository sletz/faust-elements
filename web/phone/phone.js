// The phone app: the instrument with a patch and accelerometer mappings, a
// keyboard and/or an ON/OFF button, played by the page's own AudioWorklet
// (elements-processor.js) at 32 kHz. Once opened from its address, its service
// worker keeps every file, and the app plays offline.
//
// It runs in two forms, which differ only in where their configuration and
// files are:
//
// - a built app (made by the page's Phone tab, web/pwa.js, and stored by the
//   page's server under build/pwa/ID/): every file next to index.html, the
//   configuration in config.json;
// - the static app (web/play/, for GitHub Pages or any static host): the page
//   marks it with <meta name="app-base" content="../">, the files are those of
//   the page (one directory up), and the configuration comes in the address,
//   ?c=..., encoded by web/phone-config.js.
//
// Starting: one touch on the start screen creates the audio context and asks
// iOS for the motion permission within that same gesture (iOS refuses both
// outside a user gesture); the DSPs are then compiled, the worklet loaded, the
// patch sent, and the accelerometer followed.

// The model's sample rate: every table and delay of the DSPs is computed for it.
const SAMPLE_RATE = 32000;
// The mapped controls are sent at most this often, in seconds (the sensor
// fires at 60 Hz or more; 30 updates a second are smooth enough and spare the
// worklet's message port).
const MOTION_PERIOD = 1 / 30;
// No sensor event this long after the start, in seconds: the status says the
// phone has no accelerometer.
const NO_SENSOR_SECONDS = 2;
// Controls the phone leaves to its keyboard (written by each note).
const KEYBOARD = new Set(["freq", "gain", "gate"]);

// Where the app's files are: the directory the page names in its app-base
// meta (the static app: "../"), else the page's own directory (a built app).
const STATIC = document.querySelector('meta[name="app-base"]');
const BASE = new URL(STATIC ? STATIC.content : "./", document.baseURI);
/** @param {string} path - a file of the app @returns {string} its URL */
const at = (path) => new URL(path, BASE).href;
/** @param {string} path @returns {Promise<Object>} the JSON file at path */
const fetchJson = (path) => fetch(at(path)).then((r) => r.json());

// The motion mapping (curves and smoothing), shared with the page.
const { MotionMapper, normalize } = await import(at("motion.js"));

// The words of the app, by language.
const TEXT = {
  en: {
    start: "Touch to start", loading: "Loading…", running: "32 kHz", motion: "motion on",
    noMotion: "no accelerometer", denied: "motion refused", hold: "Hold", follow: "Motion",
    none: "No parameter follows the phone's motion.", octave: "C",
    curves: { up: "Up", down: "Down", updown: "Up-down", downup: "Down-up" },
  },
  fr: {
    start: "Touchez pour commencer", loading: "Chargement…", running: "32 kHz", motion: "mouvement actif",
    noMotion: "pas d'accéléromètre", denied: "mouvement refusé", hold: "Maintien", follow: "Mouvement",
    none: "Aucun paramètre ne suit le mouvement du téléphone.", octave: "Do",
    curves: { up: "Monte", down: "Descend", updown: "Monte-descend", downup: "Descend-monte" },
  },
};

/**
 * The app's configuration: config.json for a built app; for the static app,
 * the address's ?c= made whole (web/phone-config.js) with what a built app's
 * config.json also carries: the mapped controls' labels (controls.js), ranges
 * and steps (the DSPs' JSON), and the curves' names.
 * @returns {Promise<Object>} {name, lang, polyphony, velocity, octave, keyboard,
 *   onoff, patch, mappings, labels, ranges, steps, curveNames}
 */
async function loadConfig() {
  if (!STATIC) return fetchJson("config.json");
  const [cfgModule, { CONTROLS }, voiceJson, bodyJson] = await Promise.all([
    import(at("phone-config.js")),
    import(at("controls.js")),
    fetchJson("dsp/voice.json"),
    fetchJson("dsp/body.json"),
  ]);
  const controls = cfgModule.controlList(voiceJson, bodyJson);
  const c = new URLSearchParams(location.search).get("c");
  const config = cfgModule.expandConfig(c ? cfgModule.decodeConfig(c) : null, controls);
  const range = new Map(controls.map((x) => [x.key, x]));
  // The mappings checked against the controls' ranges, as the page made them.
  config.mappings = config.mappings.map((m) => normalize(m, range.get(m.key)));
  const label = (key) => ((CONTROLS.find((x) => x.key === key) || {})[config.lang] || [key])[0];
  config.labels = Object.fromEntries(controls.map((x) => [x.key, label(x.key)]));
  config.ranges = Object.fromEntries(controls.map((x) => [x.key, { min: x.min, max: x.max }]));
  config.steps = Object.fromEntries(controls.map((x) => [x.key, x.step]));
  config.curveNames = TEXT[config.lang].curves;
  // The page's language and name, for the title bar and the home screen.
  document.documentElement.lang = config.lang;
  document.title = config.name;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", config.name);
  document.getElementById("name").textContent = config.name;
  return config;
}

const config = await loadConfig();
/** @param {string} k @returns {string} the word k in the app's language */
const t = (k) => (TEXT[config.lang] || TEXT.en)[k];
/** @param {string} id @returns {HTMLElement} */
const $ = (id) => document.getElementById(id);

// The audio state: the context and the worklet node, once started.
const audio = { ctx: null, node: null };
/** Posts a message to the worklet (noteOn, noteOff, control), once started. */
const send = (m) => audio.node && audio.node.port.postMessage(m);
// Android reports the accelerometer's axes with the signs opposite to iOS's.
const android = /Android/i.test(navigator.userAgent);
const mapper = new MotionMapper(config.mappings, { android });
const steps = config.steps || {};
// True while the motion drives the mapped controls (the Motion button).
let following = true;
// True once a sensor event has arrived.
let sensed = false;
// The time of the last motion update sent, in seconds (event time stamps).
let lastApplied = -Infinity;
// The last value sent of each mapped control, to send only what moved.
const sent = new Map();
// Every control's current value: the patch, then what the motion changes; all
// are sent to the worklet when it starts.
const current = new Map(Object.entries(config.patch).filter(([k]) => !KEYBOARD.has(k)));

/**
 * A control's new value, to the worklet (which sets it on every voice and on
 * the body).
 * @param {string} key - the control's key ("resonator/geometry")
 * @param {number} value
 */
function setValue(key, value) {
  current.set(key, value);
  send({ type: "control", key, value });
}

// --- The service worker, which keeps the app's files for offline use. The
// static app names itself from its address through it (its manifest is made by
// the service worker), so the first visit, before the worker controls the
// page, reloads once it does, as long as nothing has started.
if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register("service-worker.js").catch(() => {});
  if (STATIC && !hadController) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!audio.ctx) location.reload();
    });
  }
}

/**
 * Starts the app, on the first touch of the start screen: the audio context
 * (resumed within the gesture), the motion permission (iOS), the DSPs, the
 * worklet with the patch, then the accelerometer.
 */
async function start() {
  if (audio.ctx) return;
  $("start-text").textContent = t("loading");
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  audio.ctx = ctx;
  ctx.resume().catch(() => {});
  // Asked now, before any await, while the touch still counts as a gesture.
  let permission = Promise.resolve("granted");
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    permission = DeviceMotionEvent.requestPermission().catch(() => "denied");
  }
  try {
    const [voice, body] = await Promise.all([loadDsp("voice"), loadDsp("body")]);
    await ctx.audioWorklet.addModule(at("elements-processor.js"));
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

/**
 * A DSP of the app: its JSON, and its module compiled from the bytes (some iOS
 * versions refuse the streaming compilation of an installed app's wasm).
 * @param {string} name - "voice" or "body"
 * @returns {Promise<{json: Object, module: WebAssembly.Module}>}
 */
async function loadDsp(name) {
  const [json, bytes] = await Promise.all([
    fetchJson(`dsp/${name}.json`),
    fetch(at(`dsp/${name}.wasm`)).then((r) => r.arrayBuffer()),
  ]);
  return { json, module: await WebAssembly.compile(bytes) };
}

/** Shows the rate, and whether the accelerometer answers, in the header. */
function status() {
  const parts = [t("running")];
  if (config.mappings.length) parts.push(sensed ? t("motion") : t("noMotion"));
  $("status").textContent = parts.join(" · ");
}

/** Keeps the screen on while the app plays, where the browser allows it. */
async function keepAwake() {
  try {
    if (navigator.wakeLock) await navigator.wakeLock.request("screen");
  } catch {
    // Refused or unsupported: the screen may sleep.
  }
}

// Hidden (another app, the screen off): the audio is suspended; back, resumed,
// and the wake lock, which the browser drops when hidden, asked again.
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

// --- Motion: one meter per mapping, the controls driven by the accelerometer.
const rows = new Map(); // control key -> its meter's row

/** Builds the meters of the mappings, or says that there is none. */
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

/**
 * One accelerometer event: the axes smoothed, and the mapped controls updated
 * at most every MOTION_PERIOD.
 * @param {DeviceMotionEvent} e
 */
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

/**
 * The mapped controls' values: rounded for a stepped control (the model), shown
 * on their meters (as a share of the control's range), and sent when they moved.
 * @param {Array<[string, number]>} values - from MotionMapper.values
 */
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
    setValue(key, value);
  }
}

// The Motion button: off, the mapped controls go back to the patch's values.
$("follow").addEventListener("click", () => {
  following = !following;
  $("follow").setAttribute("aria-pressed", String(following));
  if (!following) {
    for (const m of config.mappings) {
      const value = config.patch[m.key];
      if (value !== undefined) setValue(m.key, value);
    }
    sent.clear();
  }
});

// --- Keyboard: two octaves from a C, glissando with every finger, a hold.
const BLACK = [1, 3, 6, 8, 10]; // the black keys' pitch classes
let octave = config.octave ?? 4; // the octave of the keyboard's first C
const pointers = new Map(); // pointer id -> the key under it (-1: none)
const sounding = new Map(); // key -> how many pointers hold it
const held = new Set(); // keys the hold keeps sounding after their release
let holding = false; // the Hold button

/** @returns {number} the MIDI key of the keyboard's first C */
function firstKey() {
  return 12 * (octave + 1);
}

/**
 * Builds the 25 keys from the first C: the white keys share the width, the
 * black ones sit across the boundaries, 60 % of a white key wide.
 */
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

/** Marks the keys held by a finger (down) and those the hold keeps (held). */
function showKeys() {
  for (const el of document.querySelectorAll("#keyboard .key")) {
    const k = Number(el.dataset.key);
    el.classList.toggle("down", sounding.has(k));
    el.classList.toggle("held", !sounding.has(k) && held.has(k));
  }
}

/**
 * A key pressed by a pointer: the note starts with the first pointer on it.
 * @param {number} key - MIDI key
 */
function press(key) {
  sounding.set(key, (sounding.get(key) || 0) + 1);
  if (sounding.get(key) === 1) {
    held.delete(key);
    send({ type: "noteOn", key, velocity: config.velocity });
  }
  showKeys();
}

/**
 * A key left by a pointer: the note ends with the last pointer, unless the
 * hold keeps it.
 * @param {number} key - MIDI key
 */
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

/**
 * The key under a point of the screen (pointer capture keeps sending a moving
 * finger's events to the keyboard, so the key is found by position).
 * @param {number} x
 * @param {number} y
 * @returns {number} MIDI key, or -1
 */
const keyAt = (x, y) => {
  const el = document.elementFromPoint(x, y);
  const k = el && el.closest && el.closest("#keyboard .key");
  return k ? Number(k.dataset.key) : -1;
};

// Each pointer (finger) presses the key under it; moving to another key lifts
// the first and presses the second (glissando); lifting the finger lifts it.
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
/** A pointer lifted or cancelled: its key is lifted. */
const release = (e) => {
  if (!pointers.has(e.pointerId)) return;
  const key = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (key >= 0) lift(key);
};
kb.addEventListener("pointerup", release);
kb.addEventListener("pointercancel", release);

// The Hold button: on, released keys keep sounding; off, they are released.
$("hold").addEventListener("click", () => {
  holding = !holding;
  $("hold").setAttribute("aria-pressed", String(holding));
  if (!holding) {
    for (const key of held) send({ type: "noteOff", key });
    held.clear();
    showKeys();
  }
});

/**
 * Moves the keyboard to another octave (its first C from C1 to C6).
 * @param {number} o
 */
function setOctave(o) {
  octave = Math.max(1, Math.min(6, o));
  buildKeyboard();
}
$("octave-down").addEventListener("click", () => setOctave(octave - 1));
$("octave-up").addEventListener("click", () => setOctave(octave + 1));

// --- ON/OFF (as the SmartFaust apps' switch): on, the configured note is held,
// so that the phone plays without the keyboard, shaped by its motion; off, the
// note is released to its resonance.
let on = false;
$("onoff").addEventListener("click", () => {
  if (!config.onoff) return;
  on = !on;
  $("onoff").setAttribute("aria-pressed", String(on));
  $("onoff").textContent = on ? "ON" : "OFF";
  send(on ? { type: "noteOn", key: config.onoff.key, velocity: config.velocity } : { type: "noteOff", key: config.onoff.key });
});

// --- The page set up from the configuration.
$("start-text").textContent = t("start");
$("hold").textContent = t("hold");
$("follow").textContent = t("follow");
$("follow").hidden = !config.mappings.length;
$("onoff").hidden = !config.onoff;
$("onoff").textContent = "OFF";
if (config.keyboard === false) {
  // Without the keyboard the ON/OFF button fills the screen (phone.css).
  document.body.classList.add("no-keyboard");
  for (const id of ["keyboard", "octave-down", "octave", "octave-up", "hold"]) $(id).hidden = true;
}
buildMotion();
buildKeyboard();
