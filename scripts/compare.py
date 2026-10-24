#!/usr/bin/env python3
"""Render scenarios with the C++ (build/dump) and with the Faust model (faustprobe),
and compare them sample by sample.

    python3 scripts/compare.py [--part] [--single] [--tolerance DB] [--save DIR] \\
        scenarios/strike.txt ...

`--part` compares the whole module (dsp/elements.dsp against elements::Part: main,
aux); by default the voice (dsp/elements_voice.dsp against elements::Voice: raw,
center, side). For every channel it prints the peak of the C++ render, the largest
difference in dB of that peak, the frame where the difference first exceeds -60 dB
of the peak, and the RMS levels of both renders. The exit status is 1 when a
channel differs by more than --tolerance dB (default -60) of its peak.

`--single` runs faustprobe in single precision (its default), otherwise with
`--double`; the C++ is always float32. `--save DIR` keeps both renders as
DIR/STEM_MODE_cpp.npy and DIR/STEM_MODE_faust.npy (frames x channels, float64).

`make test` runs it on every scenario, voice and module, in single precision with
the default tolerance and in double precision with `--tolerance 0`: there the
differences are printed, and fail only when one exceeds the channel's peak. results.py and figures.py import it for `compare`, `read_scenario`,
`render_cpp` and `render_faust`.

Inputs: a scenario file (the format of ref/dump.cpp: `length FRAMES`, then lines
`FRAME NAME VALUE`, `#` starting a comment), build/dump (`make ref`) and
faustprobe, at ../faust-rs/target/release/faustprobe or $FAUSTPROBE. The programs
are read from dsp/. Nothing is written but temporary files and, with --save, DIR.
"""

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

# The repository root, so that the script runs from any directory.
ROOT = Path(__file__).resolve().parent.parent
FAUSTPROBE = os.environ.get("FAUSTPROBE", str(ROOT / "../faust-rs/target/release/faustprobe"))
DUMP = ROOT / "build" / "dump"
# Controls of the Part that the voice does not have.
PART_ONLY = ("space", "diffusion", "reverb_lp")


def read_scenario(path):
    """Parse a scenario file.

    path: the scenario (str or Path).
    Returns (length, events): the number of frames to render (32000, one second at
    32 kHz, unless a `length` line sets it) and the list of (frame, name, value)
    events in file order, frame an int, name and value the strings of the file
    (value is a number, or a file path for `strike_in` and `blow_in`).
    """
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
    """Render a scenario with the C++ reference, `build/dump MODE SCENARIO OUT`.

    mode: "voice" (elements::Voice) or "part" (elements::Part).
    scenario: the scenario file.
    channels: the number of channels the mode writes (3 for the voice, 2 for the part).
    Returns a float64 array of frames x channels. The dump writes the channels as
    interleaved float32, frame after frame, so a reshape recovers them; the values
    are widened to float64 for the comparison, which loses nothing.
    """
    with tempfile.NamedTemporaryFile(suffix=".f32", delete=False) as f:
        out = f.name
    subprocess.run([str(DUMP), mode, str(scenario), out], check=True)
    y = np.fromfile(out, dtype=np.float32).reshape(-1, channels).astype(np.float64)
    os.unlink(out)
    return y


def render_faust(dsp, scenario, length, events, single):
    """Render a scenario with the Faust model through faustprobe.

    dsp: the program (Path), dsp/elements_voice.dsp or dsp/elements.dsp.
    scenario: the scenario file (unused: the events are given already parsed).
    length: the number of frames to render.
    events: the (frame, name, value) list of `read_scenario`.
    single: True for single precision, False for `--double`.
    Returns the array faustprobe saves with `--out`, frames x channels.
    Raises RuntimeError, with the command line and faustprobe's error output, when
    faustprobe fails.

    The program runs at 32 kHz in blocks of 16 frames, the module's block size, so
    that the controls change at the same block boundaries as in the C++. An event
    at frame 0 becomes `--set NAME=VALUE`, a later one `--at FRAME NAME=VALUE`.
    """
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "y.npy"
        cmd = [FAUSTPROBE, "-I", str(ROOT / "dsp"), "--sr", "32000", "-n", str(length),
               "--block", "16", "--quiet", "--out", str(out)]
        if not single:
            cmd.insert(1, "--double")
        # The external inputs of the scenario: the path of a raw float32 file each.
        inputs = {name: value for _, name, value in events if name in ("strike_in", "blow_in")}
        if inputs:
            # The program's inputs are blow, strike: a two-channel file.
            n = length
            data = np.zeros((n, 2))
            for k, name in enumerate(("blow_in", "strike_in")):
                if name in inputs:
                    # Played from frame 0, cut to the render's length and padded with
                    # silence, as the dump plays it.
                    x = np.fromfile(ROOT / inputs[name], dtype=np.float32)[:n]
                    data[:len(x), k] = x
            raw = Path(d) / "in.wav"
            write_wav_float(raw, data, 32000)
            cmd += ["--in", f"file:{raw}"]
        else:
            cmd += ["--in", "zero"]
        for frame, name, value in events:
            # The inputs are not controls, and the voice has no space section.
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
    """A WAVE_FORMAT_IEEE_FLOAT file, 32 bits, one column per channel.

    path: the file to write.
    data: an array of frames x channels; it is rounded to float32, which keeps the
      dump's float32 inputs exact.
    sr: the sample rate, Hz.

    The file is a RIFF header, a `fmt ` chunk (format tag 3, IEEE float; the
    channel count; the sample rate; bytes per second; bytes per frame; 32 bits per
    sample) and a `data` chunk of the interleaved little-endian samples. The RIFF
    size counts everything after itself: "WAVE", then each chunk's 8-byte header
    and body.
    """
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
    """An amplitude ratio in dB, 20 log10(x); 0 gives about -6000 dB rather than
    -inf, so that the tables stay numbers."""
    return 20 * np.log10(max(x, 1e-300))


def compare(scenario, part, single, save=None):
    """Both renders of a scenario and, per channel: name, C++ peak, largest difference
    in dB of that peak and in dBFS, its frame, the first frame beyond -60 dB of the
    peak, the RMS of both renders in dBFS.

    scenario: the scenario file.
    part: True for the module (Part, main and aux), False for the voice (raw,
      center, side).
    single: True for faustprobe in single precision, False for --double.
    save: a directory where both renders are saved as .npy, or None.
    Returns (mode, length, rows): "part" or "voice", the number of frames, and one
    dict per channel with the keys name, peak, rel (dB of the peak), abs (dBFS),
    at (frame of the largest difference), first (first frame beyond -60 dB of the
    peak, or None), rms_cpp and rms_faust (dBFS).
    """
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
        # Relative to the C++ channel's peak; a silent C++ channel has no peak to
        # refer to, so its difference is 0 dB when there is none (equal, both silent)
        # and in dBFS otherwise.
        rel = db(err.max() / peak) if peak > 0 else (0.0 if err.max() == 0 else db(err.max()))
        # -60 dB of the peak is 10^(-3) of it in amplitude; for a silent channel, any
        # difference at all.
        beyond = np.nonzero(err > peak * 10 ** (-60 / 20))[0] if peak > 0 else np.nonzero(err)[0]
        rows.append(dict(name=name, peak=peak, rel=rel, abs=db(err.max()), at=int(err.argmax()),
                         first=int(beyond[0]) if len(beyond) else None,
                         rms_cpp=db(np.sqrt(np.mean(a ** 2))), rms_faust=db(np.sqrt(np.mean(b ** 2)))))
    return mode, length, rows


def main():
    """Compare every scenario of the command line, print one line per channel, and
    exit 1 when a channel with a nonzero peak differs by more than --tolerance."""
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
            # A silent C++ channel is never failed: its `rel` is in dBFS, not
            # relative to a peak.
            if r["peak"] > 0 and r["rel"] > args.tolerance:
                failed = True
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
