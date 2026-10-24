// The page: starts the AudioWorklet at 32 kHz with the voice and the body
// compiled by faust-rs (web/dsp), builds the controls and the presets, and plays
// notes from the on-screen keyboard, the computer keyboard and Web MIDI.
import { CONTROLS, GROUPS, PRESETS } from "./controls.js";
import { controlKey, uiItems } from "./faust-wasm-dsp.js";
import { createOrbit } from "./orbit.js";

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
    keysHelp: "Computer keyboard: two rows from Z and Q, ← → change the octave. Double-click a control to reset it.",
    reset: "reset",
    orbitTab: "Orbit",
    orbitHelp: "Every control is a dot: drag one, or the centre to move them all; Random scatters them. Library opens the presets projected on a plane: click a disc to recall it, drag the cross between discs to morph from one sound to another, double-click to keep the current sound. Play notes while you explore.",
    orbitCenter: "Bring every control back to the centre", orbitRandom: "Scatter the controls at random",
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
    keysHelp: "Clavier d'ordinateur : deux rangées depuis Z et Q (W et A en AZERTY), ← → changent l'octave. Double-cliquez une commande pour la remettre à zéro.",
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
const held = new Set();

function send(message) {
  if (audio.node) audio.node.port.postMessage(message);
}

// The orbit explorer (web/orbit.js), built once the DSPs are loaded, and the
// element it renders into, kept across the rebuilds of the tabs.
let orbit = null;
const orbitHost = document.createElement("div");
orbitHost.id = "orbit-root";
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
    const [voice, body] = await Promise.all([loadDsp("voice"), loadDsp("body")]);
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
  ];
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
      panel.append(help, orbitHost);
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
      markPresetModified();
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
  if (orbit) orbit.setValues([...values]);
  showPresetHelp();
}

function markPresetModified() {
  $("preset-help").textContent = PRESETS.find((x) => x.id === $("preset").value)[lang][1] + " *";
}

// Notes.
function noteOn(key, velocity) {
  if (audio.ctx && audio.ctx.state !== "running") audio.ctx.resume().catch(() => {});
  send({ type: "noteOn", key, velocity });
  held.add(key);
  const el = document.querySelector(`.key[data-key="${key}"]`);
  if (el) el.classList.add("down");
}

function noteOff(key) {
  send({ type: "noteOff", key });
  held.delete(key);
  const el = document.querySelector(`.key[data-key="${key}"]`);
  if (el) el.classList.remove("down");
}

function buildKeyboard() {
  const kb = $("keyboard");
  kb.innerHTML = "";
  const first = 12 * (octave + 1);
  const black = [1, 3, 6, 8, 10];
  for (let k = first; k < first + 37; k += 1) {
    const d = document.createElement("div");
    d.className = "key" + (black.includes(k % 12) ? " black" : "");
    d.dataset.key = k;
    const play = (e) => {
      e.preventDefault();
      d.setPointerCapture?.(e.pointerId);
      // Lower on the key is louder.
      const rect = d.getBoundingClientRect();
      const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      noteOn(k, 0.2 + 0.8 * y);
    };
    d.addEventListener("pointerdown", play);
    d.addEventListener("pointerup", () => noteOff(k));
    d.addEventListener("pointercancel", () => noteOff(k));
    kb.appendChild(d);
  }
  $("octave-value").textContent = String(octave);
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
    octave = Math.max(0, Math.min(7, octave + (e.code === "ArrowLeft" ? -1 : 1)));
    buildKeyboard();
    return;
  }
  const n = keyToNote(e.code);
  if (n >= 0 && !pressed.has(e.code)) {
    pressed.set(e.code, n);
    noteOn(n, Number($("velocity").value) / 127);
  }
}

function onKeyUp(e) {
  const n = pressed.get(e.code);
  if (n !== undefined) {
    pressed.delete(e.code);
    noteOff(n);
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
  if (type === 0x90 && b > 0) noteOn(a, b / 127);
  else if (type === 0x80 || (type === 0x90 && b === 0)) noteOff(a);
  else if (type === 0xe0) setControl("performance/modulation", ((b * 128 + a) - 8192) / 8192 * 2);
  else if (type === 0xb0 && (a === 120 || a === 123)) panic();
}

function panic() {
  for (const k of [...held]) noteOff(k);
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
  $("octave-down").addEventListener("click", () => { octave = Math.max(0, octave - 1); buildKeyboard(); });
  $("octave-up").addEventListener("click", () => { octave = Math.min(7, octave + 1); buildKeyboard(); });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  applyLanguage();
  buildKeyboard();
  setupMidi();
}

init();
