// The web version's DSPs (web/dsp, faust-rs -lang wasm) against faustprobe, and
// their cost, under node:
//
//   node scripts/web_check.mjs      (make web-check)
//
// Renders, at 32 kHz, the voice of web/dsp/voice.wasm and the body of
// web/dsp/body.wasm as the AudioWorklet does (one voice summed into the body),
// for a few notes, and the same notes through faustprobe --nvoices 1 on
// dsp/elements_poly.dsp in single precision; prints the largest difference in dB
// of the peak and the cost of the wasm per second of audio. Exit status 1 beyond
// -60 dB.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FaustWasmDsp } from "../web/faust-wasm-dsp.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAUSTPROBE = process.env.FAUSTPROBE || join(ROOT, "../faust-rs/target/release/faustprobe");
const SR = 32000;
const QUANTUM = 128;
const FRAMES = 3 * SR;

function load(name) {
  const json = JSON.parse(readFileSync(join(ROOT, "web/dsp", name + ".json"), "utf8"));
  const module = new WebAssembly.Module(readFileSync(join(ROOT, "web/dsp", name + ".wasm")));
  return { json, module };
}

// A .npy file of float64 or float32 (faustprobe --out), as an array of rows.
function readNpy(path) {
  const buf = readFileSync(path);
  const headerLen = buf.readUInt16LE(8);
  const header = buf.subarray(10, 10 + headerLen).toString("latin1");
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  const shape = /'shape':\s*\((\d+),\s*(\d*)\)/.exec(header);
  const rows = Number(shape[1]);
  const cols = Number(shape[2] || 1);
  const data = buf.subarray(10 + headerLen);
  const bytes = descr.endsWith("8") ? 8 : 4;
  const out = [];
  for (let r = 0; r < rows; r += 1) {
    const row = [];
    for (let c = 0; c < cols; c += 1) {
      const o = (r * cols + c) * bytes;
      row.push(bytes === 8 ? data.readDoubleLE(o) : data.readFloatLE(o));
    }
    out.push(row);
  }
  return out;
}

const CASES = [
  { name: "struck A3", key: 57, velocity: 100, set: {} },
  { name: "bowed glass", key: 45, velocity: 90, set: { "exciter/strike": 0, "exciter/bow": 0.85, "exciter/envelope": 0.5, "resonator/geometry": 0.85 } },
  { name: "string chord", key: 50, velocity: 110, set: { "resonator/model": 2, "resonator/geometry": 0.45, "space/space": 1.1 } },
];

const voiceCode = load("voice");
const bodyCode = load("body");
let failed = false;
const tmp = mkdtempSync(join(tmpdir(), "elements-web-"));
try {
  for (const c of CASES) {
    const voice = new FaustWasmDsp(voiceCode, SR, QUANTUM);
    const body = new FaustWasmDsp(bodyCode, SR, QUANTUM);
    for (const [k, v] of Object.entries(c.set)) {
      voice.set(k, v);
      body.set(k, v);
    }
    voice.set("freq", 440 * 2 ** ((c.key - 69) / 12));
    voice.set("gain", c.velocity / 127);
    voice.set("gate", 1);
    const out = [];
    let seconds = 0;
    for (let t = 0; t < FRAMES; t += QUANTUM) {
      if (t === SR) voice.set("gate", 0);
      const t0 = performance.now();
      voice.compute(QUANTUM);
      for (let ch = 0; ch < 3; ch += 1) body.input(ch).set(voice.output(ch));
      body.compute(QUANTUM);
      seconds += (performance.now() - t0) / 1000;
      for (let i = 0; i < QUANTUM; i += 1) out.push([body.output(0)[i], body.output(1)[i]]);
    }
    const npy = join(tmp, "ref.npy");
    const sets = Object.entries(c.set).flatMap(([k, v]) => ["--set", `${k.split("/").pop()}=${v}`]);
    execFileSync(FAUSTPROBE, ["-I", join(ROOT, "dsp"), "--sr", String(SR), "--nvoices", "1", "--block", "16",
      "--note", `${c.key}:${c.velocity}@0..${SR}`, "-n", String(FRAMES), "--quiet", "--out", npy, ...sets,
      join(ROOT, "dsp/elements_poly.dsp")], { stdio: ["ignore", "ignore", "inherit"] });
    const ref = readNpy(npy);
    for (let ch = 0; ch < 2; ch += 1) {
      let peak = 0;
      let diff = 0;
      for (let i = 0; i < FRAMES; i += 1) {
        peak = Math.max(peak, Math.abs(ref[i][ch]));
        diff = Math.max(diff, Math.abs(ref[i][ch] - out[i][ch]));
      }
      const db = diff > 0 ? 20 * Math.log10(diff / peak) : -Infinity;
      if (db > -60) failed = true;
      console.log(`${c.name.padEnd(13)} ${ch ? "aux " : "main"} peak ${peak.toFixed(4)}  max diff ${db.toFixed(1)} dB of peak`);
    }
    console.log(`${c.name.padEnd(13)} wasm cost ${(seconds * 1000 / (FRAMES / SR)).toFixed(2)} ms per second of audio (one voice and the body)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
