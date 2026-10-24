#!/bin/sh
# The cost of the model: faustprobe (Cranelift JIT) and the native build
# (faust-rs -lang cpp, clang -O3) of dsp/elements.dsp, against the C++ of Elements
# (build/dump part), on 100 s of a held bowed note per resonator model.
# Run from the repository root (make cost).
set -e
FAUSTPROBE=${FAUSTPROBE:-../faust-rs/target/release/faustprobe}
mkdir -p build
echo "# machine: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m), $(uname -sr)"
echo "# faust-rs: $($FAUSTPROBE --version | head -1), commit $(git -C ${FAUST_RS:-../faust-rs} rev-parse --short HEAD)"
echo "# C++: $(c++ --version | head -1)"
echo "# 100 s at 32 kHz (3.2 M frames), gate held, bow 0.5; ms of compute per second of audio"
for m in 0 1 2; do
  printf "length 3200000\n0 gate 1\n0 bow 0.5\n0 model $m\n" > build/cost_$m.txt
done
for m in 0 1 2; do
  name=$(echo "modal string strings" | cut -d' ' -f$((m + 1)))
  c=$( { /usr/bin/time -p ./build/dump part build/cost_$m.txt build/cost.f32 > /dev/null; } 2>&1 | awk '/user/{print $2 * 10}')
  n=$(./build/native/render build/cost_$m.txt build/cost.wav | sed 's/.*audio, \([0-9.]*\) ms per second.*/\1/')
  j=$($FAUSTPROBE -I dsp --sr 32000 -n 320000 --in zero --quiet --time --set gate=1 --set bow=0.5 --set model=$m \
      dsp/elements.dsp 2>&1 | sed -n 's/.*compute \([0-9.]*\) ms for 10.0 s.*/\1/p' | awk '{print $1 / 10}')
  echo "model $m ($name): C++ $c ms/s, Faust native $n ms/s, Faust faustprobe (10 s) $j ms/s"
done
