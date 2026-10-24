#!/usr/bin/env python3
"""Every scenario against the C++, voice and module, single and double precision:
the table of results/compare.txt, with the binaries and the machine it ran on.

    python3 scripts/results.py > results/compare.txt

Run by `make results` (which also writes results/cost.txt with cost.sh). Inputs:
every scenarios/*.txt but demo.txt (a tour for listening, not a test), build/dump,
faustprobe ($FAUSTPROBE, as in compare.py), and the checkouts named by $ELEMENTS
(default ../../mi-eurorack) and $FAUST_RS (default ../faust-rs), read for their
commits. Output, on stdout: a header stating the command, the machine, the C++
compiler, the commits of Elements, stmlib, faust-rs and this repository; one
Markdown table per mode and precision, one row per channel of each scenario; and a
summary of the worst channel of each mode and precision. The exit status is 0
whatever the differences (a render that fails raises): `make test` is the check,
this is the record.
"""

import os
import platform
import subprocess
import sys
from pathlib import Path

# compare.py lives beside this script: make it importable from any directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import compare  # noqa: E402

ROOT = compare.ROOT
ELEMENTS = Path(os.environ.get("ELEMENTS", ROOT / "../../mi-eurorack"))
FAUST_RS = Path(os.environ.get("FAUST_RS", ROOT / "../faust-rs"))


def out(cmd):
    """The standard output of a command, stripped; "?" when the command cannot be
    started. A command that runs and fails gives its (possibly empty) output, so
    that a missing piece of information leaves its field empty rather than
    stopping the report."""
    try:
        return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()
    except OSError:
        return "?"


def main():
    """Print the header, the four tables (single then double precision, voice then
    part) and the summary to stdout."""
    scenarios = sorted(p for p in (ROOT / "scenarios").glob("*.txt") if p.name != "demo.txt")
    # macOS names the processor through sysctl; elsewhere, Python's guess.
    cpu = out(["sysctl", "-n", "machdep.cpu.brand_string"]) or platform.processor()
    print("# faust-elements: the Faust model against the C++ of Mutable Instruments Elements")
    print("#")
    print(f"# command:   python3 scripts/results.py (make results)")
    print(f"# machine:   {cpu}, {platform.system()} {platform.release()}")
    print(f"# C++:       {out(['c++', '--version']).splitlines()[0]}, "
          f"flags -O2 -ffp-contract=off -DTEST (build/dump)")
    print(f"# Elements:  pichenettes/eurorack {out(['git', '-C', str(ELEMENTS), 'rev-parse', '--short', 'HEAD'])}, "
          f"stmlib {out(['git', '-C', str(ELEMENTS / 'stmlib'), 'rev-parse', '--short', 'HEAD'])}")
    # faust-rs is marked modified when a tracked file differs from its commit: the
    # commit alone would then not identify the compiler that ran.
    print(f"# faust-rs:  {out([compare.FAUSTPROBE, '--version']).splitlines()[0]}, "
          f"commit {out(['git', '-C', str(FAUST_RS), 'rev-parse', '--short', 'HEAD'])}"
          f"{' (modified)' if out(['git', '-C', str(FAUST_RS), 'status', '--porcelain', '-uno']) else ''}")
    print(f"# faust-elements: commit {out(['git', '-C', str(ROOT), 'rev-parse', '--short', 'HEAD']) or '(none)'}")
    print("#")
    print("# Each scenario is rendered by build/dump (elements::Voice or elements::Part, float32)")
    print("# and by faustprobe (dsp/elements_voice.dsp or dsp/elements.dsp, --sr 32000 --block 16,")
    print("# the scenario's changes as --set/--at), and compared sample by sample over its whole")
    print("# length. `diff` is the largest difference in dB of the C++ channel's peak, and in dBFS.")
    print()
    # The worst `rel` of any channel, by (mode, precision), and the number of
    # renders compared, stated in the summary.
    worst = {}
    count = 0
    for single in (True, False):
        for part in (False, True):
            prec = "single" if single else "double"
            mode = "part" if part else "voice"
            print(f"## {mode}, faustprobe {'(single precision)' if single else '--double'}")
            print()
            print("| scenario | frames | channel | peak | diff (dB of peak) | diff (dBFS) | at frame | rms C++ / Faust (dBFS) |")
            print("|---|---|---|---|---|---|---|---|")
            for sc in scenarios:
                # The scenario's path relative to the root, as on the command line of
                # `make test`: build/dump opens it, and the input files it names
                # (scenarios/burst.f32), from the current directory, the root under make.
                _, length, rows = compare.compare(str(sc.relative_to(ROOT)), part, single)
                count += 1
                for r in rows:
                    print(f"| {sc.stem} | {length} | {r['name']} | {r['peak']:.4f} | {r['rel']:.1f} | "
                          f"{r['abs']:.1f} | {r['at']} | {r['rms_cpp']:.2f} / {r['rms_faust']:.2f} |")
                    key = (mode, prec)
                    worst[key] = max(worst.get(key, -1e9), r["rel"])
            print()
    print(f"## Summary: {count} renders compared ({len(scenarios)} scenarios x voice, part x single, double)")
    print()
    for (mode, prec), w in sorted(worst.items()):
        print(f"- {mode}, {prec}: worst channel {w:.1f} dB of its peak")


if __name__ == "__main__":
    main()
