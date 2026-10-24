// Random patches through the web version's wasm DSPs (web/dsp), as the orbit's
// Random button makes them: every control of the voice and the body drawn in
// its range (the model a whole number), a note of random key and velocity held
// then released, one voice into the body at 32 kHz, with the guard of
// web/elements-processor.js: a voice output beyond VOICE_GUARD (or not finite)
// clears the voice, as the module's panic resets it. Elements itself diverges
// on some patches (a lossless string under a strong bow), so such clears are
// counted, not failed. A patch fails when what reaches the body's output is
// not finite or exceeds BODY_GUARD. Also counts the patches whose voice output
// passes LOUD without being cleared (loud but bounded).
//
//   node scripts/fuzz_web.mjs [TRIALS] [SEED]     (make web-fuzz)
//
// Exit status 1 when one patch fails.
//
// TRIALS: the number of patches (default 300; make web-fuzz plays 2000). SEED: the
// generator's seed (default 1); the same TRIALS and SEED give the same patches,
// so that a failure can be replayed. Inputs: web/dsp (make web). Output, on
// stdout: for each failing patch, where it failed, its key, velocity and controls
// as JSON; then one summary line.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FaustWasmDsp, controlKey, uiItems } from "../web/faust-wasm-dsp.js";

// The repository root, from this file's location.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The model's rate, Hz, and the frames per compute call (a Web Audio quantum).
const SR = 32000;
const QUANTUM = 128;
const TRIALS = Number(process.argv[2] || 300);
let seed = Number(process.argv[3] || 1);
// The worklet's limit on a voice's output (web/elements-processor.js): 1000 is far
// above anything a sound that converges produces, and far below what a diverging
// one reaches.
const VOICE_GUARD = 1e3;
// The limit on the body's output: with the voice guarded, the body should never
// come near it; reaching it means the body itself diverged.
const BODY_GUARD = 1e6;
// A voice output above this, but under the guard, is counted as loud.
const LOUD = 100;
// The note's controls, set by the note rather than drawn.
const NOTE = ["freq", "gain", "gate"];

// A small deterministic generator, so that a failure can be replayed.
/**
 * The next number of a 32-bit linear congruential generator (the constants of
 * Numerical Recipes, also those of stmlib::Random), seeded by SEED; `>>> 0` keeps
 * the state an unsigned 32-bit integer.
 * @returns {number} a number in [0, 1)
 */
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

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
// The controls drawn: every control with a range (not a button nor a checkbox) of
// the voice and the body but the note's, once each, though both DSPs declare the
// controls they share.
const controls = [];
for (const j of [voiceCode.json, bodyCode.json]) {
  for (const item of uiItems(j.ui)) {
    const key = controlKey(item.address);
    if (item.min === undefined || NOTE.includes(key)) continue;
    if (controls.some((c) => c.key === key)) continue;
    controls.push({ key, min: Number(item.min), max: Number(item.max), step: Number(item.step) });
  }
}

let failures = 0;
let loud = 0;
let clears = 0;
for (let trial = 0; trial < TRIALS; trial += 1) {
  // Each control uniform in its range; a control with a step of 1 or more (the
  // model) rounded to a whole number.
  const patch = {};
  for (const c of controls) {
    let v = c.min + random() * (c.max - c.min);
    if (c.step >= 1) v = Math.round(v);
    patch[c.key] = v;
  }
  // A key from 24 to 108 (C1 to C8, the page's keyboard), a velocity in [0, 1).
  const key = 24 + Math.floor(random() * 85);
  const velocity = random();
  const voice = new FaustWasmDsp(voiceCode, SR, QUANTUM);
  const body = new FaustWasmDsp(bodyCode, SR, QUANTUM);
  for (const [k, v] of Object.entries(patch)) {
    voice.set(k, v);
    body.set(k, v);
  }
  voice.set("freq", 440 * 2 ** ((key - 69) / 12));
  voice.set("gain", velocity);
  voice.set("gate", 1);
  // `where` describes the first failure, which ends the trial.
  let where = null;
  let cleared = false;
  let peakVoice = 0;
  let peakBody = 0;
  // One second, the key released at the quantum that starts at half of it.
  const frames = SR;
  for (let t = 0; t < frames && !where; t += QUANTUM) {
    if (t === (frames / 2) - ((frames / 2) % QUANTUM)) voice.set("gate", 0);
    voice.compute(QUANTUM);
    // The worklet's guard. `!(|x| <= limit)` is true for NaN as well, which every
    // comparison fails; the peak is taken over the values within the guard.
    let guard = false;
    for (let c = 0; c < 3; c += 1) {
      const o = voice.output(c);
      for (let i = 0; i < QUANTUM; i += 1) {
        if (!(Math.abs(o[i]) <= VOICE_GUARD)) guard = true;
        else peakVoice = Math.max(peakVoice, Math.abs(o[i]));
      }
    }
    if (guard) {
      voice.clear();
      cleared = true;
    }
    // A guarded quantum sends silence to the body, as the worklet does.
    for (let c = 0; c < 3; c += 1) {
      if (guard) body.input(c).fill(0);
      else body.input(c).set(voice.output(c));
    }
    body.compute(QUANTUM);
    for (let c = 0; c < 2 && !where; c += 1) {
      const o = body.output(c);
      for (let i = 0; i < QUANTUM; i += 1) {
        if (!(Math.abs(o[i]) <= BODY_GUARD)) {
          where = `body output ${c} at frame ${t + i}: ${o[i]}`;
          break;
        }
        peakBody = Math.max(peakBody, Math.abs(o[i]));
      }
    }
  }
  // A patch is counted once: cleared, or else loud.
  if (cleared) clears += 1;
  else if (peakVoice > LOUD) loud += 1;
  if (where) {
    failures += 1;
    console.log(`trial ${trial}: ${where}; key ${key}, velocity ${velocity.toFixed(3)}`);
    console.log("  " + JSON.stringify(patch));
  }
}
console.log(`${failures} of ${TRIALS} random patches failed; the guard cleared the voice of ${clears} `
  + `(diverging, as the C++ can); ${loud} were loud (voice above ${LOUD}) and bounded`);
process.exit(failures ? 1 : 0);
