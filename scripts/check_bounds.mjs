// Every control of the web version's DSPs (web/dsp) written outside its declared
// range, as a host may (Faust does not bound a control by its range, and the
// page's host writes what it is given): the note must sound exactly as with the
// control at its nearest bound, sample for sample, and stay finite.
//
//   node scripts/check_bounds.mjs      (make web-bounds)
//
// For each control of the voice and the body but freq and gate (the note's), and
// for the velocity (gain): A3 is played for half a second with the control at
// min - (max - min) - 1, then at min, and compared; then at max + (max - min) + 1
// against max. Prints one line per control and exits 1 when one differs.
//
// The distance past the bound is the control's span plus 1, so that a control of
// small range (a few tenths) is still written well outside it. "Exactly" is bit
// for bit: the comparison uses Object.is, under which two NaN agree and 0 and -0
// do not. Inputs: web/dsp (make web). Output, on stdout: `ok` or `FAIL`, the
// control's key and both verdicts, one line per control, then the count of
// writes that differ from their bound.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FaustWasmDsp, controlKey, uiItems } from "../web/faust-wasm-dsp.js";

// The repository root, from this file's location.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The model's rate, Hz, the frames per compute call (a Web Audio quantum), and the
// length of each render: half a second, the key held throughout.
const SR = 32000;
const QUANTUM = 128;
const FRAMES = SR / 2;

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

// The note with one value written raw into both DSPs; the stereo output.
/**
 * Plays A3 (220 Hz, velocity 0.7) for FRAMES frames, one voice into the body,
 * from fresh instances, every other control at its default.
 * @param {string} key - the control written ("exciter/bow"; "gain" overrides the
 *   velocity); a DSP that does not have it ignores it
 * @param {number} value - the value written, unclamped
 * @returns {Float64Array} the body's main and aux outputs, interleaved: frame f at
 *   2 f and 2 f + 1
 */
function render(key, value) {
  const voice = new FaustWasmDsp(voiceCode, SR, QUANTUM);
  const body = new FaustWasmDsp(bodyCode, SR, QUANTUM);
  voice.set("freq", 220);
  voice.set("gain", 0.7);
  voice.set(key, value);
  body.set(key, value);
  // The gate last, so that the note starts with every control already written.
  voice.set("gate", 1);
  const out = new Float64Array(2 * FRAMES);
  for (let t = 0; t < FRAMES; t += QUANTUM) {
    voice.compute(QUANTUM);
    // The voice's outputs (raw, center, side) are the body's inputs.
    for (let c = 0; c < 3; c += 1) body.input(c).set(voice.output(c));
    body.compute(QUANTUM);
    for (let i = 0; i < QUANTUM; i += 1) {
      out[2 * (t + i)] = body.output(0)[i];
      out[2 * (t + i) + 1] = body.output(1)[i];
    }
  }
  return out;
}

// The first differing sample, or -1.
/**
 * Compares two renders bit for bit (Object.is).
 * @param {Float64Array} a
 * @param {Float64Array} b - of the same length as `a`
 * @returns {number} the index of the first differing sample (interleaved, so the
 *   frame is the index / 2), or -1 when the renders are identical
 */
function differ(a, b) {
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return i;
  return -1;
}

// The controls checked, by key, with their declared [min, max]: every control with
// a range of both DSPs but the note's frequency and gate, once each (a control the
// voice and the body share is listed once). The velocity, `gain`, is included.
const controls = new Map();
for (const j of [voiceCode.json, bodyCode.json]) {
  for (const item of uiItems(j.ui)) {
    const key = controlKey(item.address);
    if (item.min === undefined || key === "freq" || key === "gate") continue;
    controls.set(key, [Number(item.min), Number(item.max)]);
  }
}

let failed = 0;
for (const [key, [min, max]] of controls) {
  const span = max - min;
  const verdicts = [];
  // Below the range against min, then above it against max.
  for (const [outside, bound] of [[min - span - 1, min], [max + span + 1, max]]) {
    const a = render(key, outside);
    const b = render(key, bound);
    const i = differ(a, b);
    const finite = a.every(Number.isFinite);
    if (i < 0 && finite) {
      verdicts.push(`${outside} as ${bound}`);
    } else {
      failed += 1;
      // `i >> 1`: the interleaved index to the frame.
      verdicts.push(`${outside}: ${finite ? "" : "non-finite, "}differs from ${bound} at frame ${i >> 1} (${a[i]} vs ${b[i]})`);
    }
  }
  console.log(`${verdicts.some((v) => v.includes("differs")) ? "FAIL" : "ok  "} ${key.padEnd(22)} ${verdicts.join("; ")}`);
}
console.log(`${controls.size} controls, ${failed} of ${2 * controls.size} writes out of range differ from their bound`);
process.exit(failed ? 1 : 0);
