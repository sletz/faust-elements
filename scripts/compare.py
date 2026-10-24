#!/usr/bin/env python3
"""Render scenarios with the C++ (build/dump) and with the Faust model (faustprobe),
and compare them sample by sample.

    python3 scripts/compare.py [--part] [--single] [--plot] scenarios/strike.txt ...

`--part` compares the whole module (dsp/elements.dsp against elements::Part: main,
aux); by default the voice (dsp/elements_voice.dsp against elements::Voice: raw,
center, side). For every channel it prints the peak of the C++ render, the largest
difference in dB of that peak, the frame where the difference first exceeds -60 dB
of the peak, and the RMS levels of both renders. The exit status is 1 when a
channel differs by more than --tolerance dB (default -60) of its peak.
"""

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FAUSTPROBE = os.environ.get("FAUSTPROBE", str(ROOT / "../faust-rs/target/release/faustprobe"))
DUMP = ROOT / "build" / "dump"
# Controls of the Part that the voice does not have.
PART_ONLY = ("space", "diffusion", "reverb_lp")


def read_scenario(path):
    length, events = 32000, []
    for line in Path(path).read_text().splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        parts = line.split()
        if parts[0] == "length":
            length = int(parts[1])
        else:
            events.append((int(parts[0]), parts[1], parts[2]))
    return length, events


def render_cpp(mode, scenario, channels):
    with tempfile.NamedTemporaryFile(suffix=".f32", delete=False) as f:
        out = f.name
    subprocess.run([str(DUMP), mode, str(scenario), out], check=True)
    y = np.fromfile(out, dtype=np.float32).reshape(-1, channels).astype(np.float64)
    os.unlink(out)
    return y


def render_faust(dsp, scenario, length, events, single):
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "y.npy"
        cmd = [FAUSTPROBE, "-I", str(ROOT / "dsp"), "--sr", "32000", "-n", str(length),
               "--block", "16", "--quiet", "--out", str(out)]
        if not single:
            cmd.insert(1, "--double")
        inputs = {name: value for _, name, value in events if name in ("strike_in", "blow_in")}
        if inputs:
            # The program's inputs are blow, strike: a two-channel file.
            n = length
            data = np.zeros((n, 2))
            for k, name in enumerate(("blow_in", "strike_in")):
                if name in inputs:
                    x = np.fromfile(ROOT / inputs[name], dtype=np.float32)[:n]
                    data[:len(x), k] = x
            raw = Path(d) / "in.wav"
            write_wav_float(raw, data, 32000)
            cmd += ["--in", f"file:{raw}"]
        else:
            cmd += ["--in", "zero"]
        for frame, name, value in events:
            if name in ("strike_in", "blow_in") or (name in PART_ONLY and "voice" in dsp.name):
                continue
            if frame == 0:
                cmd += ["--set", f"{name}={value}"]
            else:
                cmd += ["--at", str(frame), f"{name}={value}"]
        cmd.append(str(dsp))
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"faustprobe failed:\n{' '.join(cmd)}\n{r.stderr}")
        return np.load(out)


def write_wav_float(path, data, sr):
    """A WAVE_FORMAT_IEEE_FLOAT file, 32 bits, one column per channel."""
    import struct
    x = np.ascontiguousarray(data, dtype="<f4")
    ch = x.shape[1]
    body = x.tobytes()
    fmt = struct.pack("<HHIIHH", 3, ch, sr, sr * 4 * ch, 4 * ch, 32)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 4 + 8 + len(fmt) + 8 + len(body)) + b"WAVE")
        f.write(b"fmt " + struct.pack("<I", len(fmt)) + fmt)
        f.write(b"data" + struct.pack("<I", len(body)) + body)


def db(x):
    return 20 * np.log10(max(x, 1e-300))


def compare(scenario, part, single, save=None):
    """Both renders of a scenario and, per channel: name, C++ peak, largest difference
    in dB of that peak and in dBFS, its frame, the first frame beyond -60 dB of the
    peak, the RMS of both renders in dBFS."""
    mode, names = ("part", ["main", "aux"]) if part else ("voice", ["raw", "center", "side"])
    dsp = ROOT / "dsp" / ("elements.dsp" if part else "elements_voice.dsp")
    length, events = read_scenario(scenario)
    ref = render_cpp(mode, scenario, len(names))
    y = render_faust(dsp, scenario, length, events, single)
    if save:
        Path(save).mkdir(parents=True, exist_ok=True)
        stem = Path(scenario).stem
        np.save(Path(save) / f"{stem}_{mode}_cpp.npy", ref)
        np.save(Path(save) / f"{stem}_{mode}_faust.npy", y)
    rows = []
    for k, name in enumerate(names):
        a, b = ref[:, k], y[:, k]
        peak = np.max(np.abs(a))
        err = np.abs(a - b)
        rel = db(err.max() / peak) if peak > 0 else (0.0 if err.max() == 0 else db(err.max()))
        beyond = np.nonzero(err > peak * 10 ** (-60 / 20))[0] if peak > 0 else np.nonzero(err)[0]
        rows.append(dict(name=name, peak=peak, rel=rel, abs=db(err.max()), at=int(err.argmax()),
                         first=int(beyond[0]) if len(beyond) else None,
                         rms_cpp=db(np.sqrt(np.mean(a ** 2))), rms_faust=db(np.sqrt(np.mean(b ** 2)))))
    return mode, length, rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scenarios", nargs="+")
    ap.add_argument("--part", action="store_true")
    ap.add_argument("--single", action="store_true")
    ap.add_argument("--tolerance", type=float, default=-60.0)
    ap.add_argument("--save", help="directory where both renders are saved as .npy")
    args = ap.parse_args()
    failed = False
    for sc in args.scenarios:
        mode, length, rows = compare(sc, args.part, args.single, args.save)
        print(f"{sc} ({mode}, {length} frames, {'single' if args.single else 'double'})")
        for r in rows:
            print(f"  {r['name']:6s} peak {r['peak']:.6g}  max diff {r['rel']:7.1f} dB of peak "
                  f"({r['abs']:7.1f} dBFS) at frame {r['at']}  first beyond -60 dB: {r['first']}  "
                  f"rms {r['rms_cpp']:.2f} / {r['rms_faust']:.2f} dBFS")
            if r["peak"] > 0 and r["rel"] > args.tolerance:
                failed = True
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
