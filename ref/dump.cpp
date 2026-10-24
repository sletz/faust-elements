// Reference renderer for faust-elements.
//
// Links Mutable Instruments Elements' own DSP sources (elements/dsp/*.cc,
// elements/resources.cc, stmlib), compiled unchanged with -DTEST, and:
//
//   dump tables DIR             writes every lookup table and sample bank the
//                               Faust model needs, one value per line (%.17g
//                               for floats, the exact integers for samples)
//   dump part SCENARIO OUT      renders a scenario through elements::Part (the
//                               whole module: voice, mixdown, soft limit,
//                               reverb) and writes main, aux as interleaved
//                               float32
//   dump voice SCENARIO OUT     renders it through elements::Voice alone and
//                               writes raw, center, sides as interleaved
//                               float32
//   dump reverb FRAMES AMOUNT DIFFUSION TIME GAIN LP OUT
//                               an impulse through elements::Reverb alone
//                               (left, right as interleaved float32)
//
// A scenario is a text file of lines `FRAME NAME VALUE`, FRAME a multiple of
// the block size (16): the value is set before the block that starts at FRAME
// is processed, as the module's control loop does. `length FRAMES` sets the
// length of the render. NAME is a field of the Patch (envelope, bow, ...), of
// the PerformanceState (gate, note, strength, modulation), or `model` (the
// resonator model, 0 modal, 1 string, 2 strings). `strike_in` and `blow_in`
// take the path of a raw float32 file, played from the start into that input.
//
// The objects are static, so that the members Elements leaves uninitialized
// (Resonator::clock_divider_, lfo_phase_, Tube::delay_line_, Part::panic_ ...)
// start at zero as they do in the module's zeroed RAM. The random generator is
// the module's: one stmlib::Random shared by every exciter and string, seeded
// with its default state; Part::Seed (the serial number) is not called.

#include "elements/dsp/part.h"
#include "elements/resources.h"
#include "stmlib/dsp/units.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using namespace elements;

static const size_t kBlock = 16;

struct Event {
  long frame;
  std::string name;
  std::string value;
};

struct Scenario {
  long length = 32000;
  std::vector<Event> events;
};

static Scenario read_scenario(const char* path) {
  Scenario s;
  std::ifstream f(path);
  if (!f) {
    fprintf(stderr, "cannot read %s\n", path);
    exit(1);
  }
  std::string line;
  while (std::getline(f, line)) {
    if (line.empty() || line[0] == '#') continue;
    std::istringstream in(line);
    std::string a, b, c;
    in >> a >> b;
    if (a == "length") {
      s.length = atol(b.c_str());
      continue;
    }
    in >> c;
    Event e{atol(a.c_str()), b, c};
    if (e.frame % kBlock) {
      fprintf(stderr, "%s: frame %ld is not a multiple of %zu\n", path, e.frame, kBlock);
      exit(1);
    }
    s.events.push_back(e);
  }
  if (s.length % kBlock) {
    fprintf(stderr, "%s: length %ld is not a multiple of %zu\n", path, s.length, kBlock);
    exit(1);
  }
  return s;
}

static std::vector<float> read_f32(const std::string& path) {
  std::ifstream f(path, std::ios::binary);
  if (!f) {
    fprintf(stderr, "cannot read %s\n", path.c_str());
    exit(1);
  }
  std::vector<char> bytes((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  std::vector<float> v(bytes.size() / sizeof(float));
  memcpy(v.data(), bytes.data(), v.size() * sizeof(float));
  return v;
}

static float* patch_field(Patch* p, const std::string& name) {
  static const std::map<std::string, size_t> fields = {
    {"envelope", offsetof(Patch, exciter_envelope_shape)},
    {"bow", offsetof(Patch, exciter_bow_level)},
    {"bow_timbre", offsetof(Patch, exciter_bow_timbre)},
    {"blow", offsetof(Patch, exciter_blow_level)},
    {"flow", offsetof(Patch, exciter_blow_meta)},
    {"blow_timbre", offsetof(Patch, exciter_blow_timbre)},
    {"strike", offsetof(Patch, exciter_strike_level)},
    {"mallet", offsetof(Patch, exciter_strike_meta)},
    {"strike_timbre", offsetof(Patch, exciter_strike_timbre)},
    {"signature", offsetof(Patch, exciter_signature)},
    {"geometry", offsetof(Patch, resonator_geometry)},
    {"brightness", offsetof(Patch, resonator_brightness)},
    {"damping", offsetof(Patch, resonator_damping)},
    {"position", offsetof(Patch, resonator_position)},
    {"mod_frequency", offsetof(Patch, resonator_modulation_frequency)},
    {"mod_offset", offsetof(Patch, resonator_modulation_offset)},
    {"diffusion", offsetof(Patch, reverb_diffusion)},
    {"reverb_lp", offsetof(Patch, reverb_lp)},
    {"space", offsetof(Patch, space)},
  };
  auto it = fields.find(name);
  if (it == fields.end()) return nullptr;
  return reinterpret_cast<float*>(reinterpret_cast<char*>(p) + it->second);
}

// The controls of one block, as the module's control loop leaves them.
struct Controls {
  PerformanceState state;
  ResonatorModel model = RESONATOR_MODEL_MODAL;
  std::vector<float> strike_in, blow_in;
};

static void apply(const Event& e, Patch* patch, Controls* c) {
  float v = static_cast<float>(atof(e.value.c_str()));
  if (float* field = patch_field(patch, e.name)) {
    // The modulation frequency is given in Hz; the patch holds cycles/sample.
    *field = e.name == "mod_frequency" ? v / kSampleRate : v;
  } else if (e.name == "gate") {
    c->state.gate = v != 0.0f;
  } else if (e.name == "note") {
    c->state.note = v;
  } else if (e.name == "strength") {
    c->state.strength = v;
  } else if (e.name == "modulation") {
    c->state.modulation = v;
  } else if (e.name == "model") {
    c->model = static_cast<ResonatorModel>(static_cast<int>(v));
  } else if (e.name == "strike_in") {
    c->strike_in = read_f32(e.value);
  } else if (e.name == "blow_in") {
    c->blow_in = read_f32(e.value);
  } else {
    fprintf(stderr, "unknown control %s\n", e.name.c_str());
    exit(1);
  }
}

static void init_state(Controls* c) {
  c->state.gate = false;
  c->state.note = 69.0f;
  c->state.strength = 0.5f;
  c->state.modulation = 0.0f;
}

static Part part;
static uint16_t reverb_buffer[32768];
static Voice voice;
static Patch voice_patch;

static void fill_input(const std::vector<float>& src, long frame, float* dst) {
  for (size_t i = 0; i < kBlock; ++i) {
    size_t k = static_cast<size_t>(frame) + i;
    dst[i] = k < src.size() ? src[k] : 0.0f;
  }
}

static void render(bool whole_part, const char* scenario_path, const char* out_path) {
  Scenario s = read_scenario(scenario_path);
  Controls c;
  init_state(&c);
  Patch* patch;
  if (whole_part) {
    part.Init(reverb_buffer);
    patch = part.mutable_patch();
  } else {
    voice.Init();
    // Part::Init's patch, which the voice alone would otherwise not get.
    static Part defaults;
    defaults.Init(reverb_buffer);
    voice_patch = *defaults.mutable_patch();
    patch = &voice_patch;
  }
  FILE* out = fopen(out_path, "wb");
  if (!out) {
    fprintf(stderr, "cannot write %s\n", out_path);
    exit(1);
  }
  size_t next = 0;
  float strike_in[kBlock], blow_in[kBlock];
  float a[kBlock], b[kBlock], d[kBlock];
  std::vector<float> frame(3 * kBlock);
  for (long t = 0; t < s.length; t += kBlock) {
    while (next < s.events.size() && s.events[next].frame <= t) {
      apply(s.events[next], patch, &c);
      ++next;
    }
    fill_input(c.strike_in, t, strike_in);
    fill_input(c.blow_in, t, blow_in);
    if (whole_part) {
      part.set_resonator_model(c.model);
      part.Process(c.state, blow_in, strike_in, a, b, kBlock);
      for (size_t i = 0; i < kBlock; ++i) {
        frame[2 * i] = a[i];
        frame[2 * i + 1] = b[i];
      }
      fwrite(frame.data(), sizeof(float), 2 * kBlock, out);
    } else {
      // Part::Process's conversion of the pitch.
      float midi_pitch = c.state.note + c.state.modulation;
      int32_t pitch = static_cast<int32_t>((midi_pitch + 48.0f) * 256.0f);
      if (pitch < 0) {
        pitch = 0;
      } else if (pitch >= 65535) {
        pitch = 65535;
      }
      voice.set_resonator_model(c.model);
      voice.Process(*patch, lut_midi_to_f_high[pitch >> 8] * lut_midi_to_f_low[pitch & 0xff],
                    c.state.strength, c.state.gate, blow_in, strike_in, a, b, d, kBlock);
      for (size_t i = 0; i < kBlock; ++i) {
        frame[3 * i] = a[i];
        frame[3 * i + 1] = b[i];
        frame[3 * i + 2] = d[i];
      }
      fwrite(frame.data(), sizeof(float), 3 * kBlock, out);
    }
  }
  fclose(out);
}

static void write_table(const std::string& dir, const char* name, const float* t, size_t n) {
  FILE* f = fopen((dir + "/" + name + ".txt").c_str(), "w");
  for (size_t i = 0; i < n; ++i) fprintf(f, "%.17g\n", static_cast<double>(t[i]));
  fclose(f);
}

static void write_int16(const std::string& dir, const char* name, const int16_t* t, size_t n) {
  FILE* f = fopen((dir + "/" + name + ".txt").c_str(), "w");
  for (size_t i = 0; i < n; ++i) fprintf(f, "%d\n", t[i]);
  fclose(f);
}

static void dump_tables(const std::string& dir) {
  write_table(dir, "lut_approx_svf_gain", lut_approx_svf_gain, LUT_APPROX_SVF_GAIN_SIZE);
  write_table(dir, "lut_approx_svf_g", lut_approx_svf_g, LUT_APPROX_SVF_G_SIZE);
  write_table(dir, "lut_approx_svf_r", lut_approx_svf_r, LUT_APPROX_SVF_R_SIZE);
  write_table(dir, "lut_approx_svf_h", lut_approx_svf_h, LUT_APPROX_SVF_H_SIZE);
  write_table(dir, "lut_4_decades", lut_4_decades, LUT_4_DECADES_SIZE);
  write_table(dir, "lut_accent_gain_coarse", lut_accent_gain_coarse, LUT_ACCENT_GAIN_COARSE_SIZE);
  write_table(dir, "lut_accent_gain_fine", lut_accent_gain_fine, LUT_ACCENT_GAIN_FINE_SIZE);
  write_table(dir, "lut_stiffness", lut_stiffness, LUT_STIFFNESS_SIZE);
  write_table(dir, "lut_env_increments", lut_env_increments, LUT_ENV_INCREMENTS_SIZE);
  write_table(dir, "lut_env_linear", lut_env_linear, LUT_ENV_LINEAR_SIZE);
  write_table(dir, "lut_env_expo", lut_env_expo, LUT_ENV_EXPO_SIZE);
  write_table(dir, "lut_env_quartic", lut_env_quartic, LUT_ENV_QUARTIC_SIZE);
  write_table(dir, "lut_midi_to_f_high", lut_midi_to_f_high, LUT_MIDI_TO_F_HIGH_SIZE);
  write_table(dir, "lut_midi_to_f_low", lut_midi_to_f_low, LUT_MIDI_TO_F_LOW_SIZE);
  write_table(dir, "lut_svf_shift", lut_svf_shift, LUT_SVF_SHIFT_SIZE);
  write_table(dir, "lut_pitch_ratio_high", stmlib::lut_pitch_ratio_high, 257);
  write_table(dir, "lut_pitch_ratio_low", stmlib::lut_pitch_ratio_low, 257);
  write_int16(dir, "smp_sample_data", smp_sample_data, SMP_SAMPLE_DATA_SIZE);
  write_int16(dir, "smp_noise_sample", smp_noise_sample, SMP_NOISE_SAMPLE_SIZE);
  FILE* f = fopen((dir + "/smp_boundaries.txt").c_str(), "w");
  for (size_t i = 0; i < SMP_BOUNDARIES_SIZE; ++i) fprintf(f, "%zu\n", smp_boundaries[i]);
  fclose(f);

  // Constants the exciters compute in float32, with the expressions of
  // exciter.cc, and the initial delay of a string (String::Init).
  f = fopen((dir + "/constants.txt").c_str(), "w");
  fprintf(f, "restart_prob %u\n", uint32_t(0.01f * 4294967296.0f));
  fprintf(f, "up_probability %u\n", uint32_t(0.7f * 4294967296.0f));
  fprintf(f, "down_probability %u\n", uint32_t(0.3f * 4294967296.0f));
  fprintf(f, "string_delay0 %.17g\n", static_cast<double>(1.0f / (220.0f / kSampleRate)));
  fprintf(f, "rng_seed %u\n", stmlib::Random::state());
  // The reverb's LFOs (FxEngine::SetLFOFrequency, then the expression of
  // CosineOscillator::InitApproximate): a coefficient so close to 2 that one ulp
  // moves the LFO's frequency by 2 %, so the model takes the float32 value.
  const float lfo_frequency[2] = {0.5f / 32000.0f * 32.0f, 0.3f / 32000.0f * 32.0f};
  for (int i = 0; i < 2; ++i) {
    float frequency = lfo_frequency[i];
    float sign = 16.0f;
    frequency -= 0.25f;
    if (frequency < 0.0f) {
      frequency = -frequency;
    } else {
      if (frequency > 0.5f) {
        frequency -= 0.5f;
      } else {
        sign = -16.0f;
      }
    }
    float coefficient = sign * frequency * (1.0f - 2.0f * frequency);
    fprintf(f, "reverb_lfo%d_coef %.17g\n", i + 1, static_cast<double>(coefficient));
  }
  fclose(f);

  // stmlib::Random advanced k steps is a k-step LCG, s -> a_k s + c_k (mod
  // 2^32): the coefficients for k = 0 .. 48, from the generator's own step.
  f = fopen((dir + "/lcg_jump.txt").c_str(), "w");
  uint32_t a = 1, c = 0;
  for (int k = 0; k <= 48; ++k) {
    fprintf(f, "%d %d\n", static_cast<int32_t>(a), static_cast<int32_t>(c));
    a = a * 1664525u;
    c = c * 1664525u + 1013904223u;
  }
  fclose(f);
}

// The reverb alone: the impulse 1 on the left input at frame 0, then silence,
// through elements::Reverb at the given amount, diffusion, time, input gain and
// low-pass (Part's set_* calls), for FRAMES frames; writes left, right.
static uint16_t reverb_alone_buffer[32768];
static Reverb reverb_alone;

static void render_reverb(char** argv, const char* out_path) {
  long frames = atol(argv[0]);
  reverb_alone.Init(reverb_alone_buffer);
  reverb_alone.set_amount(static_cast<float>(atof(argv[1])));
  reverb_alone.set_diffusion(static_cast<float>(atof(argv[2])));
  reverb_alone.set_time(static_cast<float>(atof(argv[3])));
  reverb_alone.set_input_gain(static_cast<float>(atof(argv[4])));
  reverb_alone.set_lp(static_cast<float>(atof(argv[5])));
  FILE* out = fopen(out_path, "wb");
  float l[kBlock], r[kBlock], frame[2 * kBlock];
  for (long t = 0; t < frames; t += kBlock) {
    for (size_t i = 0; i < kBlock; ++i) {
      l[i] = (t + static_cast<long>(i)) == 0 ? 1.0f : 0.0f;
      r[i] = 0.0f;
    }
    reverb_alone.Process(l, r, kBlock);
    for (size_t i = 0; i < kBlock; ++i) {
      frame[2 * i] = l[i];
      frame[2 * i + 1] = r[i];
    }
    fwrite(frame, sizeof(float), 2 * kBlock, out);
  }
  fclose(out);
}

int main(int argc, char** argv) {
  if (argc >= 3 && !strcmp(argv[1], "tables")) {
    dump_tables(argv[2]);
  } else if (argc >= 4 && !strcmp(argv[1], "part")) {
    render(true, argv[2], argv[3]);
  } else if (argc >= 9 && !strcmp(argv[1], "reverb")) {
    render_reverb(argv + 2, argv[8]);
  } else if (argc >= 4 && !strcmp(argv[1], "voice")) {
    render(false, argv[2], argv[3]);
  } else {
    fprintf(stderr,
            "usage: dump tables DIR | dump part SCENARIO OUT | dump voice SCENARIO OUT\n"
            "       dump reverb FRAMES AMOUNT DIFFUSION TIME GAIN LP OUT\n");
    return 1;
  }
  return 0;
}
