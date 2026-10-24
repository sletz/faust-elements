# faust-elements

**Mutable Instruments Elements, the modal synthesis voice of Emilie Gillet, written in Faust for [faust-rs](https://github.com/grame-cncm/faust-rs), and checked sample by sample against the module's own C++.**

*Version française : [README.fr.md](README.fr.md). The article: [paper/faust-elements.pdf](paper/faust-elements.pdf).*

[Elements](https://pichenettes.github.io/mutable-instruments-documentation/modules/elements/) is a Eurorack module from 2014 whose firmware is open source (MIT, [pichenettes/eurorack](https://github.com/pichenettes/eurorack), `elements/dsp`). It is a complete physical-modelling voice in about 3,700 lines of C++ running at 32 kHz on a Cortex-M4:

- three **exciters**: a *bow* (a noise process that flips sign at random, through a low-pass), a *blow* (a granular player of a noise sample, a reed-and-bore tube model above 2/3 of the level, then a diffuser of four all-passes), and a *strike* whose meta control morphs between nine mallet and hit samples, a mallet pulse, a plectrum (two pulses and a palm mute) and bouncing particles;
- an **envelope** (contour: percussive, AD, ADSR, AR) and a strength input with its accent tables;
- a **resonator**: 52 zero-delay-feedback band-pass modes, stretched by the geometry (from a bar to a bell and beyond), their Q set by damping and brightness, picked up at two positions through a cosine comb applied to the amplitudes, plus 8 bowed modes, each a delay line in a loop with a band-pass and a bow friction table; or, in its hidden modes, **one string** or a **chord of five strings** (Karplus-Strong with Hermite reads, FIR and SVF damping, dispersion through an all-pass, noise and a curved bridge, a comb pickup);
- the **space** section: stereo spread, then a Griesinger reverb (the Dattorro topology) whose delay memory is 16 bits, frozen at the end of the knob's travel.

This repository rewrites all of it as one Faust library, [dsp/elements.lib](dsp/elements.lib) (prefix `el`, 24 documented functions), and asks whether a Faust program can give the *same samples* as the firmware, not merely the same kind of sound. The answer, measured on 11 scenarios that exercise every exciter model, the three resonators, the parameters moving under held notes, the external input and the reverb ([results/compare.txt](results/compare.txt)):

- in single precision, the Faust model follows `elements::Part` (the whole module) to **-72 dB of the peak or better on every scenario, -100 dB on most**, and `elements::Voice` to -82 dB or better, sample by sample over 2 to 6 seconds;
- in double precision the agreement is -28 to -123 dB: the C++ accumulates a few phases in float32 (the side pickup's LFO, the string's ramps, the reverb's two LFOs), and the double-precision model accumulates the same increments more exactly, so the two drift apart. The single-precision model, which performs the same float operations, does not ([results/fig_precision.png](results/fig_precision.png));
- the output does not depend on the host's block size (1, 7, 16 or 512 frames), on a reset, or on the compilation (`faustprobe --check all`);
- the module costs 10.7 ms of compute per second of audio in modal mode, natively (faust-rs to C++, clang -O3), 3.2 times the original C++; 2.8 and 4.9 ms for one string and for chords, 1.9 and 1.25 times ([results/cost.txt](results/cost.txt)).

![The bowed scenario through the module: C++ and Faust superimposed, and their difference, -83 dB of the peak at worst](results/fig_bow.png)

## 1. How a block-based engine becomes a sample stream

The C++ processes blocks of 16 samples. Reading the controls, the gate flags, the envelope, the strike exciter, the 52 modes' coefficients and the strings' parameters happen once per block; the per-sample loops then ramp a few values across the block. Getting the same samples out of a sample-by-sample language took five things.

**The block clock.** `el.blk` is 1 on the first sample of each block, counted from the first sample the program computes, as the C++'s first block. Everything the C++ computes once per block is a faust-rs `ondemand` domain clocked by `blk`: its inputs are read at that sample, its outputs hold for the block, and its own state (`~`, delays) advances once per block. The envelope (`el.envelope_block`), the gate flags, the modes (`el.modes_block`, including the C++'s refresh of the upper 27 modes on alternate blocks), the chord choice with its hysteresis, the strings' parameters: all are such domains. The controls themselves are held per block (`_hb`), so a control moved in the middle of a block takes effect at the next one, as on the module.

**Ramps that accumulate as the C++ accumulates.** The C++ ramps the envelope, the strength, the pickup position and four string parameters by adding an increment computed at the block start, `(target - value) / 16`, to a running value. `_ramp` does exactly that, from the value reached at the previous block's end, so the rounding of the sum is the C++'s too.

**One random generator, shared, in the C++'s order.** `stmlib::Random` is a single linear congruential generator that the bow draws from 16 times per block, then the blow 16 times, then the particles of the strike 0 to 4 times depending on their bounces (one word on the rising edge, two or three per bounce, at most one bounce per block), then each string once per tick. The model keeps the generator's state at the block start and hands every consumer the very word it would draw, with the generator's k-step jump (`lcg_a(k) s + lcg_c(k)`, tabulated from the C++'s own step): the bow gets words 1 to 16, the blow 17 to 32, the strike runs its 16 steps at block rate from word 33 (`el.random_block`), and each string starts after the words of the strings before it. A string below 15.7 Hz ticks less than once per sample; its ticks are counted at the block start by running its phase through the block, so the next string's words stay right. Integers are 32-bit and wrap, as in C: unsigned comparisons flip the sign bit, unsigned shifts mask.

**What the C++ does not process stands still.** In string mode the modal resonator is not called; a bowed mode above the number of active modes, the four extra strings in single-string mode, the dispersion all-pass when it is out of the loop, and a slow string between its ticks are skipped. Each is an `ondemand` domain whose clock is that condition, so its filters and delay lines freeze, and resume where they were, as the C++'s do. The modes above the number of active ones keep their state with a select.

**Delay lines read as ring buffers.** A C++ `DelayLine` read at offset k before its write returns what was written k writes ago, and 2048 writes ago when k is a multiple of the size; after the write, offset k returns what was written k - 1 writes ago, the current value at 1. `_ring` and `_ring_post` give those reads on a recursion's fed-back value. The reverb engine (`FxEngine`) shares one 16-bit buffer between ten lines; its first all-pass is "smeared" by reading its line at an LFO-modulated offset and writing the result back 100 cells further, where the tail reads it 49 samples later. The model writes this as `_q16(interpolation) @ 49`, and quantizes every write to 16 bits as `Compress` does.

The tables (envelope curves, accent, stiffness, SVF coefficients, MIDI to frequency, the 128,013 samples of the strike and the 40,963 of the blow's noise) are read back from the compiled C++ by `build/dump tables`, not recomputed, and written to [dsp/elements_tables.lib](dsp/elements_tables.lib). So are four float32 constants the C++ computes in float: the particles' probabilities, the strings' initial delay, and the reverb LFOs' coefficients. The last ones matter: the LFO is a resonant recursion with a coefficient of 1.99999702, so close to 2 that one unit in the last place changes its frequency by 2 %; with the coefficient computed in double, the reverb's read offsets drifted and the space scenario agreed to -26 dB in single precision; with the float32 value, to -74 dB.

## 2. Results

`make results` renders every scenario of [scenarios/](scenarios) through `build/dump` (the firmware's `elements::Voice` and `elements::Part`, compiled with `-ffp-contract=off`) and through faustprobe (`dsp/elements_voice.dsp`, `dsp/elements.dsp`, `--sr 32000 --block 16`, the scenario's control changes as `--set` and `--at`), in single and double precision: 44 renders, compared over their whole length. The worst channel of each, in dB of its peak:

| scenario | what it exercises | module, single | voice, single | module, double | voice, double |
|---|---|---|---|---|---|
| strike | the default patch, a mallet | -103 | -90 | -123 | -111 |
| samples | the strike's sample player, three samples and timbres | -98 | -82 | -52 | -35 |
| plectrum | plectrum and palm mute | -116 | -97 | -67 | -52 |
| particles | random bounces, three gates | -105 | -97 | -38 | -28 |
| bow | bow, ADSR, moving position and timbre | -83 | -84 | -58 | -35 |
| blow | granular noise, then the reed tube | -105 | -95 | -56 | -46 |
| string | one string, dispersion, infinite damping | -101 | -101 | -58 | -60 |
| chords | five strings, chords, a string below 15.7 Hz, bowed chord | -102 | -103 | -88 | -92 |
| moves | parameters moving, the model switched under a held note | -84 | -85 | -54 | -42 |
| space | raw, spread, reverb, frozen reverb | -72 | -97 | -50 | -39 |
| input | an external signal into the resonator | -105 | -86 | -95 | -76 |

On the machine of [results/compare.txt](results/compare.txt): Apple M5, Apple clang 21.0.0, Elements at eurorack `f4cfa76` (stmlib `e3bd7c9`), faust-rs `172305ea` (faustprobe 0.9.2).

- **Single precision** is the comparison that matters: the model performs the C++'s float operations, so it should give the C++'s float results, and does to within the reordering of sums and products that the Faust compiler is free to make (an ulp here and there). Where an ulp crosses a threshold it can grow: the 16-bit reverb rounds a value one way instead of the other, and the difference circulates in its loops (the space scenario, -72 dB of the peak, -77 dBFS: a few units of the 16-bit memory), and the bowed modes, a nonlinear loop, amplify differences (the bow scenario, -83 dB).
- **Double precision** shows where the C++'s float32 drifts. In every scenario the raw excitation agrees to -99 dB or better; the side output, which carries the pickup LFO accumulated in float32 by the C++, diverges after a few seconds; the strings, whose delay ramps accumulate in float32, do too. [results/fig_precision.png](results/fig_precision.png) shows the side output of the particles scenario: below -97 dB of its peak in single precision throughout, -30 dB after three seconds in double.
- The check was made to fail once: the resonator's input gain changed from 0.125 to 0.126 gives -42 dB on the center output and exit status 1.

**Cost** ([results/cost.txt](results/cost.txt), `make cost`, 100 s of a bowed note, compute only):

| resonator | C++ (`build/dump`, -O2) | Faust native (faust-rs, clang -O3) | faustprobe (Cranelift JIT) |
|---|---|---|---|
| modal | 3.4 ms/s | 10.7 ms/s | 17.1 ms/s |
| one string | 1.5 ms/s | 2.8 ms/s | 6.7 ms/s |
| five strings | 3.9 ms/s | 4.9 ms/s | 13.7 ms/s |

The difference lies in the modes: with 26 modes instead of 52 the native module costs 6.4 ms/s instead of 10.4, so the 52 modes are about 8 ms of its 10.7, while the whole C++ module costs 3.4. The generated code keeps each mode's state in the DSP structure and shifts it every sample, where the C++ walks an array of filters; whether that is the whole cause was not measured. At 10.7 ms per second, the module uses about 1 % of a core.

## 3. Layout

| path | what it is |
|---|---|
| `dsp/elements.lib` | the model (prefix `el`), documented in the faustlibraries format: each public function has its `#### Usage` and `#### Test` (`make doctests`) |
| `dsp/elements_tables.lib` | generated: the C++'s tables, samples and float32 constants (`make tables`) |
| `dsp/elements.dsp` | the module: two audio inputs (blow, strike), two outputs (main, aux), the panel's controls |
| `dsp/elements_voice.dsp` | the voice alone (raw, center, side), compared with `elements::Voice` |
| `dsp/elements_poly.dsp` | a polyphonic MIDI instrument: the voice per note (freq, gain as strength, gate), `effect = el.body` (mix, soft limit, reverb) |
| `ref/dump.cpp` | links Elements' sources unchanged; dumps the tables, renders scenarios through `Part`, `Voice` or the reverb alone |
| `scenarios/` | the test scenarios (`FRAME NAME VALUE`, at block boundaries) and `demo.txt`, a tour for listening |
| `scripts/` | `compare.py` (one scenario, both models), `results.py`, `cost.sh`, `figures.py`, `gen_tables.py`, `check_doc_tests.py` |
| `tools/render.cpp` | the native renderer of a scenario through the faust-rs C++ (`make render`) |
| `web/` | the web version: page, keyboard, MIDI, AudioWorklet host of the faust-rs wasm, orbit explorer (`make web`, `make web-serve`, `make web-check`, `make web-presets`); `web/vendor/faust-orbit-ui` is faust-orbit-ui 0.4.1 |
| `paper/` | the article, `faust-elements.pdf` (`make paper`) |
| `faust-rs-issues/` | what the port found in faust-rs |

## 4. Use

```bash
make ref        # build/dump, against ../../mi-eurorack (ELEMENTS=...)
make tables     # dsp/elements_tables.lib from the C++
make check      # every program compiles; --check all on the module
make doctests   # the 24 #### Test blocks of elements.lib
make test       # every scenario, voice and module, single and double precision
make results    # results/compare.txt and results/cost.txt
make paper      # paper/faust-elements.pdf
make render     # build/demo.wav, the native render of scenarios/demo.txt (32 kHz)
make web        # web/dsp: the voice and the body in wasm; make web-serve, then http://localhost:8000/web/
```

`ELEMENTS` points to a checkout of [pichenettes/eurorack](https://github.com/pichenettes/eurorack) with its `stmlib` submodule (`git submodule update --init stmlib`), `FAUST_RS` to faust-rs with release `faust-rs` and `faustprobe` built. Python 3 with numpy (and matplotlib for `scripts/figures.py`), node for `make web-check`.

**The sample rate is 32 kHz.** Every table, delay length and coefficient of the C++ is computed for the module's codec rate, and the model keeps them: run it at 32 kHz (`faustprobe --sr 32000`; a Web Audio context can be created at 32 kHz and the browser resamples). At another rate it plays, transposed and with every time constant scaled.

**Controls** (the names are the C++'s `Patch` and `PerformanceState` fields; the ranges are those `CvScaler` gives them):

| group | controls |
|---|---|
| exciter | `envelope` (contour), `bow`, `blow`, `strike` (levels), `bow_timbre`, `flow` (blow meta), `blow_timbre`, `mallet` (strike meta), `strike_timbre` |
| resonator | `geometry`, `brightness`, `damping`, `position`, `model` (0 modal, 1 string, 2 strings) |
| space | `space` (raw below 0.1, stereo, reverb from 0.6, frozen above 1.75) |
| unit | `signature`, `mod_frequency`, `mod_offset` (0 to 0.5), `diffusion`, `reverb_lp`: what `Part::Seed` derives from each module's serial number, at the values of `Part::Init` |
| performance | `note` (MIDI), `strength` (the pressure input, 0.5 is unity), `modulation` (semitones, the FM input), `gate` |

## 5. Web version

`web/` plays the instrument in the browser. `make web` compiles the voice and the body of `dsp/elements_poly.dsp` to WebAssembly with faust-rs (single precision), `make web-serve` serves the repository; then open http://localhost:8000/web/ (Web MIDI and AudioWorklet need localhost or HTTPS).

- **Engine.** An AudioWorklet (`web/elements-processor.js`) at 32 kHz, the model's rate, which the browser resamples to the device. It runs 1 to 16 voices, 8 by default (1 is the module itself, which is monophonic), sums their raw, center and side into the body as `Part` sums its voices, sends every control to every voice and to the body, starts each note with one 16-frame block of low gate so that the voice always sees a rising edge (a key struck again restrikes its own voice on the strings still sounding), holds back a release that arrives before the strike has been computed, stops computing a voice once it has been silent for a second (three if its key is still held), and steals the oldest released voice, else the oldest held one. A voice whose output is not finite or passes 1000 has its state cleared (`instanceClear`): Elements does diverge, a lossless string (damping above 0.95) under a strong bow at a high pitch growing without bound in the C++ as in the model, and the module resets its voice then (the panic of `Part::Process`, not ported to the library).
- **Playing.** The keyboard on the page, C1 to C8 in a box that scrolls (lower on a key is louder; dragging slides from key to key, a glissando, one note per finger on a touch screen, as in faust-coopiano), the computer keyboard (two rows from Z and Q, marked on the page, ← → for the octave), Web MIDI (notes and velocity, pitch bend on the modulation input over ±2 semitones, all notes off). A hold works as a piano's sustain pedal, for chords: while it is down, released keys keep sounding (shown in a lighter colour) and lifting it releases them. It is down while the *Hold notes* switch is on, the space bar is pressed or a MIDI sustain pedal (CC64) is down.
- **Controls.** Every control of the voice and the body, one tab per group of the panel (exciter, resonator, space, unit, performance; the browser remembers the last one), each with its explanation in English and French, and 24 presets: the module's defaults; struck (wooden bar, bell, gong, steel drum, wood block, kalimba), bowed and blown (bowed glass, singing bowl, low bow, reed pipe, breath, flute, clarinet), strings (plucked, harp, dispersive string, muted string, string chord, bowed chord) and textures (particles, rain stick, wind chimes, drone). `make web-presets` renders each one with the wasm on three keys and fails when one is nearly silent or exceeds 0 dBFS; the sounds themselves are to be judged by ear.
- **Orbit.** A last tab explores the parameter space with [faust-orbit-ui](https://github.com/orlarey/faust-orbit-ui) (Yann Orlarey, MIT; 0.4.1 vendored in `web/vendor/faust-orbit-ui`): every control of the voice and the body (but the note, its velocity and the pitch offset) is a dot on an orbit, dragged one by one or all together from the centre, or scattered at random. Its library starts with the 24 presets, projected on a plane (PCA): a click on a disc recalls a preset, dragging the cross between discs morphs from one sound to another (Shepard interpolation), a double-click keeps the current sound. The orbit and the other tabs follow each other in both directions, and the preset menu shows the preset the orbit has recalled, or marks the last one modified; the model, a whole number, is rounded while the orbit interpolates. What is added, renamed or deleted in the library is kept by the browser.
- **Random patches.** `make web-fuzz` plays 2,000 random patches through the wasm, as the orbit's Random makes them, with the page's guard, and fails if a non-finite or huge value reaches the output. It found that `mod_offset` above 0.85 makes the side pickup's cosine oscillator diverge (its amplitudes reach 1e35): the module's serial number gives it 0.05 to 0.15, and the slider now stops at 0.5. The few voices the guard clears diverge in the C++ too.
- **Check.** `make web-check` renders the wasm under node as the worklet does and compares it with faustprobe (`--nvoices 1`, single precision) on three notes: a struck note -132 dB of the peak, a bowed note identical, a chord of strings -78 dB; the wasm costs 13.6 to 16.9 ms per second of audio for one voice and the body (node 22, Apple M5).

## 6. What is not ported

- The **Ominous voice**, the module's easter egg (a different synthesis engine).
- The **panic** and **bypass** of `Part`: when the resonator level exceeds 200 the C++ resets the voice for one block; no scenario reaches it.
- The **hardware around `Part`**: the CV scaler's pot smoothing and calibration, the input noise gates of `elements.cc`, the 16-bit `SoftConvert` of the codec.
- A strike meta of exactly 1, where the C++'s model index reaches FLOW: `CvScaler` caps the knob at 0.9995, and so does the slider.
- In `elements_poly.dsp` each voice has its own generator, where `Part` with several voices would share one.

## 7. faust-rs

The port found one defect, kept with its reduced case in [faust-rs-issues/unbounded-delay](faust-rs-issues/unbounded-delay): a delay read at an offset whose interval the compiler cannot bound (here, an LFO computed by a recursion, through `int()`) is accepted by faust-rs, which sizes the line to 2^31 samples. The C++ compiler refuses the same program with the interval in its message. The generated class is then 8 GiB, and a host that allocates it on the stack crashes, while faustprobe renders the program normally. The model now clamps those offsets to the range the C++ reads. faust-rs has been corrected since (`main-dev` `10b26062`): it refuses an upper bound of `INT_MAX` or more and an interval spanning the whole integer range, with the diagnostic `delay-interval`.

Everything else the port needed was there: `ondemand` nested three deep (the dispersion all-pass inside the string's tick inside the string), inside recursions; 32-bit integer arithmetic with wrap-around; `waveform` tables of 128,013 samples (the voice compiles in 1.2 s).

## License

MIT, as the Elements firmware. The model: GRAME, 2026. Elements' DSP code and the tables and samples in `dsp/elements_tables.lib`: Emilie Gillet, 2014, MIT ([LICENSE](LICENSE)).
