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
// - a voice whose output is not finite or beyond VOICE_GUARD, or a body whose
//   output is not finite or beyond BODY_GUARD, has its state cleared
//   (`instanceClear`) and is silent for that quantum. Elements does diverge:
//   a lossless string (damping above 0.95) under a strong bow at a high pitch
//   grows without bound, in the C++ as in the model (to 6e11 within 20 ms),
//   and a recursion that reaches a NaN stays silent for good. The module
//   resets its voice when its resonator level passes 200 (`Part::Process`,
//   the panic not ported to dsp/elements.lib); VOICE_GUARD, far above the
//   loudest bounded sounds of the model (about 140), plays that part here.
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
//
// How it fits: app.js adds this module to its AudioContext (created at 32 kHz) and makes
// one AudioWorkletNode "elements", with no input and one stereo output, passing the
// compiled DSPs and the polyphony in `processorOptions` (a WebAssembly.Module is
// structured-cloneable, so the worklet instantiates the modules without compiling them
// again). The page keeps the notes' bookkeeping (which source holds which key, the hold
// pedal) and sends a noteOff only when a note is to end; this processor keeps the
// voices'.
import { FaustWasmDsp } from "./faust-wasm-dsp.js";

// The level below which a voice or the body counts as silent: an amplitude, -100 dBFS.
const QUIET = 1e-5;
// How long (s) a released voice and a held one stay below QUIET before they stop being
// computed (the body: one second, with no voice active).
const QUIET_SECONDS = 1;
const HELD_QUIET_SECONDS = 3;
// The divergence guards (amplitudes): a voice or body output beyond them, or not finite,
// clears that DSP.
const VOICE_GUARD = 1e3;
const BODY_GUARD = 1e6;
// The period of the "stats" messages, s.
const STATS_SECONDS = 0.25;
// The model's block.
const BLOCK = 16;
// A clock in ms: performance.now where the worklet's scope has it, else Date.now.
const now = globalThis.performance ? () => globalThis.performance.now() : () => Date.now();

/**
 * One voice: a DSP instance of the voice and its state in the allocation.
 * @property {FaustWasmDsp} dsp - the voice's DSP
 * @property {number} key - the MIDI key it plays, -1 when free
 * @property {boolean} held - its key is down (the page has not released it)
 * @property {boolean} active - it is computed; false once culled or after a panic
 * @property {number} quiet - frames in a row its outputs stayed below QUIET
 * @property {number} started - the order of its last note-on, for stealing the oldest
 * @property {boolean} restrike - the next quantum starts with one block of low gate
 * @property {boolean} fresh - its gate was set high and not yet computed
 * @property {boolean} releaseNext - a release arrived while fresh: the gate falls after
 *   the next quantum
 */
class Voice {
  /**
   * @param {FaustWasmDsp} dsp - a new instance of the voice
   */
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

/**
 * The AudioWorkletProcessor registered as "elements": the voices, the body, the messages
 * of the page and the render callback.
 */
class ElementsProcessor extends AudioWorkletProcessor {
  /**
   * @param {Object} options - the AudioWorkletNode's options
   * @param {Object} options.processorOptions - {voice, body, polyphony}: the voice's and
   *   the body's {json, module}, and the number of voices (1 to 16)
   */
  constructor(options) {
    super();
    const { voice, body, polyphony } = options.processorOptions;
    this.voiceCode = voice;
    // The render quantum of Web Audio, the largest block the DSPs' buffers hold.
    this.quantum = 128;
    this.body = new FaustWasmDsp(body, sampleRate, this.quantum);
    this.voices = [];
    // The last value of every control the page set, by key, given to the voices created
    // later; `counter` numbers the note-ons, to find the oldest voice; `bodyQuiet` counts
    // the frames the body has stayed quiet with no voice active, `bodyAwake` says whether
    // the body is computed.
    this.controls = new Map();
    this.counter = 0;
    this.bodyQuiet = 0;
    this.bodyAwake = false;
    this.setPolyphony(polyphony);
    // The statistics of the current window: ms spent in process, the peak of the output,
    // and the frames of audio.
    this.load = 0;
    this.peak = 0;
    this.statsFrames = 0;
    this.port.onmessage = (e) => this.message(e.data);
    this.port.postMessage({ type: "ready" });
  }

  /**
   * Sets the number of voices: new ones are created with the current controls; fewer
   * truncates the list, the voices dropped (sounding or not) going silent at once.
   * @param {number} count - the number of voices
   */
  setPolyphony(count) {
    while (this.voices.length < count) {
      const v = new Voice(new FaustWasmDsp(this.voiceCode, sampleRate, this.quantum));
      for (const [k, value] of this.controls) v.dsp.set(k, value);
      this.voices.push(v);
    }
    this.voices.length = count;
  }

  /**
   * Handles a message of the page (see the list at the top of this file). A control goes
   * to every voice and to the body, a DSP ignoring the keys it does not have. A panic
   * lowers every gate and stops computing every voice at once, and lets the body sleep:
   * the output is silent from the next quantum, a reverb tail included (the body's state
   * is kept, not cleared).
   * @param {Object} m - the message
   */
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

  /**
   * Starts a note. The voice is the one already playing this key, so that a key struck
   * again restrikes its own strings; else a free one; else the oldest released one; else
   * the oldest held one (stolen). The note starts at the next quantum with one block of
   * low gate (restrike); its pitch is equal-tempered from A4 = 440 Hz at key 69.
   * @param {number} key - the MIDI key
   * @param {number} velocity - in [0, 1], the voice's `gain`
   */
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

  /**
   * @param {Voice[]} list - voices
   * @returns {?Voice} the one whose last note started first, null for an empty list
   */
  oldest(list) {
    let best = null;
    for (const v of list) if (!best || v.started < best.started) best = v;
    return best;
  }

  /**
   * Releases a key: every held voice playing it lowers its gate, read at its next block;
   * a voice whose high gate has not been computed yet releases after its next quantum, so
   * that a short click still strikes.
   * @param {number} key - the MIDI key
   */
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

  /**
   * The render callback, one quantum: computes the active voices into the body's inputs,
   * then the body into the stereo output, culls the quiet voices and the quiet body,
   * guards against divergence, and posts the statistics every STATS_SECONDS.
   * @param {Float32Array[][]} inputs - none (the node has no input)
   * @param {Float32Array[][]} outputs - outputs[0], the left and right channels
   * @returns {boolean} true: the processor stays alive
   */
  process(inputs, outputs) {
    const t0 = now();
    const out = outputs[0];
    const n = out[0].length;
    // The body's three inputs (raw, center, side), cleared: each voice adds into them.
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
      // The rest of the quantum (all of it without a restrike). The high gate has now been
      // computed: a release that waited for it lowers the gate.
      const level = this.computeVoice(v, start, n - start, bin);
      v.fresh = false;
      if (v.releaseNext) {
        v.dsp.set("gate", 0);
        v.releaseNext = false;
      }
      // Culling: the frames in a row below QUIET, over QUIET_SECONDS for a released
      // voice, HELD_QUIET_SECONDS for a held one.
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
    // The body is computed while a voice is active and for a second of silence after the
    // last one; with a reverb frozen it never goes quiet, so it never sleeps.
    if (active > 0 || this.bodyAwake) {
      this.body.compute(n);
      const main = this.body.output(0);
      const aux = this.body.output(1);
      // The module's outputs: aux on the left, main on the right (elements.cc).
      out[0].set(aux.subarray(0, n));
      if (out[1]) out[1].set(main.subarray(0, n));
      for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(main[i]), Math.abs(aux[i]));
      if (!(peak <= BODY_GUARD)) {
        // NaN fails the comparison too.
        this.body.clear();
        out[0].fill(0);
        if (out[1]) out[1].fill(0);
        console.warn(`elements: the body diverged (peak ${peak}), its state was cleared`);
        peak = 0;
      }
      // With no voice active and a quiet output, count towards the body's sleep;
      // otherwise it stays awake.
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
    // Statistics: `load` is the time spent here over the audio time of the window, a
    // ratio (1 means the worklet uses all of the real time); `active` the voices computed
    // in this quantum; `peak` the largest output amplitude of the window.
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

  /**
   * Computes `frames` frames of a voice and adds its three outputs into the body's inputs
   * at `offset`. The outputs are checked first: a voice that diverged is cleared and adds
   * nothing.
   * @param {Voice} v - the voice
   * @param {number} offset - the frame of the quantum where its frames go
   * @param {number} frames - 0 to the quantum, a multiple of BLOCK (16)
   * @param {Float32Array[]|Float64Array[]} bin - the body's three input buffers
   * @returns {number} the peak of its outputs (an amplitude), 0 when it diverged
   */
  computeVoice(v, offset, frames, bin) {
    if (frames <= 0) return 0;
    v.dsp.compute(frames);
    let level = 0;
    for (let c = 0; c < 3; c += 1) {
      const o = v.dsp.output(c);
      for (let i = 0; i < frames; i += 1) {
        const a = Math.abs(o[i]);
        if (!(a <= VOICE_GUARD)) {
          v.dsp.clear();
          console.warn(`elements: voice ${v.key} diverged (${o[i]}), its state was cleared`);
          return 0;
        }
        if (a > level) level = a;
      }
    }
    for (let c = 0; c < 3; c += 1) {
      const o = v.dsp.output(c);
      const b = bin[c];
      for (let i = 0; i < frames; i += 1) b[offset + i] += o[i];
    }
    return level;
  }
}

// The name app.js gives its AudioWorkletNode.
registerProcessor("elements", ElementsProcessor);
