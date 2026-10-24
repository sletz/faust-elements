// Native offline renderer of the Faust Elements: dsp/elements.dsp compiled to C++
// by faust-rs (make render), driven by a scenario of ref/dump.cpp's format, at
// 32 kHz in blocks of 16 frames. Writes a 32-bit float stereo WAV (aux, main: the
// module's left and right outputs) and prints the cost of compute().
//
//   render SCENARIO OUT.wav
//
// The strike_in and blow_in lines of a scenario are not supported here.

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#ifndef FAUSTFLOAT
#define FAUSTFLOAT float
#endif

struct Meta {
    virtual ~Meta() {}
    virtual void declare(const char*, const char*) {}
};
// Controls by label: the labels of elements.lib are unique.
struct UI {
    std::map<std::string, FAUSTFLOAT*> zones;
    virtual ~UI() {}
    static std::string name(const char* l) {
        std::string s(l);
        size_t k = s.find('[');
        while (k != std::string::npos) {
            size_t e = s.find(']', k);
            s.erase(k, e == std::string::npos ? std::string::npos : e - k + 1);
            k = s.find('[');
        }
        return s;
    }
    virtual void openTabBox(const char*) {}
    virtual void openHorizontalBox(const char*) {}
    virtual void openVerticalBox(const char*) {}
    virtual void closeBox() {}
    virtual void addButton(const char* l, FAUSTFLOAT* z) { zones[name(l)] = z; }
    virtual void addCheckButton(const char* l, FAUSTFLOAT* z) { zones[name(l)] = z; }
    virtual void addVerticalSlider(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT) { zones[name(l)] = z; }
    virtual void addHorizontalSlider(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT) { zones[name(l)] = z; }
    virtual void addNumEntry(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT) { zones[name(l)] = z; }
    virtual void addHorizontalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) {}
    virtual void addVerticalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) {}
    virtual void addSoundfile(const char*, const char*, void**) {}
    virtual void declare(FAUSTFLOAT*, const char*, const char*) {}
};
struct dsp {
    virtual ~dsp() {}
};

#include <algorithm>
#include <cstddef>
#include <math.h>
#include "elements_module.cpp"

static void write_wav(const char* path, const std::vector<float>& lr, int sr) {
    FILE* f = fopen(path, "wb");
    if (!f) {
        fprintf(stderr, "cannot write %s\n", path);
        exit(1);
    }
    uint32_t data = static_cast<uint32_t>(lr.size() * sizeof(float));
    auto u32 = [&](uint32_t v) { fwrite(&v, 4, 1, f); };
    auto u16 = [&](uint16_t v) { fwrite(&v, 2, 1, f); };
    fwrite("RIFF", 1, 4, f);
    u32(36 + data);
    fwrite("WAVEfmt ", 1, 8, f);
    u32(16);
    u16(3);  // IEEE float
    u16(2);
    u32(sr);
    u32(sr * 8);
    u16(8);
    u16(32);
    fwrite("data", 1, 4, f);
    u32(data);
    fwrite(lr.data(), sizeof(float), lr.size(), f);
    fclose(f);
}

int main(int argc, char** argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: render SCENARIO OUT.wav\n");
        return 1;
    }
    const int sr = 32000, bs = 16;
    long length = sr;
    std::vector<std::pair<long, std::pair<std::string, double>>> events;
    std::ifstream in(argv[1]);
    if (!in) {
        fprintf(stderr, "cannot read %s\n", argv[1]);
        return 1;
    }
    std::string line;
    while (std::getline(in, line)) {
        line = line.substr(0, line.find('#'));
        std::istringstream s(line);
        std::string a, b, c;
        if (!(s >> a >> b)) continue;
        if (a == "length") {
            length = atol(b.c_str());
            continue;
        }
        s >> c;
        if (b == "strike_in" || b == "blow_in") {
            fprintf(stderr, "%s: audio inputs are not supported by render, ignored\n", argv[1]);
            continue;
        }
        events.push_back({atol(a.c_str()), {b, atof(c.c_str())}});
    }
    mydsp d;
    UI ui;
    d.init(sr);
    d.buildUserInterface(&ui);
    std::vector<FAUSTFLOAT> zero(bs, 0), l(bs), r(bs);
    FAUSTFLOAT* ins[2] = {zero.data(), zero.data()};
    FAUSTFLOAT* outs[2] = {r.data(), l.data()};  // main (OUT, right), aux (left)
    std::vector<float> lr;
    lr.reserve(2 * length);
    size_t next = 0;
    double seconds = 0;
    for (long t = 0; t < length; t += bs) {
        while (next < events.size() && events[next].first <= t) {
            auto it = ui.zones.find(events[next].second.first);
            if (it == ui.zones.end()) {
                fprintf(stderr, "unknown control %s\n", events[next].second.first.c_str());
                return 1;
            }
            *it->second = static_cast<FAUSTFLOAT>(events[next].second.second);
            ++next;
        }
        auto t0 = std::chrono::steady_clock::now();
        d.compute(bs, ins, outs);
        seconds += std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        for (int i = 0; i < bs; ++i) {
            lr.push_back(static_cast<float>(l[i]));
            lr.push_back(static_cast<float>(r[i]));
        }
    }
    write_wav(argv[2], lr, sr);
    double audio = static_cast<double>(length) / sr;
    printf("compute: %.1f ms for %.1f s of audio, %.2f ms per second, %.0fx real time\n",
           seconds * 1e3, audio, seconds * 1e3 / audio, audio / seconds);
    return 0;
}
