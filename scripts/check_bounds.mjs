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
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FaustWasmDsp, controlKey, uiItems } from "../web/faust-wasm-dsp.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 32000;
const QUANTUM = 128;
const FRAMES = SR / 2;

function load(name) {
  const json = JSON.parse(readFileSync(join(ROOT, "web/dsp", name + ".json"), "utf8"));
  const module = new WebAssembly.Module(readFileSync(join(ROOT, "web/dsp", name + ".wasm")));
  return { json, module };
}

const voiceCode = load("voice");
const bodyCode = load("body");

// The note with one value written raw into both DSPs; the stereo output.
function render(key, value) {
  const voice = new FaustWasmDsp(voiceCode, SR, QUANTUM);
  const body = new FaustWasmDsp(bodyCode, SR, QUANTUM);
  voice.set("freq", 220);
  voice.set("gain", 0.7);
  voice.set(key, value);
  body.set(key, value);
  voice.set("gate", 1);
  const out = new Float64Array(2 * FRAMES);
  for (let t = 0; t < FRAMES; t += QUANTUM) {
    voice.compute(QUANTUM);
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
function differ(a, b) {
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return i;
  return -1;
}

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
  for (const [outside, bound] of [[min - span - 1, min], [max + span + 1, max]]) {
    const a = render(key, outside);
    const b = render(key, bound);
    const i = differ(a, b);
    const finite = a.every(Number.isFinite);
    if (i < 0 && finite) {
      verdicts.push(`${outside} as ${bound}`);
    } else {
      failed += 1;
      verdicts.push(`${outside}: ${finite ? "" : "non-finite, "}differs from ${bound} at frame ${i >> 1} (${a[i]} vs ${b[i]})`);
    }
  }
  console.log(`${verdicts.some((v) => v.includes("differs")) ? "FAIL" : "ok  "} ${key.padEnd(22)} ${verdicts.join("; ")}`);
}
console.log(`${controls.size} controls, ${failed} of ${2 * controls.size} writes out of range differ from their bound`);
process.exit(failed ? 1 : 0);
