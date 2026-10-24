// The page: starts the AudioWorklet at 32 kHz with the voice and the body
// compiled by faust-rs (web/dsp), builds the controls and the presets, and plays
// notes from the on-screen keyboard, the computer keyboard and Web MIDI.
import { CONTROLS, GROUPS, PRESETS } from "./controls.js";
import { controlKey, uiItems } from "./faust-wasm-dsp.js";
import { createAtlas } from "./atlas.js";
import { project } from "./describe.js";
import { createOrbit } from "./orbit.js";
import { createTimbreOrbit, nearestSound, percentile, quantile, timbreTable } from "./timbre.js";

const DSP_DIR = "dsp/";
// The module's sample rate: every table and delay of the model is computed for it.
const SAMPLE_RATE = 32000;

const TEXT = {
  en: {
    title: "Mutable Instruments Elements in Faust",
    subtitle: "The modal synthesis voice of Emilie Gillet, written in Faust and compiled to WebAssembly by faust-rs. Bow, blow or strike a resonator of 52 modes, one string or a chord of strings, in the module's reverb.",
    start: "Start audio", stop: "Stop audio", panic: "All notes off",
    loading: "Loading…", running: "Running at 32 kHz", stopped: "Stopped",
    load: "Load", voices: "Voices", level: "Level",
    preset: "Preset", polyphony: "Polyphony", midi: "MIDI input", velocity: "Velocity",
    octave: "Octave", allInputs: "All inputs", noMidi: "No Web MIDI",
    keysHelp: "Computer keyboard: two rows from Z and Q, ← → change the octave, the space bar holds the notes while it is down. Double-click a control to reset it.",
    sustain: "Hold notes (pedal)",
    sustainHelp: "While held, released keys keep sounding, for chords: release the hold to stop them. Also the space bar and a MIDI sustain pedal (CC64). Raise the polyphony for large chords.",
    reset: "reset",
    orbitTab: "Orbit",
    orbitHelp: "Every control is a dot: drag one, or the centre to move them all; Random scatters them. Library opens the presets projected on a plane: click a disc to recall it, drag the cross between discs to morph from one sound to another, double-click to keep the current sound. Play notes while you explore.",
    orbitCenter: "Bring every control back to the centre", orbitRandom: "Scatter the controls at random",
    atlasTab: "Atlas",
    atlasHelp: "Sounds of the instrument, the presets and random patches, each played offline as A3 for one second, measured, and laid out by what they sound like. Hover a dot to read its measures, click it to load the patch and hear it. The axes are the two principal components of the measures (all but the loudness), or any measure. The diamond is the current sound, measured whenever it changes. The wheel or a pinch zooms (over an axis, that axis alone), a drag moves the view, a double click shows the whole atlas again.",
    timbreTitle: "Timbre orbit",
    timbreHelp: "The orbit again, but its dots are the measures, each a rank among the atlas's sounds (0.5: the median sound). Move them to ask for a sound: the page loads the nearest sound of the atlas, then measures and refines it for a moment. On the atlas, the dashed ring is the sound asked for, the diamond the sound obtained. Library lays the presets out by timbre.",
    timbreSearching: "Refining…",
    timbreGap: "Asked and obtained differ by {n} percentiles on average.",
    mapTitle: "Where the sound is",
    mapHelp: "The current sound (the diamond), measured and placed on the atlas as the orbit moves. Click a dot to load it; zoom with the wheel or a pinch, drag to move.",
    atlasMissing: "No atlas yet: run make web-atlas to compute web/atlas.json.",
    atlas: {
      axes: {
        brightness: ["Brightness", "Hz"], noisiness: ["Noisiness", "dB"], harmonicity: ["Harmonicity", ""],
        attack: ["Attack", "s"], sustain: ["Sustain", "dB"], decay: ["Decay", "s"], loudness: ["Loudness", "dBFS"], width: ["Width", "dB"],
      },
      models: ["modal", "string", "chord of strings"],
      pc: "Component", sound: "Sound", xAxis: "Horizontal", yAxis: "Vertical", play: "Play on click",
      zoomIn: "Zoom in", zoomOut: "Zoom out", zoomReset: "The whole atlas",
    },
  },
  fr: {
    title: "Mutable Instruments Elements en Faust",
    subtitle: "La voix de synthèse modale d'Émilie Gillet, écrite en Faust et compilée en WebAssembly par faust-rs. Frottez, soufflez ou frappez un résonateur de 52 modes, une corde ou un accord de cordes, dans la réverbération du module.",
    start: "Démarrer l'audio", stop: "Arrêter l'audio", panic: "Tout couper",
    loading: "Chargement…", running: "En marche à 32 kHz", stopped: "Arrêté",
    load: "Charge", voices: "Voix", level: "Niveau",
    preset: "Préréglage", polyphony: "Polyphonie", midi: "Entrée MIDI", velocity: "Vélocité",
    octave: "Octave", allInputs: "Toutes les entrées", noMidi: "Pas de Web MIDI",
    orbitTab: "Orbite",
    orbitHelp: "Chaque commande est un point : déplacez-en un, ou le centre pour les déplacer tous ; Random les disperse. Library ouvre les préréglages projetés sur un plan : cliquez un disque pour le rappeler, glissez la croix entre les disques pour passer d'un son à l'autre, double-cliquez pour garder le son courant. Jouez des notes pendant l'exploration.",
    orbitCenter: "Ramener toutes les commandes au centre", orbitRandom: "Disperser les commandes au hasard",
    atlasTab: "Atlas",
    atlasHelp: "Des sons de l'instrument, les préréglages et des réglages tirés au hasard, chacun joué hors ligne en la 3 pendant une seconde, mesuré, et placé selon ce qu'il fait entendre. Survolez un point pour lire ses mesures, cliquez-le pour charger le réglage et l'écouter. Les axes sont les deux composantes principales des mesures (toutes sauf le niveau), ou n'importe quelle mesure. Le losange est le son courant, mesuré à chaque changement. La molette ou un pincement zoome (sur un axe, cet axe seul), un glissé déplace la vue, un double-clic montre de nouveau tout l'atlas.",
    timbreTitle: "Orbite des timbres",
    timbreHelp: "L'orbite encore, mais ses points sont les mesures, chacune un rang parmi les sons de l'atlas (0,5 : le son médian). Déplacez-les pour demander un son : la page charge le son le plus proche de l'atlas, puis le mesure et l'affine un instant. Sur l'atlas, l'anneau pointillé est le son demandé, le losange le son obtenu. Library place les préréglages selon leur timbre.",
    timbreSearching: "Affinage…",
    timbreGap: "Demandé et obtenu diffèrent de {n} centiles en moyenne.",
    mapTitle: "Où est le son",
    mapHelp: "Le son courant (le losange), mesuré et placé sur l'atlas pendant que l'orbite bouge. Cliquez un point pour le charger ; zoomez à la molette ou en pinçant, glissez pour déplacer.",
    atlasMissing: "Pas encore d'atlas : lancez make web-atlas pour calculer web/atlas.json.",
    atlas: {
      axes: {
        brightness: ["Brillance", "Hz"], noisiness: ["Bruit", "dB"], harmonicity: ["Harmonicité", ""],
        attack: ["Attaque", "s"], sustain: ["Tenue", "dB"], decay: ["Extinction", "s"], loudness: ["Niveau", "dBFS"], width: ["Largeur", "dB"],
      },
      models: ["modal", "corde", "accord de cordes"],
      pc: "Composante", sound: "Son", xAxis: "Horizontal", yAxis: "Vertical", play: "Jouer au clic",
      zoomIn: "Zoomer", zoomOut: "Dézoomer", zoomReset: "Tout l'atlas",
    },
    keysHelp: "Clavier d'ordinateur : deux rangées depuis Z et Q (W et A en AZERTY), ← → changent l'octave, la barre d'espace maintient les notes tant qu'elle est enfoncée. Double-cliquez une commande pour la remettre à zéro.",
    sustain: "Maintien (pédale)",
    sustainHelp: "Tant qu'il est actif, les touches relâchées continuent de sonner, pour faire des accords : désactivez-le pour les arrêter. Aussi la barre d'espace et une pédale MIDI (CC64). Augmentez la polyphonie pour les grands accords.",
    reset: "défaut",
  },
};

let lang = (navigator.language || "en").startsWith("fr") ? "fr" : "en";
const t = (k) => TEXT[lang][k];
const $ = (id) => document.getElementById(id);

// The audio state: the context, the worklet node, the DSPs' JSON.
const audio = { ctx: null, node: null, json: null, starting: false };
// Control values by key, and their ranges from the JSON.
const values = new Map();
const ranges = new Map();
let octave = 4;
// A key sounds while one source at least holds it: a pointer, a computer key
// and a MIDI input can hold the same key; the note is released with the last.
const sources = new Map(); // key -> set of sources ("p<pointer id>", "kbd", "midi")
const isHeld = (key) => (sources.get(key)?.size ?? 0) > 0;
// The keyboard on the page: C1 to C8, in a box that scrolls.
const FIRST_KEY = 24;
const LAST_KEY = 108;
const keyElements = new Map();

function send(message) {
  if (audio.node) audio.node.port.postMessage(message);
}

// The orbit explorer (web/orbit.js), built once the DSPs are loaded, and the
// element it renders into, kept across the rebuilds of the tabs.
let orbit = null;
const orbitHost = document.createElement("div");
orbitHost.id = "orbit-root";
// The atlas (web/atlas.js) of the sounds of web/atlas.json, loaded with the
// DSPs, drawn the first time its tab is shown; the small map beside the orbit;
// the patch last loaded from them.
let atlas = null;
let miniAtlas = null;
let atlasData = null;
let atlasTable = null;
let atlasCurrent = -1;
const atlasHost = document.createElement("div");
atlasHost.id = "atlas-root";
const miniHost = document.createElement("div");
miniHost.id = "mini-atlas-root";
// The timbre orbit (web/timbre.js), beside the atlas.
let timbre = null;
const timbreHost = document.createElement("div");
timbreHost.id = "timbre-root";
const timbreStatus = document.createElement("p");
timbreStatus.className = "help timbre-status";
// The current sound measured by measure-worker.js after every change: one
// measure at a time, the latest values when it is done.
let worker = null;
let measureTimer = 0;
let measuring = false;
let measureAgain = false;
let soundMark = null; // the current sound on the atlas
let soundD = null; // its descriptors
let targetMark = null; // the sound the timbre orbit asks for
let timbreTarget = null; // its percentiles
// Who changed the sound last: "timbre" while the timbre orbit drives it.
let changeSource = "other";
let applyingTimbre = false;
let searchId = 0;
let searchTimer = 0;
// True while a preset sets every control, so that the orbit is updated once.
let batching = false;

function setControl(key, value, fromOrbit = false) {
  const r = ranges.get(key);
  // A stepped control (the model) takes whole values; the orbit interpolates.
  if (r && r.step >= 1) value = Math.round(value);
  if (values.get(key) === value && fromOrbit) return;
  values.set(key, value);
  if (orbit && !fromOrbit && !batching) orbit.setValues([[key, value]]);
  send({ type: "control", key, value });
  if (!batching) {
    if (!applyingTimbre) leaveTimbre();
    scheduleMeasure();
  }
  const row = document.querySelector(`[data-key="${key}"]`);
  if (row) {
    row.querySelector("input").value = value;
    row.querySelector(".value").textContent = format(key, value);
  }
}

function format(key, v) {
  const r = ranges.get(key);
  return r && r.step >= 1 ? String(Math.round(v)) : Number(v).toFixed(3);
}

async function loadDsp(name) {
  const [json, module] = await Promise.all([
    fetch(DSP_DIR + name + ".json").then((r) => r.json()),
    fetch(DSP_DIR + name + ".wasm").then(async (r) => WebAssembly.compile(await r.arrayBuffer())),
  ]);
  return { json, module };
}

async function start() {
  if (audio.ctx) {
    if (audio.ctx.state === "running") {
      await audio.ctx.suspend();
      $("status").textContent = t("stopped");
      $("start").textContent = t("start");
    } else {
      await audio.ctx.resume();
      $("status").textContent = t("running");
      $("start").textContent = t("stop");
    }
    return;
  }
  if (audio.starting) return;
  audio.starting = true;
  $("status").textContent = t("loading");
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  // Safari runs a context only if `resume` is called during the user's gesture.
  ctx.resume().catch(() => {});
  try {
    await ctx.audioWorklet.addModule("elements-processor.js");
    const [voice, body, atlasJson] = await Promise.all([
      loadDsp("voice"),
      loadDsp("body"),
      // The atlas is optional (make web-atlas); one without a projection is older.
      fetch("atlas.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (atlasJson && atlasJson.projection) {
      atlasData = atlasJson;
      atlasTable = timbreTable(atlasData);
      try {
        worker = new Worker("measure-worker.js", { type: "module" });
        worker.onmessage = (e) => onWorker(e.data);
        worker.postMessage({ type: "init", voice, body });
      } catch {
        // No module workers: the atlas without the current sound.
        worker = null;
      }
    }
    audio.json = { voice: voice.json, body: body.json };
    const node = new AudioWorkletNode(ctx, "elements", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { voice, body, polyphony: Number($("polyphony").value) },
    });
    node.port.onmessage = (e) => onMessage(e.data);
    node.connect(ctx.destination);
    audio.ctx = ctx;
    audio.node = node;
    readRanges();
    buildControls();
    applyPreset($("preset").value);
    $("status").textContent = t("running");
    $("start").textContent = t("stop");
    $("panic").disabled = false;
    $("build").textContent = buildLine();
  } catch (err) {
    $("status").textContent = String(err);
    await ctx.close();
  } finally {
    audio.starting = false;
  }
}

function buildLine() {
  const j = audio.json.voice;
  return `faust-rs ${j.version || ""}, ${j.compile_options || ""}`;
}

function onMessage(m) {
  if (m.type === "stats") {
    const load = Math.min(1, m.load);
    $("load-bar").style.width = `${(load * 100).toFixed(0)}%`;
    $("load-value").textContent = `${(m.load * 100).toFixed(0)} %`;
    $("voices-value").textContent = String(m.active);
    const db = m.peak > 0 ? 20 * Math.log10(m.peak) : -Infinity;
    $("level-bar").style.width = `${Math.max(0, Math.min(100, (db + 60) / 60 * 100))}%`;
    $("level-value").textContent = Number.isFinite(db) ? `${db.toFixed(0)} dB` : "–";
  }
}

// The ranges and defaults of every control, from the voice's and the body's JSON.
function readRanges() {
  for (const j of [audio.json.voice, audio.json.body]) {
    for (const item of uiItems(j.ui)) {
      if (item.min === undefined) continue;
      ranges.set(controlKey(item.address), {
        min: Number(item.min), max: Number(item.max), step: Number(item.step), init: Number(item.init),
      });
    }
  }
  for (const [k, r] of ranges) if (!values.has(k)) values.set(k, r.init);
}

// The tab shown, remembered by the browser when it allows it.
const TAB_STORE = "faust-elements-tab";
let currentTab = (() => {
  try {
    return localStorage.getItem(TAB_STORE) || GROUPS[0].id;
  } catch {
    return GROUPS[0].id;
  }
})();

// One tab per group of controls (exciter, resonator, space...), as on the
// module's panel; one panel per tab, the others hidden.
function buildControls() {
  const root = $("controls");
  root.innerHTML = "";
  const groups = [
    ...GROUPS.filter((g) => CONTROLS.some((c) => c.group === g.id && ranges.has(c.key))),
    { id: "orbit", en: TEXT.en.orbitTab, fr: TEXT.fr.orbitTab },
    { id: "atlas", en: TEXT.en.atlasTab, fr: TEXT.fr.atlasTab },
  ];
  // The atlas, its map and the timbre orbit are drawn again in the new
  // language when their tab is shown.
  atlas = null;
  miniAtlas = null;
  if (timbre) timbre.destroy();
  timbre = null;
  if (!groups.some((g) => g.id === currentTab)) currentTab = groups[0].id;
  const bar = document.createElement("div");
  bar.className = "tabs";
  bar.setAttribute("role", "tablist");
  root.appendChild(bar);
  for (const g of groups) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tab";
    tab.id = `tab-${g.id}`;
    tab.textContent = g[lang];
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `panel-${g.id}`);
    tab.addEventListener("click", () => showTab(g.id));
    bar.appendChild(tab);
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.id = `panel-${g.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    if (g.id === "orbit") {
      panel.classList.add("orbit-panel");
      const help = document.createElement("p");
      help.className = "help";
      help.textContent = t("orbitHelp");
      panel.append(help, sideBySide(orbitHost, "orbit-layout", t("mapTitle"), t("mapHelp"), miniHost));
    }
    if (g.id === "atlas") {
      panel.classList.add("atlas-panel");
      const help = document.createElement("p");
      help.className = "help";
      help.textContent = t("atlasHelp");
      panel.append(help, sideBySide(atlasHost, "atlas-layout", t("timbreTitle"), t("timbreHelp"), timbreHost, timbreStatus));
    }
    for (const c of CONTROLS.filter((x) => x.group === g.id && ranges.has(x.key))) {
      const r = ranges.get(c.key);
      const row = document.createElement("div");
      row.className = "control";
      row.dataset.key = c.key;
      const [label, help] = c[lang];
      row.innerHTML = `<label><span class="name"></span>
        <input type="range" min="${r.min}" max="${r.max}" step="${r.step >= 1 ? 1 : 0.001}">
        <span class="value"></span></label><p class="help"></p>`;
      row.querySelector(".name").textContent = label;
      row.querySelector(".help").textContent = help;
      const input = row.querySelector("input");
      input.value = values.get(c.key);
      row.querySelector(".value").textContent = format(c.key, values.get(c.key));
      input.addEventListener("input", () => {
        setControl(c.key, Number(input.value));
        markPresetModified();
      });
      input.addEventListener("dblclick", () => setControl(c.key, r.init));
      panel.appendChild(row);
    }
    root.appendChild(panel);
  }
  // Arrow keys move between the tabs, as in a tab list.
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const k = groups.findIndex((g) => g.id === currentTab);
    const next = groups[(k + (e.key === "ArrowLeft" ? groups.length - 1 : 1)) % groups.length];
    showTab(next.id);
    $(`tab-${next.id}`).focus();
  });
  showTab(currentTab);
}

function showTab(id) {
  currentTab = id;
  try {
    localStorage.setItem(TAB_STORE, id);
  } catch {
    // Storage refused: the tab is not remembered.
  }
  for (const tab of document.querySelectorAll("#controls .tab")) {
    const on = tab.id === `tab-${id}`;
    tab.setAttribute("aria-selected", on ? "true" : "false");
    tab.tabIndex = on ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("#controls .panel")) panel.hidden = panel.id !== `panel-${id}`;
  // The orbit lays its controls out from its size: it is built the first time
  // its tab is shown with the DSPs loaded, then only measured again.
  if (id === "orbit" && audio.json) {
    requestAnimationFrame(() => {
      if (orbit) orbit.resize();
      else orbit = makeOrbit();
    });
  }
  if (id === "orbit" && audio.json) showMap(miniHost, true);
  if (id === "atlas" && audio.json) showMap(atlasHost, false);
}

// A main element and, beside it on a wide page (below it otherwise), a column
// with a title, a help line and more elements.
function sideBySide(main, className, title, help, ...side) {
  const layout = document.createElement("div");
  layout.className = `side-by-side ${className}`;
  const left = document.createElement("div");
  left.className = "side-main";
  left.appendChild(main);
  const right = document.createElement("div");
  right.className = "side-column";
  const h = document.createElement("h3");
  h.textContent = title;
  const p = document.createElement("p");
  p.className = "help";
  p.textContent = help;
  right.append(h, p, ...side);
  layout.append(left, right);
  return layout;
}

const presetName = (id) => PRESETS.find((p) => p.id === id)?.[lang][0] ?? id;

// The atlas in its tab (with the timbre orbit), or the small map beside the
// orbit, built the first time it is shown.
function showMap(host, compact) {
  if (!atlasData) {
    host.innerHTML = "";
    const p = document.createElement("p");
    p.className = "help";
    p.textContent = t("atlasMissing");
    host.appendChild(p);
    return;
  }
  const existing = compact ? miniAtlas : atlas;
  if (existing) {
    requestAnimationFrame(() => existing.resize());
  } else {
    const map = createAtlas(host, {
      data: atlasData, text: t("atlas"), presetName, onPick: loadAtlasSound, current: atlasCurrent, compact,
    });
    map.setSound(soundMark);
    map.setTarget(targetMark);
    if (compact) miniAtlas = map;
    else atlas = map;
  }
  if (compact) return;
  // The timbre orbit lays its dots out from its size, as the other orbit.
  requestAnimationFrame(() => {
    if (timbre) {
      timbre.resize();
      return;
    }
    timbre = createTimbreOrbit(timbreHost, {
      atlas: atlasData,
      t: atlasTable,
      axes: t("atlas").axes,
      presetName,
      onTarget: askTimbre,
      tooltips: { centerButton: t("orbitCenter"), randomButton: t("orbitRandom") },
    });
    if (timbreTarget) timbre.setValues(timbreTarget);
    else if (soundD) timbre.setValues(ranksOf(soundD));
  });
}

// The current sound measured after a change, 120 ms after the last one.
function scheduleMeasure() {
  if (!worker || !atlasData) return;
  clearTimeout(measureTimer);
  measureTimer = setTimeout(() => {
    if (measuring) {
      measureAgain = true;
      return;
    }
    measuring = true;
    worker.postMessage({ type: "measure", id: 0, patch: Object.fromEntries(values) });
  }, 120);
}

// A sound on the atlas: its descriptors in the atlas's order, its coordinates.
function markOf(d, censored = false) {
  return { d: atlasData.axes.map((a) => d[a]), pc: project(atlasData, d), c: censored };
}

const ranksOf = (d) => Object.fromEntries(atlasData.axes.map((a) => [a, Number(percentile(atlasTable.table[a], d[a]).toFixed(2))]));

function onWorker(m) {
  if (m.type === "measured") {
    measuring = false;
    if (measureAgain) {
      measureAgain = false;
      scheduleMeasure();
    }
    soundD = m.d;
    soundMark = m.d ? markOf(m.d, m.censored) : null;
    for (const map of [atlas, miniAtlas]) if (map) map.setSound(soundMark);
    if (!m.d) return;
    if (changeSource === "timbre" && timbreTarget) {
      // The gap between the sound asked for and the sound obtained, in percentiles.
      const r = ranksOf(m.d);
      const gap = Math.sqrt(atlasData.axes.reduce((s, a) => s + (r[a] - timbreTarget[a]) ** 2, 0) / atlasData.axes.length);
      if (!timbreStatus.dataset.searching) timbreStatus.textContent = t("timbreGap").replace("{n}", String(Math.round(100 * gap)));
    } else if (timbre) {
      // The dots follow a sound set elsewhere.
      timbre.setValues(ranksOf(m.d));
    }
  } else if (m.type === "found" && m.id === searchId && changeSource === "timbre") {
    delete timbreStatus.dataset.searching;
    applyTimbrePatch(m.patch);
  }
}

// The timbre orbit asks for a sound: the nearest sounds of the atlas blended at
// once, then a search by measures once the dots rest.
function askTimbre(target) {
  if (!atlasData) return;
  timbreTarget = target;
  const d = Object.fromEntries(atlasData.axes.map((a) => [a, quantile(atlasTable.table[a], target[a])]));
  targetMark = markOf(d);
  for (const map of [atlas, miniAtlas]) if (map) map.setTarget(targetMark);
  const { patch } = nearestSound(atlasData, atlasTable, target, values.get("resonator/model"));
  applyTimbrePatch(patch);
  if (!worker) return;
  timbreStatus.textContent = t("timbreSearching");
  timbreStatus.dataset.searching = "1";
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const moves = {};
    for (const k of atlasData.controls) {
      const r = ranges.get(k);
      if (r && r.step < 1) moves[k] = [r.min, r.max];
    }
    searchId += 1;
    worker.postMessage({
      type: "search", id: searchId, start: Object.fromEntries(values), target, error: atlasTable.table, steps: 40, ranges: moves,
    });
  }, 350);
}

// The atlas's controls of a patch, set as the timbre orbit's.
function applyTimbrePatch(patch) {
  changeSource = "timbre";
  applyingTimbre = true;
  batching = true;
  for (const k of atlasData.controls) if (k in patch && ranges.has(k)) setControl(k, patch[k]);
  batching = false;
  applyingTimbre = false;
  if (orbit) orbit.setValues([...values]);
  markPresetModified();
  scheduleMeasure();
}

// A change from elsewhere ends the timbre orbit's request.
function leaveTimbre() {
  if (changeSource === "timbre") {
    timbreTarget = null;
    targetMark = null;
    for (const map of [atlas, miniAtlas]) if (map) map.setTarget(null);
    timbreStatus.textContent = "";
    delete timbreStatus.dataset.searching;
    clearTimeout(searchTimer);
    searchId += 1;
  }
  changeSource = "other";
}

// A sound of the atlas: its patch over the defaults, as a preset is, then the
// note it was measured with.
let auditionTimer = 0;
function loadAtlasSound(index, play) {
  atlasCurrent = index;
  const p = atlasData.points[index];
  const at = new Map(atlasData.controls.map((k, j) => [k, p.v[j]]));
  batching = true;
  for (const [k, r] of ranges) setControl(k, at.has(k) ? at.get(k) : r.init);
  batching = false;
  for (const map of [atlas, miniAtlas]) if (map) map.setCurrent(index);
  leaveTimbre();
  scheduleMeasure();
  if (orbit) orbit.setValues([...values]);
  if (p.preset) {
    $("preset").value = p.preset;
    showPresetHelp();
  } else {
    markPresetModified();
  }
  if (!play) return;
  const { key, velocity, hold } = atlasData.note;
  clearTimeout(auditionTimer);
  if (sources.get(key)?.has("atlas")) noteOff(key, "atlas");
  noteOn(key, velocity, "atlas");
  auditionTimer = setTimeout(() => noteOff(key, "atlas"), 1000 * hold);
}

function makeOrbit() {
  return createOrbit(orbitHost, {
    voiceJson: audio.json.voice,
    bodyJson: audio.json.body,
    presets: PRESETS,
    lang,
    values,
    onChange: (key, value) => {
      setControl(key, value, true);
      followOrbit();
    },
    tooltips: { centerButton: t("orbitCenter"), randomButton: t("orbitRandom") },
  });
}

function buildPresets() {
  const sel = $("preset");
  sel.innerHTML = "";
  for (const p of PRESETS) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p[lang][0];
    sel.appendChild(o);
  }
  showPresetHelp();
}

function showPresetHelp() {
  const p = PRESETS.find((x) => x.id === $("preset").value) || PRESETS[0];
  $("preset-help").textContent = p[lang][1];
}

function applyPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  batching = true;
  for (const [k, r] of ranges) setControl(k, k in p.values ? p.values[k] : r.init);
  batching = false;
  leaveTimbre();
  scheduleMeasure();
  if (orbit) orbit.setValues([...values]);
  showPresetHelp();
}

// After the orbit moved controls (a preset recalled from its library, a morph,
// a drag), the menu shows the preset the sound now is exactly, else the last
// one marked modified. Checked once the orbit's burst of changes is over.
let followTimer = 0;
function followOrbit() {
  clearTimeout(followTimer);
  followTimer = setTimeout(() => {
    const id = orbit && orbit.presetOf(values);
    if (id) {
      $("preset").value = id;
      showPresetHelp();
    } else {
      markPresetModified();
    }
  }, 30);
}

function markPresetModified() {
  $("preset-help").textContent = PRESETS.find((x) => x.id === $("preset").value)[lang][1] + " *";
}

// Notes.
// The hold, as a piano's sustain pedal: while it is down a released key keeps
// sounding (it joins `sustained`), and lifting it releases every such key. It
// is down while any of its sources is: the switch on the page (latched), the
// space bar, a MIDI sustain pedal.
const pedal = { latch: false, space: false, midi: false };
const sustained = new Set();
const pedalDown = () => pedal.latch || pedal.space || pedal.midi;

function setPedal(source, down) {
  pedal[source] = down;
  if (source === "latch") $("sustain").checked = down;
  $("sustain-state").classList.toggle("on", pedalDown());
  if (!pedalDown()) {
    for (const key of [...sustained]) release(key);
  }
}

function showKey(key) {
  const el = keyElements.get(key);
  if (!el) return;
  el.classList.toggle("down", isHeld(key));
  el.classList.toggle("sustained", !isHeld(key) && sustained.has(key));
}

/**
 * A key pressed by a source; a key already sounding is struck again.
 * @param {number} key - MIDI key
 * @param {number} velocity - in [0, 1]
 * @param {string} source - who holds it: "p<pointer id>", "kbd", "midi"
 */
function noteOn(key, velocity, source) {
  if (audio.ctx && audio.ctx.state !== "running") audio.ctx.resume().catch(() => {});
  let s = sources.get(key);
  if (!s) sources.set(key, (s = new Set()));
  s.add(source);
  sustained.delete(key);
  send({ type: "noteOn", key, velocity });
  showKey(key);
}

/**
 * A key released by a source: the note ends with the last source holding it,
 * or, while the hold is down, when the hold is lifted.
 * @param {number} key - MIDI key
 * @param {string} source - as given to noteOn
 */
function noteOff(key, source) {
  const s = sources.get(key);
  if (!s || !s.delete(source) || s.size) return;
  if (pedalDown()) {
    sustained.add(key);
    showKey(key);
  } else {
    release(key);
  }
}

// Sends the release of a key no longer held nor sustained.
function release(key) {
  sustained.delete(key);
  send({ type: "noteOff", key });
  showKey(key);
}

const BLACK = [1, 3, 6, 8, 10];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// The keys C1 to C8, each C labelled, built once.
function buildKeyboard() {
  const kb = $("keyboard");
  kb.innerHTML = "";
  keyElements.clear();
  for (let k = FIRST_KEY; k <= LAST_KEY; k += 1) {
    const d = document.createElement("div");
    d.className = "key" + (BLACK.includes(k % 12) ? " black" : "");
    d.dataset.key = k;
    if (k % 12 === 0) {
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = NOTE_NAMES[0] + (k / 12 - 1);
      d.append(label);
    }
    kb.appendChild(d);
    keyElements.set(k, d);
    showKey(k);
  }
  showOctave();
}

// The keys the computer keyboard plays (two rows from the octave), marked, and
// the view scrolled to them.
function showOctave() {
  const first = 12 * (octave + 1);
  for (const [k, el] of keyElements) el.classList.toggle("kbd", k >= first && k <= first + 24);
  $("octave-value").textContent = String(octave);
  const el = keyElements.get(Math.max(FIRST_KEY, first));
  const box = $("keyboard").parentElement;
  if (el && box) box.scrollLeft = Math.max(0, el.offsetLeft - 24);
}

function setOctave(o) {
  octave = Math.max(0, Math.min(7, o));
  showOctave();
}

// The key under a point of the window, or null.
function keyAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest(".key");
  return el && el.dataset.key ? { el, key: Number(el.dataset.key) } : null;
}

// Lower on a key is louder.
function velocityAt(e, el) {
  const rect = el.getBoundingClientRect();
  const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  return 0.2 + 0.8 * y;
}

/**
 * Mouse and touch: one note per pointer, captured by the keyboard, sliding from
 * key to key (glissando) while the pointer moves, as in faust-coopiano.
 */
function initPointer() {
  const kb = $("keyboard");
  const pointers = new Map(); // pointer id -> key
  kb.addEventListener("pointerdown", (e) => {
    const hit = keyAt(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    kb.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, hit.key);
    noteOn(hit.key, velocityAt(e, hit.el), "p" + e.pointerId);
  });
  kb.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const hit = keyAt(e.clientX, e.clientY);
    const old = pointers.get(e.pointerId);
    if (!hit || hit.key === old) return;
    noteOff(old, "p" + e.pointerId);
    pointers.set(e.pointerId, hit.key);
    noteOn(hit.key, velocityAt(e, hit.el), "p" + e.pointerId);
  });
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    noteOff(pointers.get(e.pointerId), "p" + e.pointerId);
    pointers.delete(e.pointerId);
  };
  kb.addEventListener("pointerup", up);
  kb.addEventListener("pointercancel", up);
}

// Two rows of the computer keyboard, by physical key, whatever the layout.
const ROW_LOW = ["KeyZ", "KeyS", "KeyX", "KeyD", "KeyC", "KeyV", "KeyG", "KeyB", "KeyH", "KeyN", "KeyJ", "KeyM", "Comma"];
const ROW_HIGH = ["KeyQ", "Digit2", "KeyW", "Digit3", "KeyE", "KeyR", "Digit5", "KeyT", "Digit6", "KeyY", "Digit7", "KeyU", "KeyI"];
const pressed = new Map();

function keyToNote(code) {
  let i = ROW_LOW.indexOf(code);
  if (i >= 0) return 12 * (octave + 1) + i;
  i = ROW_HIGH.indexOf(code);
  if (i >= 0) return 12 * (octave + 2) + i;
  return -1;
}

function onKeyDown(e) {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.repeat) return;
  // The orbit has its own keys (R, L, arrows, space).
  if (e.target instanceof Element && e.target.closest(".orbit-ui-root")) return;
  if (e.target.getAttribute && e.target.getAttribute("role") === "tab") return;
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    setOctave(octave + (e.code === "ArrowLeft" ? -1 : 1));
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    setPedal("space", true);
    return;
  }
  const n = keyToNote(e.code);
  if (n >= 0 && !pressed.has(e.code)) {
    pressed.set(e.code, n);
    noteOn(n, Number($("velocity").value) / 127, "kbd:" + e.code);
  }
}

function onKeyUp(e) {
  if (e.code === "Space") {
    setPedal("space", false);
    return;
  }
  const n = pressed.get(e.code);
  if (n !== undefined) {
    pressed.delete(e.code);
    noteOff(n, "kbd:" + e.code);
  }
}

// Web MIDI: notes, velocity, pitch bend on the modulation (±2 semitones), all
// notes off.
async function setupMidi() {
  const sel = $("midi-input");
  if (!navigator.requestMIDIAccess) {
    sel.innerHTML = `<option>${t("noMidi")}</option>`;
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    const refresh = () => {
      const current = sel.value;
      sel.innerHTML = `<option value="all">${t("allInputs")}</option>`;
      for (const input of access.inputs.values()) {
        const o = document.createElement("option");
        o.value = input.id;
        o.textContent = input.name;
        sel.appendChild(o);
      }
      if ([...sel.options].some((o) => o.value === current)) sel.value = current;
      for (const input of access.inputs.values()) {
        input.onmidimessage = (m) => {
          if (sel.value !== "all" && sel.value !== input.id) return;
          midi(m.data);
        };
      }
    };
    access.onstatechange = refresh;
    refresh();
  } catch {
    sel.innerHTML = `<option>${t("noMidi")}</option>`;
  }
}

function midi([status, a, b]) {
  const type = status & 0xf0;
  if (type === 0x90 && b > 0) noteOn(a, b / 127, "midi");
  else if (type === 0x80 || (type === 0x90 && b === 0)) noteOff(a, "midi");
  else if (type === 0xe0) setControl("performance/modulation", ((b * 128 + a) - 8192) / 8192 * 2);
  else if (type === 0xb0 && a === 64) setPedal("midi", b >= 64);
  else if (type === 0xb0 && (a === 120 || a === 123)) panic();
}

function panic() {
  sources.clear();
  sustained.clear();
  for (const k of keyElements.keys()) showKey(k);
  send({ type: "panic" });
}

function applyLanguage() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-text]")) el.textContent = t(el.dataset.text);
  $("start").textContent = audio.ctx && audio.ctx.state === "running" ? t("stop") : t("start");
  buildPresets();
  if (audio.json) buildControls();
  for (const b of document.querySelectorAll("[data-lang]")) b.classList.toggle("on", b.dataset.lang === lang);
}

function init() {
  for (const b of document.querySelectorAll("[data-lang]")) {
    b.addEventListener("click", () => {
      lang = b.dataset.lang;
      applyLanguage();
    });
  }
  $("start").addEventListener("click", start);
  $("panic").addEventListener("click", panic);
  $("preset").addEventListener("change", () => applyPreset($("preset").value));
  $("polyphony").addEventListener("change", () => send({ type: "polyphony", count: Number($("polyphony").value) }));
  $("velocity").addEventListener("input", () => { $("velocity-value").textContent = $("velocity").value; });
  $("sustain").addEventListener("change", () => setPedal("latch", $("sustain").checked));
  // A window that loses the focus sees no keyup: the space bar lifts the hold.
  window.addEventListener("blur", () => setPedal("space", false));
  $("octave-down").addEventListener("click", () => setOctave(octave - 1));
  $("octave-up").addEventListener("click", () => setOctave(octave + 1));
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  applyLanguage();
  buildKeyboard();
  initPointer();
  setupMidi();
}

init();
