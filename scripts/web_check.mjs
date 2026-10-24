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
//
// Inputs: web/dsp/{voice,body}.{wasm,json} (make web), dsp/elements_poly.dsp, and
// faustprobe ($FAUSTPROBE, default ../faust-rs/target/release/faustprobe). Each
// faustprobe render goes to a .npy file in a temporary directory, removed at the
// end. Output, on stdout: for each case, one line per channel (main, aux) with the
// peak and the largest difference, then the wasm's cost; faustprobe's errors pass
// through to stderr.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FaustWasmDsp } from "../web/faust-wasm-dsp.js";

// The repository root, from this file's location, so that the script runs from any
// directory.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAUSTPROBE = process.env.FAUSTPROBE || join(ROOT, "../faust-rs/target/release/faustprobe");
// The model's rate, Hz.
const SR = 32000;
// The frames per compute call: the size of a Web Audio render quantum, as in the
// worklet.
const QUANTUM = 128;
// Three seconds per case: one with the key down, two of release.
const FRAMES = 3 * SR;

/**
 * Loads one of the page's compiled DSPs.
 * @param {string} name - "voice" or "body", the stem of web/dsp/NAME.{json,wasm}
 * @returns {{json: Object, module: WebAssembly.Module}} the program's JSON
 *   description (controls, channel counts) and its compiled module, the argument
 *   FaustWasmDsp expects
 */
function load(name) {
  const json = JSON.parse(readFileSync(join(ROOT, "web/dsp", name + ".json"), "utf8"));
  const module = new WebAssembly.Module(readFileSync(join(ROOT, "web/dsp", name + ".wasm")));
  return { json, module };
}

// A .npy file of float64 or float32 (faustprobe --out), as an array of rows.
/**
 * Reads a NumPy .npy file of version 1: the 6-byte magic "\x93NUMPY", two version
 * bytes, a little-endian uint16 header length at offset 8, then the header (a
 * Python dict literal with 'descr', 'fortran_order' and 'shape') from offset 10,
 * then the data. Only what faustprobe writes is handled: little-endian floats
 * ('<f8' or '<f4'), C order, a shape (rows,) or (rows, cols).
 * @param {string} path - the .npy file
 * @returns {Array<Array<number>>} one array per row (frame), one value per column
 *   (channel)
 */
function readNpy(path) {
  const buf = readFileSync(path);
  const headerLen = buf.readUInt16LE(8);
  const header = buf.subarray(10, 10 + headerLen).toString("latin1");
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  // A one-dimensional shape "(rows,)" has an empty second group: one column.
  const shape = /'shape':\s*\((\d+),\s*(\d*)\)/.exec(header);
  const rows = Number(shape[1]);
  const cols = Number(shape[2] || 1);
  const data = buf.subarray(10 + headerLen);
  // The item size is the last character of the type: '<f8' or '<f4'.
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

// The notes checked: a MIDI key, a MIDI velocity (1 .. 127), and the controls
// changed from their defaults, by the key of the page (group/name). They cover the
// three resonators: modal struck, modal bowed, and the chord of strings with the
// reverb.
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
    // Fresh instances for each case, so that no state carries over.
    const voice = new FaustWasmDsp(voiceCode, SR, QUANTUM);
    const body = new FaustWasmDsp(bodyCode, SR, QUANTUM);
    // Every control goes to both DSPs, as the worklet sends it; each ignores the
    // controls it does not have.
    for (const [k, v] of Object.entries(c.set)) {
      voice.set(k, v);
      body.set(k, v);
    }
    // The note as Faust's polyphonic architectures give it: freq in Hz (equal
    // temperament, A4 = key 69 = 440 Hz), gain the velocity over 127, gate 1.
    voice.set("freq", 440 * 2 ** ((c.key - 69) / 12));
    voice.set("gain", c.velocity / 127);
    voice.set("gate", 1);
    const out = [];
    let seconds = 0;
    for (let t = 0; t < FRAMES; t += QUANTUM) {
      // The key is released after one second: 32000 = 250 x 128, so the release
      // falls on the start of a quantum and the test meets it exactly.
      if (t === SR) voice.set("gate", 0);
      const t0 = performance.now();
      voice.compute(QUANTUM);
      // The voice's three outputs (raw, center, side) are the body's three inputs.
      for (let ch = 0; ch < 3; ch += 1) body.input(ch).set(voice.output(ch));
      body.compute(QUANTUM);
      // Only the computation is timed, not the copying of the output below.
      seconds += (performance.now() - t0) / 1000;
      for (let i = 0; i < QUANTUM; i += 1) out.push([body.output(0)[i], body.output(1)[i]]);
    }
    // The same note through faustprobe: one voice of the polyphonic program and
    // its effect (the body), in blocks of 16, the note on at frame 0 and off at
    // frame SR (`--note KEY:VELOCITY@ON..OFF`). faustprobe's --set takes the
    // control's name alone, the last component of the page's key.
    const npy = join(tmp, "ref.npy");
    const sets = Object.entries(c.set).flatMap(([k, v]) => ["--set", `${k.split("/").pop()}=${v}`]);
    execFileSync(FAUSTPROBE, ["-I", join(ROOT, "dsp"), "--sr", String(SR), "--nvoices", "1", "--block", "16",
      "--note", `${c.key}:${c.velocity}@0..${SR}`, "-n", String(FRAMES), "--quiet", "--out", npy, ...sets,
      join(ROOT, "dsp/elements_poly.dsp")], { stdio: ["ignore", "ignore", "inherit"] });
    const ref = readNpy(npy);
    // Per channel: the faustprobe render's peak and the largest difference in dB of
    // it; -Infinity when the two renders are identical.
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
    // The compute time over the audio's duration, in ms per second of audio.
    console.log(`${c.name.padEnd(13)} wasm cost ${(seconds * 1000 / (FRAMES / SR)).toFixed(2)} ms per second of audio (one voice and the body)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
