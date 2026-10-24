#!/usr/bin/env python3
"""The figures of the README, from fresh renders (build/dump and faustprobe):

  results/fig_bow.png        the bowed scenario through the module: the C++ and the Faust
                             renders, and their difference (faustprobe single precision)
  results/fig_precision.png  the side output of the particles scenario: the difference
                             in single and in double precision, over time

    python3 scripts/figures.py
"""

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import compare  # noqa: E402

ROOT = compare.ROOT
OUT = ROOT / "results"
SR = 32000


def renders(scenario, part, single):
    mode, names = ("part", ["main", "aux"]) if part else ("voice", ["raw", "center", "side"])
    dsp = ROOT / "dsp" / ("elements.dsp" if part else "elements_voice.dsp")
    length, events = compare.read_scenario(ROOT / scenario)
    ref = compare.render_cpp(mode, ROOT / scenario, len(names))
    y = compare.render_faust(dsp, scenario, length, events, single)
    return ref, y


def envelope_db(x, peak, hop=320):
    n = len(x) // hop
    e = np.abs(x[: n * hop]).reshape(n, hop).max(axis=1)
    return np.arange(n) * hop / SR, 20 * np.log10(np.maximum(e / peak, 1e-12))


def fig_bow():
    ref, y = renders("scenarios/bow.txt", True, True)
    t = np.arange(len(ref)) / SR
    fig, ax = plt.subplots(2, 1, figsize=(8, 5), sharex=True)
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
    fig, ax = plt.subplots(figsize=(8, 3.5))
    for single, label in ((True, "faustprobe, single precision"), (False, "faustprobe --double")):
        ref, y = renders("scenarios/particles.txt", False, single)
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
