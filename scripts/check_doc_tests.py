#!/usr/bin/env python3
"""Compile every `#### Test` block of dsp/elements.lib with faustprobe.

Each block defines `NAME_test = ...`; the program `import("stdfaust.lib");`, the
block, `process = NAME_test;` is compiled and rendered for 64 frames at 32 kHz.
Prints one line per test and exits 1 when one fails.
"""

import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FAUSTPROBE = os.environ.get("FAUSTPROBE", str(ROOT / "../faust-rs/target/release/faustprobe"))


def tests(lib):
    lines = lib.read_text().splitlines()
    i = 0
    while i < len(lines):
        if lines[i].strip() == "// #### Test":
            j = i + 1
            assert lines[j].strip() == "// ```", f"line {j + 1}: a test block opens with ```"
            body = []
            j += 1
            while lines[j].strip() != "// ```":
                body.append(lines[j][3:] if lines[j].startswith("// ") else lines[j][2:])
                j += 1
            yield i + 1, "\n".join(body)
            i = j
        i += 1


def main():
    lib = ROOT / "dsp" / "elements.lib"
    failed = 0
    count = 0
    with tempfile.TemporaryDirectory() as d:
        for line, body in tests(lib):
            count += 1
            m = re.search(r"^(\w+_test)\s*=", body, re.M)
            if not m:
                print(f"FAIL line {line}: no NAME_test definition")
                failed += 1
                continue
            name = m.group(1)
            dsp = Path(d) / f"{name}.dsp"
            dsp.write_text(f'import("stdfaust.lib");\n{body}\nprocess = {name};\n')
            r = subprocess.run([FAUSTPROBE, "-I", str(ROOT / "dsp"), "--sr", "32000", "-n", "64",
                                "--in", "zero", "--quiet", str(dsp)], capture_output=True, text=True)
            if r.returncode != 0:
                failed += 1
                print(f"FAIL {name} (line {line})")
                print("\n".join("    " + l for l in r.stderr.strip().splitlines()[:12]))
            else:
                print(f"ok   {name}")
    print(f"{count - failed} of {count} tests compile")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
