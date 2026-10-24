// The page: starts the AudioWorklet at 32 kHz with the voice and the body
// compiled by faust-rs (web/dsp), builds the controls and the presets, and plays
// notes from the on-screen keyboard, the computer keyboard and Web MIDI.
//
// It also ties together the views of the sound: the tabs of controls (controls.js), the
// orbit of the controls (orbit.js), the atlas of sounds and its small map (atlas.js), the
// timbre orbit (timbre.js) and the phone app (pwa.js). Every change of a control goes
// through setControl, which sends it to the worklet and moves the slider, the orbit and,
// through a measure by the worker, the diamond of the current sound on the atlas.
//
// Messages to the AudioWorklet (elements-processor.js): noteOn, noteOff, control,
// polyphony, panic; from it: ready, and stats every 0.25 s (load, voices, level meters).
// Messages to the Worker (measure-worker.js): init, measure, search; from it: measured
// and found.
//
// The file in order: the texts, the state, the controls and the audio start, the tabs and
// the side-by-side layout, the atlas, the current sound and the timbre orbit, the orbit
// and the presets, the notes and the hold, the on-screen keyboard, the computer keyboard,
// Web MIDI, the language, and init.
import { CONTROLS, GROUPS, PRESETS } from "./controls.js";
import { controlKey, uiItems } from "./faust-wasm-dsp.js";
import { createAtlas } from "./atlas.js";
import { project } from "./describe.js";
import { createOrbit } from "./orbit.js";
import { createPhoneTab } from "./pwa.js";
import { createTimbreOrbit, nearestSound, percentile, quantile, timbreTable } from "./timbre.js";

// The compiled DSPs, voice.{json,wasm} and body.{json,wasm}, written by `make web`.
const DSP_DIR = "dsp/";
// The module's sample rate: every table and delay of the model is computed for it.
const SAMPLE_RATE = 32000;

// The page's words in English and French, by key. The elements of index.html with a
// `data-text` attribute take theirs from here (applyLanguage); the controls' and the
// presets' are in controls.js.
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
    split: "Drag to share the width between the two sides (arrow keys too); double-click for the default.",
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
    split: "Glissez pour partager la largeur entre les deux côtés (flèches aussi) ; double-cliquez pour revenir au partage par défaut.",
  },
};

// The language, from the browser's, changed by the language buttons; `t` reads a text in
// it; `$` finds an element by id.
let lang = (navigator.language || "en").startsWith("fr") ? "fr" : "en";
const t = (k) => TEXT[lang][k];
const $ = (id) => document.getElementById(id);

// The audio state: the context, the worklet node, the DSPs' JSON.
const audio = { ctx: null, node: null, json: null, starting: false };
// Control values by key, and their ranges from the JSON.
const values = new Map();
const ranges = new Map();
// The octave of the computer keyboard's lower row: its C is MIDI key 12 * (octave + 1).
let octave = 4;
// A key sounds while one source at least holds it: a pointer, a computer key
// and a MIDI input can hold the same key; the note is released with the last.
const sources = new Map(); // key -> set of sources ("p<pointer id>", "kbd", "midi")
const isHeld = (key) => (sources.get(key)?.size ?? 0) > 0;
// The keyboard on the page: C1 to C8, in a box that scrolls.
const FIRST_KEY = 24;
const LAST_KEY = 108;
const keyElements = new Map();

/**
 * Posts a message to the AudioWorklet, if audio has started.
 * @param {Object} message - one of the messages listed in elements-processor.js
 */
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
// `measuring` while a measure is in flight, `measureAgain` when a change came meanwhile.
let worker = null;
let measureTimer = 0;
let measuring = false;
let measureAgain = false;
let soundMark = null; // the current sound on the atlas
let soundD = null; // its descriptors
let targetMark = null; // the sound the timbre orbit asks for
let timbreTarget = null; // its percentiles
// Who changed the sound last: "timbre" while the timbre orbit drives it.
// `applyingTimbre` while the timbre orbit's patch is being set, so that setControl does
// not end its request; `searchId` numbers the searches (an answer to an older one is
// ignored), `searchTimer` waits for the dots to rest.
let changeSource = "other";
let applyingTimbre = false;
let searchId = 0;
let searchTimer = 0;
// True while a preset sets every control, so that the orbit is updated once.
let batching = false;

/**
 * Sets a control everywhere: the values, the orbit (unless the change comes from it, or a
 * batch sets the orbit once at its end), the worklet, and the slider's row. A change from
 * outside the timbre orbit ends its request, and the current sound is measured again
 * (once at the end of a batch).
 * @param {string} key - the control's key ("exciter/bow")
 * @param {number} value - its value, in the control's own units
 * @param {boolean} [fromOrbit] - the orbit moved it: the orbit is not told again, and an
 *   unchanged value is dropped
 */
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

/**
 * A control's value as its row shows it: whole for a stepped control, else three
 * decimals.
 * @param {string} key - the control's key
 * @param {number} v - its value
 * @returns {string}
 */
function format(key, v) {
  const r = ranges.get(key);
  return r && r.step >= 1 ? String(Math.round(v)) : Number(v).toFixed(3);
}

/**
 * Fetches a DSP compiled by `make web` (its JSON and its wasm) and compiles the module.
 * @param {string} name - "voice" or "body"
 * @returns {Promise<{json: Object, module: WebAssembly.Module}>}
 */
async function loadDsp(name) {
  const [json, module] = await Promise.all([
    fetch(DSP_DIR + name + ".json").then((r) => r.json()),
    fetch(DSP_DIR + name + ".wasm").then(async (r) => WebAssembly.compile(await r.arrayBuffer())),
  ]);
  return { json, module };
}

/**
 * The Start button. Once audio has started it suspends or resumes the context. The first
 * time it creates the context at 32 kHz (the browser resamples to the device), loads the
 * worklet, the DSPs and the atlas, starts the worker, makes the worklet's node, builds
 * the controls and applies the selected preset, which sends every control to the worklet.
 * On failure the error is shown and the context closed: `audio.ctx` stays null, so
 * another click tries again.
 * @returns {Promise<void>}
 */
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
    // No input, one stereo output; the compiled modules cross into the worklet by
    // structured clone, so it instantiates them without compiling them again.
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

/**
 * The line under the page that says which compiler built the DSPs and how.
 * @returns {string} "faust-rs <version>, <compile options>", from the voice's JSON
 */
function buildLine() {
  const j = audio.json.voice;
  return `faust-rs ${j.version || ""}, ${j.compile_options || ""}`;
}

/**
 * A message from the worklet: the "stats" fill the load, voices and level meters ("ready"
 * needs nothing). The load bar stops at 100 %, its figure does not; the level meter spans
 * -60 to 0 dBFS of the peak amplitude.
 * @param {Object} m - the message
 */
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

// What a note writes on its voice: never a control of the patch, or loading a
// patch (a preset, a dot of the atlas) would retune every sounding note to the
// sliders' defaults.
const NOTE_CONTROLS = new Set(["freq", "gain", "gate"]);

// The ranges and defaults of every control of the patch, from the voice's and
// the body's JSON.
/**
 * Reads every control's {min, max, step, init} into `ranges`, and gives a control that
 * has no value yet its default.
 */
function readRanges() {
  for (const j of [audio.json.voice, audio.json.body]) {
    for (const item of uiItems(j.ui)) {
      if (item.min === undefined || NOTE_CONTROLS.has(controlKey(item.address))) continue;
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
/**
 * Builds the tab bar and its panels: one per group of controls that the DSPs have, then
 * the Orbit, Atlas and Phone tabs, and shows the tab last shown. Called at the start of
 * audio and when the language changes; the orbit's, the atlas's and the map's hosts are
 * kept across rebuilds, the atlas and the timbre orbit made again in the new language.
 */
function buildControls() {
  const root = $("controls");
  root.innerHTML = "";
  const groups = [
    ...GROUPS.filter((g) => CONTROLS.some((c) => c.group === g.id && ranges.has(c.key))),
    { id: "orbit", en: TEXT.en.orbitTab, fr: TEXT.fr.orbitTab },
    { id: "atlas", en: TEXT.en.atlasTab, fr: TEXT.fr.atlasTab },
    { id: "phone", en: "Phone", fr: "Téléphone" },
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
    // The phone app (web/pwa.js): its mappings, their simulation, its build.
    if (g.id === "phone") {
      panel.classList.add("phone-panel");
      createPhoneTab(panel, {
        lang,
        controls: CONTROLS,
        ranges,
        values,
        setControl,
        presetName: () => (PRESETS.find((p) => p.id === $("preset").value) || PRESETS[0])[lang][0],
        polyphony: () => Number($("polyphony").value),
      });
    }
    // A row per control: its name, a slider (whole steps for a stepped control, else
    // 0.001), its value and its explanation. Moving the slider sets the control and marks
    // the preset modified; a double click resets the control to its default.
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

/**
 * Shows a tab and hides the other panels; the tab list follows the ARIA pattern (one tab
 * selected and focusable). The orbit, the atlas and the map are built or laid out again
 * when their tab is shown, since they lay themselves out from their size.
 * @param {string} id - the tab's id (a group's, "orbit", "atlas" or "phone")
 */
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

// The shares of the side-by-side layouts (sideBySide, below): the left side's fraction of
// the width, remembered by the browser per layout under SPLIT_STORE + its class name.
const SPLIT_STORE = "faust-elements-split-";
const SPLIT_MIN = 220; // px, the narrowest side

/**
 * A main element and, beside it on a wide page (below it otherwise), a column with a
 * title, a help line and more elements, with a separator between them that shares the
 * width (on wide screens only, where they stand side by side). The share is set through
 * the CSS custom properties --split-left and --split-right, as grid fractions; the
 * separator is dragged, moved by the arrow keys (2 % a press), and double-clicked for the
 * default.
 * @param {HTMLElement} main - the main element, on the left
 * @param {string} className - the layout's class, also its key in the storage
 * @param {string} title - the column's title
 * @param {string} help - the column's help line
 * @param {...HTMLElement} side - the column's other elements
 * @returns {HTMLElement} the layout
 */
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
  const split = document.createElement("div");
  split.className = "side-split";
  split.tabIndex = 0;
  split.title = t("split");
  split.setAttribute("role", "separator");
  split.setAttribute("aria-orientation", "vertical");
  split.setAttribute("aria-label", t("split"));
  layout.append(left, split, right);

  const key = SPLIT_STORE + className;
  // The left side's fraction of the width, or null for the layout's default.
  const share = (f) => {
    if (f == null) {
      layout.style.removeProperty("--split-left");
      layout.style.removeProperty("--split-right");
      split.removeAttribute("aria-valuenow");
      return;
    }
    layout.style.setProperty("--split-left", `${f}fr`);
    layout.style.setProperty("--split-right", `${1 - f}fr`);
    split.setAttribute("aria-valuenow", String(Math.round(100 * f)));
  };
  // A share that leaves each side at least SPLIT_MIN px, or the half when the layout is
  // narrower than two of them.
  const clampShare = (f) => {
    const width = layout.clientWidth - split.offsetWidth;
    const min = width > 2 * SPLIT_MIN ? SPLIT_MIN / width : 0.5;
    return Math.min(Math.max(f, min), 1 - min);
  };
  // Stores a share, or forgets it (null), when the browser allows it.
  const remember = (f) => {
    try {
      if (f == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(f));
    } catch {
      // Storage refused: the share lasts as long as the page.
    }
  };
  try {
    const stored = Number(localStorage.getItem(key));
    if (stored > 0 && stored < 1) share(stored);
  } catch {
    // Storage refused: the default share.
  }
  // The share as laid out; a drag moves the separator's middle to the pointer, and the
  // share is stored when the drag ends.
  const current = () => left.offsetWidth / (left.offsetWidth + right.offsetWidth);
  let dragging = false;
  split.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    split.classList.add("active");
    split.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  split.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = layout.getBoundingClientRect();
    const width = rect.width - split.offsetWidth;
    share(clampShare((e.clientX - rect.left - split.offsetWidth / 2) / width));
  });
  // The end of a drag: the share as laid out is stored.
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    split.classList.remove("active");
    remember(current());
  };
  split.addEventListener("pointerup", stop);
  split.addEventListener("pointercancel", stop);
  split.addEventListener("dblclick", () => {
    share(null);
    remember(null);
  });
  split.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -0.02, ArrowRight: 0.02 }[e.key];
    if (!step) return;
    e.preventDefault();
    const f = clampShare(current() + step);
    share(f);
    remember(f);
  });
  return layout;
}

// A preset's name in the page's language, by id (the id itself if unknown).
const presetName = (id) => PRESETS.find((p) => p.id === id)?.[lang][0] ?? id;

/**
 * The atlas in its tab (with the timbre orbit), or the small map beside the orbit, built
 * the first time it is shown, laid out again afterwards; without web/atlas.json, a line
 * that says how to make it.
 * @param {HTMLElement} host - atlasHost or miniHost
 * @param {boolean} compact - the small map
 */
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

// The current sound measured after a change, 120 ms after the last one. One measure is in
// flight at a time: a change while it runs asks for another one when it is answered, with
// the values of that time.
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

/**
 * A sound on the atlas: its descriptors in the atlas's order, its coordinates, as
 * atlas.js's setSound and setTarget take it.
 * @param {Object<string, number>} d - descriptors by name
 * @param {boolean} [censored] - its decay was extrapolated
 * @returns {{d: number[], pc: number[], c: boolean}}
 */
function markOf(d, censored = false) {
  return { d: atlasData.axes.map((a) => d[a]), pc: project(atlasData, d), c: censored };
}

// A sound's percentiles among the atlas's sounds, by descriptor, rounded to the timbre
// orbit's step (0.01).
const ranksOf = (d) => Object.fromEntries(atlasData.axes.map((a) => [a, Number(percentile(atlasTable.table[a], d[a]).toFixed(2))]));

/**
 * A message from the worker. "measured": the current sound's place on both maps, then
 * either the gap to what the timbre orbit asked for, when it drives the sound, or the
 * timbre orbit's dots moved to the sound. "found": the search's patch, applied only if it
 * answers the latest search and the timbre orbit still drives the sound.
 * @param {Object} m - the message (see measure-worker.js)
 */
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

/**
 * The timbre orbit asks for a sound: the nearest sound of the atlas at once
 * (nearestSound, of the current model when it is almost as near), then a search by
 * measures once the dots rest (350 ms), from the current values over the continuous
 * controls (the model stays), 40 renders in the worker. The target is marked on the atlas
 * as the descriptors at those percentiles (quantile), projected.
 * @param {Object<string, number>} target - the percentiles asked for, by descriptor
 */
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

/**
 * The atlas's controls of a patch, set as the timbre orbit's: as one batch (the orbit
 * moved once, one measure), without ending the timbre orbit's request.
 * @param {Object<string, number>} patch - control values by key
 */
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

// A change from elsewhere ends the timbre orbit's request: the target's ring and the gap
// go, and a search still running is answered in vain (searchId moves on).
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

// The timer that releases the note of the sound last loaded from the atlas.
let auditionTimer = 0;
/**
 * A sound of the atlas: its patch over the defaults, as a preset is, then the note it was
 * measured with. The preset menu shows the preset if the sound is one, else marks the
 * last one modified. The note is played by the source "atlas" for the atlas's hold (1 s);
 * a second click restarts it.
 * @param {number} index - the point's index in atlas.json's points
 * @param {boolean} play - also play the note
 */
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

/**
 * The orbit of the controls (orbit.js), with the page's presets and values; a dot moved
 * sets its control as coming from the orbit, then the preset menu follows.
 * @returns {Object} the orbit's handle: setValues, resize, presetOf
 */
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

/** The preset menu, in the page's language, and the selected preset's description. */
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

/** The selected preset's description under the menu. */
function showPresetHelp() {
  const p = PRESETS.find((x) => x.id === $("preset").value) || PRESETS[0];
  $("preset-help").textContent = p[lang][1];
}

/**
 * Loads a preset: every control at its value, else at its default, as one batch; the
 * timbre orbit's request ends, the orbit follows, and the sound is measured.
 * @param {string} id - the preset's id
 */
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

// The timer of followOrbit, restarted by every change of the orbit.
let followTimer = 0;
/**
 * After the orbit moved controls (a preset recalled from its library, a morph,
 * a drag), the menu shows the preset the sound now is exactly, else the last
 * one marked modified. Checked once the orbit's burst of changes is over (30 ms
 * after the last change).
 */
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

/** Marks the selected preset modified: its description followed by " *". */
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
// Whether the hold is down: any of its sources is.
const pedalDown = () => pedal.latch || pedal.space || pedal.midi;

/**
 * One source of the hold goes down or up; lifting the last one releases every sustained
 * key.
 * @param {"latch"|"space"|"midi"} source - the switch on the page, the space bar, CC64
 * @param {boolean} down
 */
function setPedal(source, down) {
  pedal[source] = down;
  if (source === "latch") $("sustain").checked = down;
  $("sustain-state").classList.toggle("on", pedalDown());
  if (!pedalDown()) {
    for (const key of [...sustained]) release(key);
  }
}

/**
 * A key's look: "down" while a source holds it, "sustained" while only the hold keeps it.
 * @param {number} key - MIDI key
 */
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
 * @param {string} source - who holds it: "p<pointer id>", "kbd:<key code>", "midi",
 *   "atlas"
 */
function noteOn(key, velocity, source) {
  // A context the browser has suspended resumes on the first note.
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

/**
 * Sends the release of a key no longer held nor sustained.
 * @param {number} key - MIDI key
 */
function release(key) {
  sustained.delete(key);
  send({ type: "noteOff", key });
  showKey(key);
}

// The pitch classes of the black keys, and the names of the twelve.
const BLACK = [1, 3, 6, 8, 10];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * The keys C1 to C8, each C labelled, built once: a div per key with its MIDI key in
 * `data-key`, the black ones laid over the white ones by the style sheet.
 */
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

/**
 * The keys the computer keyboard plays (two rows from the octave), marked, and the view
 * scrolled to them: 25 keys from the octave's C, the box scrolled so that this C stands
 * 24 CSS px from its left edge.
 */
function showOctave() {
  const first = 12 * (octave + 1);
  for (const [k, el] of keyElements) el.classList.toggle("kbd", k >= first && k <= first + 24);
  $("octave-value").textContent = String(octave);
  const el = keyElements.get(Math.max(FIRST_KEY, first));
  const box = $("keyboard").parentElement;
  if (el && box) box.scrollLeft = Math.max(0, el.offsetLeft - 24);
}

/**
 * @param {number} o - the computer keyboard's octave, clamped to 0..7
 */
function setOctave(o) {
  octave = Math.max(0, Math.min(7, o));
  showOctave();
}

/**
 * The key under a point of the window, or null. A captured pointer's events all go to the
 * keyboard, so the key is found from the point, which also lets a finger slide from key
 * to key.
 * @param {number} x - clientX
 * @param {number} y - clientY
 * @returns {?{el: HTMLElement, key: number}} the key's element and MIDI key
 */
function keyAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest(".key");
  return el && el.dataset.key ? { el, key: Number(el.dataset.key) } : null;
}

/**
 * Lower on a key is louder: the velocity grows linearly from 0.2 at the top of the key to
 * 1 at its bottom.
 * @param {PointerEvent} e - the pointer
 * @param {HTMLElement} el - the key
 * @returns {number} the velocity, in [0.2, 1]
 */
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
  // A captured pointer that moves onto another key releases its key and strikes the new
  // one, at the velocity of the new point.
  kb.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const hit = keyAt(e.clientX, e.clientY);
    const old = pointers.get(e.pointerId);
    if (!hit || hit.key === old) return;
    noteOff(old, "p" + e.pointerId);
    pointers.set(e.pointerId, hit.key);
    noteOn(hit.key, velocityAt(e, hit.el), "p" + e.pointerId);
  });
  // A pointer lifted or lost releases the key it holds.
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    noteOff(pointers.get(e.pointerId), "p" + e.pointerId);
    pointers.delete(e.pointerId);
  };
  kb.addEventListener("pointerup", up);
  kb.addEventListener("pointercancel", up);
}

// Two rows of the computer keyboard, by physical key (KeyboardEvent.code), whatever the
// layout: each a chromatic octave plus one from C, the lower row from the octave's C
// (Z S X D C V G B H N J M and the comma), the upper row an octave higher
// (Q 2 W 3 E R 5 T 6 Y 7 U I).
// `pressed` keeps, for every physical key down, the note it started, so that its release
// ends that note even if the octave changed meanwhile.
const ROW_LOW = ["KeyZ", "KeyS", "KeyX", "KeyD", "KeyC", "KeyV", "KeyG", "KeyB", "KeyH", "KeyN", "KeyJ", "KeyM", "Comma"];
const ROW_HIGH = ["KeyQ", "Digit2", "KeyW", "Digit3", "KeyE", "KeyR", "Digit5", "KeyT", "Digit6", "KeyY", "Digit7", "KeyU", "KeyI"];
const pressed = new Map();

/**
 * @param {string} code - a KeyboardEvent.code
 * @returns {number} the MIDI key it plays at the current octave, -1 for none
 */
function keyToNote(code) {
  let i = ROW_LOW.indexOf(code);
  if (i >= 0) return 12 * (octave + 1) + i;
  i = ROW_HIGH.indexOf(code);
  if (i >= 0) return 12 * (octave + 2) + i;
  return -1;
}

/**
 * A key pressed: ignored in inputs (sliders, switches) and menus, in the orbits (they have
 * their own keys), on the tabs (the arrows move between them), and when repeated. The
 * arrows change the octave, the space bar is a source of the hold, the two rows play
 * notes at the page's velocity (its slider's value over 127), each physical key a source
 * of its own.
 * @param {KeyboardEvent} e
 */
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

/**
 * A key released: the space bar lifts its hold, a playing key releases its note.
 * @param {KeyboardEvent} e
 */
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
    // The input menu, rebuilt whenever a device comes or goes, keeping its selection;
    // every input gets a handler that plays only if it is the one selected, or all are.
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

/**
 * A MIDI message, on any channel: note on (velocity 0 counts as a note off), note off,
 * pitch bend (14 bits centred on 8192, mapped to -2..2 semitones on the pitch offset),
 * sustain pedal (CC64, down from 64), all sound off (CC120) and all notes off (CC123).
 * @param {Uint8Array} data - the status byte and its two data bytes
 */
function midi([status, a, b]) {
  const type = status & 0xf0;
  if (type === 0x90 && b > 0) noteOn(a, b / 127, "midi");
  else if (type === 0x80 || (type === 0x90 && b === 0)) noteOff(a, "midi");
  else if (type === 0xe0) setControl("performance/modulation", ((b * 128 + a) - 8192) / 8192 * 2);
  else if (type === 0xb0 && a === 64) setPedal("midi", b >= 64);
  else if (type === 0xb0 && (a === 120 || a === 123)) panic();
}

/**
 * All notes off: no source holds a key any more, the hold's keys are forgotten, and the
 * worklet silences every voice.
 */
function panic() {
  sources.clear();
  sustained.clear();
  for (const k of keyElements.keys()) showKey(k);
  send({ type: "panic" });
}

/**
 * Writes the page in `lang`: the texts of index.html, the Start button, the preset menu,
 * and the controls' tabs (rebuilt, once the DSPs are loaded).
 */
function applyLanguage() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-text]")) el.textContent = t(el.dataset.text);
  $("start").textContent = audio.ctx && audio.ctx.state === "running" ? t("stop") : t("start");
  buildPresets();
  if (audio.json) buildControls();
  for (const b of document.querySelectorAll("[data-lang]")) b.classList.toggle("on", b.dataset.lang === lang);
}

/**
 * Wires the page's buttons, menus and keys, writes the page in its language, and builds
 * the keyboard and the pointer and MIDI inputs. Audio waits for the Start button: a
 * browser starts an AudioContext only after a gesture.
 */
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
