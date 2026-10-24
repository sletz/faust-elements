#!/bin/sh
# The cost of the model: faustprobe (Cranelift JIT) and the native build
# (faust-rs -lang cpp, clang -O3) of dsp/elements.dsp, against the C++ of Elements
# (build/dump part), on 100 s of a held bowed note per resonator model.
# Run from the repository root (make cost).
#
#   ./scripts/cost.sh                    (make cost; make results writes results/cost.txt)
#
# Needs build/dump (make ref), build/native/render (the native build, which make cost
# builds first) and faustprobe ($FAUSTPROBE, default
# ../faust-rs/target/release/faustprobe); $FAUST_RS (default ../faust-rs) is read for
# its commit. Writes build/cost_M.txt (the scenarios), build/cost.f32 and
# build/cost.wav (the renders, discarded). Prints, on stdout, a header (machine,
# faust-rs, C++ compiler) and one line per resonator model: the compute time of
# each implementation in ms per second of audio. Stops at the first command that
# fails (set -e).
set -e
FAUSTPROBE=${FAUSTPROBE:-../faust-rs/target/release/faustprobe}
mkdir -p build
echo "# machine: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), $(uname -sr)"
echo "# faust-rs: $($FAUSTPROBE --version | head -1), commit $(git -C ${FAUST_RS:-../faust-rs} rev-parse --short HEAD)"
echo "# C++: $(c++ --version | head -1)"
echo "# 100 s at 32 kHz (3.2 M frames), gate held, bow 0.5; ms of compute per second of audio"
# One scenario per resonator model (0 modal, 1 string, 2 strings): 3,200,000 frames,
# the gate and the bow set at frame 0 and held.
for m in 0 1 2; do
  printf "length 3200000\n0 gate 1\n0 bow 0.5\n0 model $m\n" > build/cost_$m.txt
done
for m in 0 1 2; do
  # The model's name, the (m + 1)-th word of the list.
  name=$(echo "modal string strings" | cut -d' ' -f$((m + 1)))
  # The C++: the user CPU time of build/dump on the 100 s scenario, from time -p
  # (written to stderr, hence the group's 2>&1), in seconds; times 1000 ms per
  # second, divided by 100 s of audio, is times 10. It includes the start of the
  # program and the writing of the output file, small against 100 s.
  c=$( { /usr/bin/time -p ./build/dump part build/cost_$m.txt build/cost.f32 > /dev/null; } 2>&1 | awk '/user/{print $2 * 10}')
  # The native build prints its own compute time, "..., X ms per second, ...":
  # keep X.
  n=$(./build/native/render build/cost_$m.txt build/cost.wav | sed 's/.*audio, \([0-9.]*\) ms per second.*/\1/')
  # faustprobe: 10 s only (320,000 frames, the JIT is slower), the same controls
  # given with --set. --time reports "compute X ms for 10.0 s": X / 10 is ms per
  # second of audio. Compilation is not counted.
  j=$($FAUSTPROBE -I dsp --sr 32000 -n 320000 --in zero --quiet --time --set gate=1 --set bow=0.5 --set model=$m \
      dsp/elements.dsp 2>&1 | sed -n 's/.*compute \([0-9.]*\) ms for 10.0 s.*/\1/p' | awk '{print $1 / 10}')
  echo "model $m ($name): C++ $c ms/s, Faust native $n ms/s, Faust faustprobe (10 s) $j ms/s"
done
