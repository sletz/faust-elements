// The polyphonic instrument in an AudioWorklet at 32 kHz: N voices of
// dsp/elements_poly.dsp and its effect, the body, each a faust-rs wasm DSP.
// What Faust's polyphonic architectures do, written out for this instrument:
//
// - the voices' three outputs (raw, center, side) are summed and feed the body
//   (mix, soft limit, reverb), computed once, as Part sums its voices;
// - a control set on the page goes to every voice and to the body;
// - every note starts with one block of 16 frames (the model's block) with the
//   gate low, then the gate high: the voice sees a rising edge whatever its gate
//   was, so a key struck again restrikes its own voice on the strings still
//   sounding, and a voice culled while its gate was high strikes again;
// - a release that arrives before the voice has computed a block with its gate
//   high waits for that block, so that a short click still strikes;
// - a released voice stops being computed once its outputs have stayed below
//   QUIET for QUIET_SECONDS, a held one after HELD_QUIET_SECONDS (a struck note
//   held down decays to nothing, then towards subnormal numbers, which wasm
//   computes slowly on some processors);
// - with no free voice, the oldest released one is taken, else the oldest held one;
// - with no voice sounding, the body stops being computed once its output has
//   stayed below QUIET for a second (a frozen reverb never goes quiet).
//
// The voices compute in calls of 16 frames or multiples of 16, so that each
// voice's own block grid (elements.lib's `blk`) stays aligned with its calls:
// a gate changed between two calls is read at the next block, as on the module.

// Messages from the page (port.postMessage):
//   { type: "noteOn", key, velocity }   MIDI key, velocity in [0, 1]
//   { type: "noteOff", key }
//   { type: "control", key, value }     a control key ("exciter/bow") to every DSP
//   { type: "polyphony", count }
//   { type: "panic" }                   release every voice and silence them
// Messages to the page:
//   { type: "ready" }
//   { type: "stats", load, active, peak } every STATS_SECONDS: load is the time
//                                        spent in process() over the audio time
//                                        of the window (an average: the clock of
//                                        an AudioWorklet may tick by milliseconds)
import { FaustWasmDsp } from "./faust-wasm-dsp.js";

const QUIET = 1e-5;
const QUIET_SECONDS = 1;
const HELD_QUIET_SECONDS = 3;
const STATS_SECONDS = 0.25;
// The model's block.
const BLOCK = 16;
const now = globalThis.performance ? () => globalThis.performance.now() : () => Date.now();

class Voice {
  constructor(dsp) {
    this.dsp = dsp;
    this.key = -1;
    this.held = false;
    this.active = false;
    this.quiet = 0;
    this.started = 0;
    // Gate low for one block before going high again (a restrike).
    this.restrike = false;
    // Gate set high, not yet computed; a release received meanwhile.
    this.fresh = false;
    this.releaseNext = false;
  }
}

class ElementsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { voice, body, polyphony } = options.processorOptions;
    this.voiceCode = voice;
    this.quantum = 128;
    this.body = new FaustWasmDsp(body, sampleRate, this.quantum);
    this.voices = [];
    this.controls = new Map();
    this.counter = 0;
    this.bodyQuiet = 0;
    this.bodyAwake = false;
    this.setPolyphony(polyphony);
    this.load = 0;
    this.peak = 0;
    this.statsFrames = 0;
    this.port.onmessage = (e) => this.message(e.data);
    this.port.postMessage({ type: "ready" });
  }

  setPolyphony(count) {
    while (this.voices.length < count) {
      const v = new Voice(new FaustWasmDsp(this.voiceCode, sampleRate, this.quantum));
      for (const [k, value] of this.controls) v.dsp.set(k, value);
      this.voices.push(v);
    }
    this.voices.length = count;
  }

  message(m) {
    if (m.type === "noteOn") this.noteOn(m.key, m.velocity);
    else if (m.type === "noteOff") this.noteOff(m.key);
    else if (m.type === "control") {
      this.controls.set(m.key, m.value);
      for (const v of this.voices) v.dsp.set(m.key, m.value);
      this.body.set(m.key, m.value);
    } else if (m.type === "polyphony") this.setPolyphony(m.count);
    else if (m.type === "panic") {
      for (const v of this.voices) {
        v.dsp.set("gate", 0);
        v.held = false;
        v.active = false;
        v.key = -1;
      }
      this.bodyAwake = false;
    }
  }

  noteOn(key, velocity) {
    const v = this.voices.find((x) => x.key === key && x.active)
      || this.voices.find((x) => !x.active)
      || this.oldest(this.voices.filter((x) => !x.held))
      || this.oldest(this.voices);
    v.restrike = true;
    v.key = key;
    v.held = true;
    v.active = true;
    v.fresh = true;
    v.releaseNext = false;
    v.quiet = 0;
    v.started = ++this.counter;
    v.dsp.set("freq", 440 * 2 ** ((key - 69) / 12));
    v.dsp.set("gain", velocity);
    this.bodyAwake = true;
  }

  oldest(list) {
    let best = null;
    for (const v of list) if (!best || v.started < best.started) best = v;
    return best;
  }

  noteOff(key) {
    for (const v of this.voices) {
      if (v.key === key && v.held) {
        v.held = false;
        if (v.fresh) {
          v.releaseNext = true;
        } else {
          v.dsp.set("gate", 0);
          v.restrike = false;
        }
      }
    }
  }

  process(inputs, outputs) {
    const t0 = now();
    const out = outputs[0];
    const n = out[0].length;
    const bin = [this.body.input(0), this.body.input(1), this.body.input(2)];
    for (const b of bin) b.fill(0, 0, n);
    let active = 0;
    for (const v of this.voices) {
      if (!v.active) continue;
      active += 1;
      let start = 0;
      if (v.restrike) {
        // One block with the gate low, then the gate high for the rest.
        v.dsp.set("gate", 0);
        this.computeVoice(v, 0, BLOCK, bin);
        v.dsp.set("gate", 1);
        v.restrike = false;
        start = BLOCK;
      }
      const level = this.computeVoice(v, start, n - start, bin);
      v.fresh = false;
      if (v.releaseNext) {
        v.dsp.set("gate", 0);
        v.releaseNext = false;
      }
      if (level < QUIET) {
        v.quiet += n;
        if (v.quiet > (v.held ? HELD_QUIET_SECONDS : QUIET_SECONDS) * sampleRate) {
          v.active = false;
          // A held key keeps its voice for its release; a released one frees it.
          if (!v.held) v.key = -1;
        }
      } else {
        v.quiet = 0;
      }
    }
    let peak = 0;
    if (active > 0 || this.bodyAwake) {
      this.body.compute(n);
      const main = this.body.output(0);
      const aux = this.body.output(1);
      // The module's outputs: aux on the left, main on the right (elements.cc).
      out[0].set(aux.subarray(0, n));
      if (out[1]) out[1].set(main.subarray(0, n));
      for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(main[i]), Math.abs(aux[i]));
      if (active === 0 && peak < QUIET) {
        this.bodyQuiet += n;
        if (this.bodyQuiet > sampleRate) this.bodyAwake = false;
      } else {
        this.bodyQuiet = 0;
        this.bodyAwake = true;
      }
    } else {
      out[0].fill(0);
      if (out[1]) out[1].fill(0);
    }
    this.peak = Math.max(this.peak, peak);
    this.load += now() - t0;
    this.statsFrames += n;
    if (this.statsFrames >= STATS_SECONDS * sampleRate) {
      const load = this.load / ((this.statsFrames / sampleRate) * 1000);
      this.port.postMessage({ type: "stats", load, active, peak: this.peak });
      this.statsFrames = 0;
      this.load = 0;
      this.peak = 0;
    }
    return true;
  }

  // Computes `frames` frames of a voice into the body's inputs at `offset`;
  // returns the peak of its outputs.
  computeVoice(v, offset, frames, bin) {
    if (frames <= 0) return 0;
    v.dsp.compute(frames);
    let level = 0;
    for (let c = 0; c < 3; c += 1) {
      const o = v.dsp.output(c);
      const b = bin[c];
      for (let i = 0; i < frames; i += 1) {
        b[offset + i] += o[i];
        const a = Math.abs(o[i]);
        if (a > level) level = a;
      }
    }
    return level;
  }
}

registerProcessor("elements", ElementsProcessor);
