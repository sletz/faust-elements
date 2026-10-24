#!/usr/bin/env python3
"""The figures of the README, from fresh renders (build/dump and faustprobe):

  results/fig_bow.png        the bowed scenario through the module: the C++ and the Faust
                             renders, and their difference (faustprobe single precision)
  results/fig_precision.png  the side output of the particles scenario: the difference
                             in single and in double precision, over time

    python3 scripts/figures.py

Run by `make figures`. Needs matplotlib (drawing without a display, the Agg
backend) and numpy; renders through compare.py, so it needs build/dump and
faustprobe as compare.py does. Writes the two PNG files, 120 dpi, into results/,
created if missing.
"""

import sys
from pathlib import Path

import matplotlib

# A backend that draws into files, with no window: the script runs headless.
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

# compare.py lives beside this script: make it importable from any directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import compare  # noqa: E402

ROOT = compare.ROOT
OUT = ROOT / "results"
# The model's sample rate, Hz: frames to seconds on the time axes.
SR = 32000


def renders(scenario, part, single):
    """Both renders of a scenario.

    scenario: the scenario's path relative to the repository root.
    part: True for the module (main, aux), False for the voice (raw, center, side).
    single: True for faustprobe in single precision, False for --double.
    Returns (ref, y): the C++ and the Faust renders, frames x channels, float64.
    """
    mode, names = ("part", ["main", "aux"]) if part else ("voice", ["raw", "center", "side"])
    dsp = ROOT / "dsp" / ("elements.dsp" if part else "elements_voice.dsp")
    length, events = compare.read_scenario(ROOT / scenario)
    ref = compare.render_cpp(mode, ROOT / scenario, len(names))
    y = compare.render_faust(dsp, scenario, length, events, single)
    return ref, y


def envelope_db(x, peak, hop=320):
    """The peak envelope of a signal in dB of a reference peak.

    x: the signal, one channel.
    peak: the reference amplitude (the C++ channel's peak).
    hop: the window, in frames (320 is 10 ms at 32 kHz); a last partial window is
      dropped.
    Returns (t, e): the start of each window in seconds and the largest |x| of the
    window in dB of `peak`, floored at -240 dB so that a window of zeros stays
    finite on the plot.
    """
    n = len(x) // hop
    e = np.abs(x[: n * hop]).reshape(n, hop).max(axis=1)
    return np.arange(n) * hop / SR, 20 * np.log10(np.maximum(e / peak, 1e-12))


def fig_bow():
    """results/fig_bow.png: the main output of scenarios/bow.txt through the module,
    the C++ and the single-precision Faust render superimposed (top), and the
    envelope of their difference in dB of the C++ peak (bottom)."""
    ref, y = renders("scenarios/bow.txt", True, True)
    t = np.arange(len(ref)) / SR
    fig, ax = plt.subplots(2, 1, figsize=(8, 5), sharex=True)
    # Channel 0 of the module is its main output.
    ax[0].plot(t, ref[:, 0], lw=0.6, label="C++ (elements::Part)")
    ax[0].plot(t, y[:, 0], lw=0.6, ls="--", label="Faust (faustprobe)")
    ax[0].set_ylabel("main")
    ax[0].legend(loc="upper right")
    ax[0].set_title("Bowed A2 through the module (scenarios/bow.txt)")
    peak = np.abs(ref[:, 0]).max()
    tt, e = envelope_db(ref[:, 0] - y[:, 0], peak)
    ax[1].plot(tt, e, lw=0.8, color="C3")
    ax[1].set_ylabel("difference (dB of peak)")
    ax[1].set_xlabel("time (s)")
    ax[1].set_ylim(-160, 0)
    fig.tight_layout()
    fig.savefig(OUT / "fig_bow.png", dpi=120)


def fig_precision():
    """results/fig_precision.png: the envelope of the difference between the C++
    and the Faust voice on the side output of scenarios/particles.txt, in single
    and in double precision, in dB of the C++ side output's peak. The side output
    carries the pickup LFO the C++ accumulates in float32, which the
    double-precision model accumulates more exactly and drifts from."""
    fig, ax = plt.subplots(figsize=(8, 3.5))
    for single, label in ((True, "faustprobe, single precision"), (False, "faustprobe --double")):
        ref, y = renders("scenarios/particles.txt", False, single)
        # Channel 2 of the voice is its side output.
        peak = np.abs(ref[:, 2]).max()
        tt, e = envelope_db(ref[:, 2] - y[:, 2], peak)
        ax.plot(tt, e, lw=0.8, label=label)
    ax.set_title("Side output, particles: difference with the C++ (float32)")
    ax.set_ylabel("dB of the channel's peak")
    ax.set_xlabel("time (s)")
    ax.set_ylim(-160, 0)
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(OUT / "fig_precision.png", dpi=120)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    fig_bow()
    fig_precision()
