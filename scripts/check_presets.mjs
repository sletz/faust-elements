// Every preset of the web version rendered with its wasm DSPs (web/dsp), as
// the page plays it: the DSPs' defaults, then the preset's values, one voice
// into the body at 32 kHz, a note held for HOLD seconds then released.
//
//   node scripts/check_presets.mjs [KEY...]     (make web-presets)
//
// For each preset and key: the peak and the RMS while the note is held, the RMS
// of the second after the release, in dBFS. A preset fails when its output is
// not finite, peaks above 0 dBFS (the module runs hot: its default patch
// peaks at -1.2 dBFS), or
// stays under -50 dBFS RMS while held (nearly silent). Exit status 1 on a
// failure. Listening stays the judge of the sound: this only catches presets
// that are broken.
//
// KEY: MIDI keys to play each preset on; by default 45, 64 and 76 (A2, E4, E5),
// a low, a middle and a high note. The velocity is 0.7. Inputs: web/dsp (make
// web) and the presets of web/controls.js. Output, on stdout: a table, one row per
// preset and key, with the problems found at the end of the row.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FaustWasmDsp, controlKey, uiItems } from "../web/faust-wasm-dsp.js";
import { PRESETS } from "../web/controls.js";

// The repository root, from this file's location.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The model's rate, Hz, and the frames per compute call (a Web Audio quantum).
const SR = 32000;
const QUANTUM = 128;
// Seconds with the key down, then seconds of release.
const HOLD = 1.5;
const TAIL = 1.0;
const KEYS = process.argv.slice(2).map(Number);
if (!KEYS.length) KEYS.push(45, 64, 76);

/**
 * Loads one of the page's compiled DSPs.
 * @param {string} name - "voice" or "body", the stem of web/dsp/NAME.{json,wasm}
 * @returns {{json: Object, module: WebAssembly.Module}} the program's JSON
 *   description and its compiled module, the argument FaustWasmDsp expects
 */
function load(name) {
  const json = JSON.parse(readFileSync(join(ROOT, "web/dsp", name + ".json"), "utf8"));
  const module = new WebAssembly.Module(readFileSync(join(ROOT, "web/dsp", name + ".wasm")));
  return { json, module };
}

const voiceCode = load("voice");
const bodyCode = load("body");
// The defaults the page starts every preset from.
// Every control with an initial value, by key, from the voice's and the body's
// JSON: a preset gives only the controls it changes, the rest are reset to these,
// so that a preset sounds the same whatever was played before it.
const defaults = new Map();
for (const j of [voiceCode.json, bodyCode.json]) {
  for (const item of uiItems(j.ui)) {
    if (item.init !== undefined) defaults.set(controlKey(item.address), Number(item.init));
  }
}

/**
 * An amplitude in dBFS.
 * @param {number} x - an amplitude, 1 at full scale
 * @returns {number} 20 log10(x), -Infinity for 0
 */
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
let failed = false;
console.log("preset         key  peak dBFS  held rms  tail rms");
for (const p of PRESETS) {
  for (const key of KEYS) {
    const voice = new FaustWasmDsp(voiceCode, SR, QUANTUM);
    const body = new FaustWasmDsp(bodyCode, SR, QUANTUM);
    // Every control to both DSPs, as the page sends it: the preset's value where
    // it has one, the default otherwise.
    for (const [k, v] of defaults) {
      const value = k in p.values ? p.values[k] : v;
      voice.set(k, value);
      body.set(k, value);
    }
    // The note: freq in Hz (A4 = key 69 = 440 Hz), gain the velocity (0 .. 1).
    voice.set("freq", 440 * 2 ** ((key - 69) / 12));
    voice.set("gain", 0.7);
    voice.set("gate", 1);
    // The peak of both channels, and the sums of squares of both channels while
    // held and after the release.
    let peak = 0;
    let held = 0;
    let tail = 0;
    let finite = true;
    const holdFrames = HOLD * SR;
    const total = holdFrames + TAIL * SR;
    for (let t = 0; t < total; t += QUANTUM) {
      // The release at the start of the quantum that contains the end of the hold:
      // the page too changes a control between two quanta.
      if (t === Math.floor(holdFrames / QUANTUM) * QUANTUM) voice.set("gate", 0);
      voice.compute(QUANTUM);
      // The voice's outputs (raw, center, side) are the body's inputs.
      for (let c = 0; c < 3; c += 1) body.input(c).set(voice.output(c));
      body.compute(QUANTUM);
      for (let i = 0; i < QUANTUM; i += 1) {
        for (let c = 0; c < 2; c += 1) {
          const y = body.output(c)[i];
          if (!Number.isFinite(y)) finite = false;
          peak = Math.max(peak, Math.abs(y));
          if (t + i < holdFrames) held += y * y;
          else tail += y * y;
        }
      }
    }
    // The RMS over both channels: the sum of squares over 2 x frames values.
    const heldRms = Math.sqrt(held / (2 * holdFrames));
    const tailRms = Math.sqrt(tail / (2 * (total - holdFrames)));
    const problems = [];
    if (!finite) problems.push("not finite");
    if (peak > 1) problems.push("above 0 dBFS");
    if (db(heldRms) < -50) problems.push("nearly silent");
    if (problems.length) failed = true;
    console.log(`${p.id.padEnd(14)} ${String(key).padStart(3)}  ${db(peak).toFixed(1).padStart(9)}  `
      + `${db(heldRms).toFixed(1).padStart(8)}  ${db(tailRms).toFixed(1).padStart(8)}  ${problems.join(", ")}`);
  }
}
process.exit(failed ? 1 : 0);
