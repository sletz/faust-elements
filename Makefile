# Mutable Instruments Elements in Faust (faust-rs).
#
#   make help        this text (also what a bare `make` prints)
#   make ref         build ref/dump.cpp against Elements' own sources (build/dump)
#   make tables      dump the C++ tables and write dsp/elements_tables.lib
#   make check       compile every program with faustprobe; block sizes, reset and
#                    determinism of the module (faustprobe --check all)
#   make doctests    compile every `#### Test` of dsp/elements.lib
#   make test        every scenario against the C++, voice and module, single and
#                    double precision (scripts/compare.py); exit 1 beyond -60 dB of
#                    the peak in single precision
#   make results     the same, plus the cost, written to results/*.txt
#   make figures     results/fig_bow.png and results/fig_precision.png
#   make paper       the article, paper/faust-elements.pdf (pdflatex + bibtex)
#   make render [SCENARIO=scenarios/demo.txt]
#                    native render (faust-rs -lang cpp, clang -O3) to build/NAME.wav
#   make cost        the cost of the Faust module (faustprobe and native) and of the C++
#   make web         the web version: the voice and the body of dsp/elements_poly.dsp
#                    compiled to wasm by faust-rs into web/dsp (make -B web after a
#                    faust-rs change)
#   make web-check   the wasm DSPs against faustprobe, and their cost (node)
#   make web-presets every preset of the page rendered with the wasm: none silent,
#                    none above 0 dBFS (node)
#   make web-fuzz    random patches (as the orbit's Random) through the wasm: none
#                    diverges (node)
#   make web-atlas   the atlas of the page: 2,000 random patches and the presets
#                    rendered with the wasm, measured and laid out (web/atlas.json,
#                    about a minute; node)
#   make web-serve [PORT=8000]
#                    serve the repository; open http://localhost:PORT/web/
#   make clean       remove build/
#
# ELEMENTS points to a checkout of pichenettes/eurorack with its stmlib submodule;
# FAUST_RS to a faust-rs checkout with release faust-rs and faustprobe built.

ELEMENTS ?= ../../mi-eurorack
FAUST_RS ?= ../faust-rs
FAUSTPROBE ?= $(FAUST_RS)/target/release/faustprobe
FAUSTRS ?= $(FAUST_RS)/target/release/faust-rs
CXX ?= c++
PYTHON ?= python3
export FAUSTPROBE

SCENARIO ?= scenarios/demo.txt
PORT ?= 8000
WEB_DSP = web/dsp
WEB_DEPS = dsp/elements_poly.dsp dsp/elements.lib dsp/elements_tables.lib
SCENARIOS = $(filter-out scenarios/demo.txt,$(wildcard scenarios/*.txt))

ELEMENTS_SRC = $(addprefix $(ELEMENTS)/elements/dsp/,exciter.cc multistage_envelope.cc ominous_voice.cc \
    part.cc resonator.cc string.cc tube.cc voice.cc) $(ELEMENTS)/elements/resources.cc \
    $(ELEMENTS)/stmlib/dsp/units.cc $(ELEMENTS)/stmlib/utils/random.cc
# The reference arithmetic is pinned: no fused multiply-add, no fast-math.
REF_FLAGS = -std=c++14 -O2 -ffp-contract=off -DTEST -I $(ELEMENTS) -Wno-everything

.PHONY: help ref tables check doctests test results figures paper render cost web web-check web-presets web-fuzz web-atlas web-serve clean
help:
	@sed -n '1,/^$$/p' Makefile | sed 's/^# \{0,1\}//'

build/dump: ref/dump.cpp $(ELEMENTS_SRC)
	@mkdir -p build
	$(CXX) $(REF_FLAGS) ref/dump.cpp $(ELEMENTS_SRC) -o $@

ref: build/dump

tables: build/dump
	@mkdir -p build/tables
	./build/dump tables build/tables
	$(PYTHON) scripts/gen_tables.py build/tables dsp/elements_tables.lib

check:
	@for f in dsp/elements.dsp dsp/elements_voice.dsp; do \
	  $(FAUSTPROBE) -I dsp --sr 32000 -n 16 --in zero --quiet $$f > /dev/null && echo "ok   $$f" || { echo "FAIL $$f"; exit 1; }; done
	@$(FAUSTPROBE) -I dsp --sr 32000 --nvoices 2 --note 57:100@0 --note 64:90@1600 -n 3200 --quiet dsp/elements_poly.dsp > /dev/null \
	  && echo "ok   dsp/elements_poly.dsp, 2 voices through the body" || { echo "FAIL dsp/elements_poly.dsp"; exit 1; }
	@$(FAUSTPROBE) --double -I dsp --sr 32000 -n 20000 --in zero --quiet --set gate=1 --set bow=0.4 --set blow=0.8 \
	  --set mallet=0.9 --set space=1.3 --at 8000 gate=0 --at 12013 gate=1 --check all dsp/elements.dsp > build/check.txt \
	  && echo "ok   dsp/elements.dsp: --check all (block sizes, reset, determinism)" || { cat build/check.txt; exit 1; }

doctests:
	$(PYTHON) scripts/check_doc_tests.py

test: build/dump
	$(PYTHON) scripts/compare.py --single $(SCENARIOS)
	$(PYTHON) scripts/compare.py --single --part $(SCENARIOS)
	$(PYTHON) scripts/compare.py --tolerance 0 $(SCENARIOS)
	$(PYTHON) scripts/compare.py --tolerance 0 --part $(SCENARIOS)

results: build/dump build/native/render
	@mkdir -p results
	$(PYTHON) scripts/results.py > results/compare.txt
	./scripts/cost.sh > results/cost.txt

figures: build/dump
	$(PYTHON) scripts/figures.py

paper:
	$(MAKE) -C paper

build/native/elements_module.cpp: dsp/elements.dsp dsp/elements.lib dsp/elements_tables.lib
	@mkdir -p build/native
	$(FAUSTRS) --timeout 0 -I dsp dsp/elements.dsp -o $@

build/native/render: tools/render.cpp build/native/elements_module.cpp
	$(CXX) -std=c++17 -O3 -ffp-contract=off -I build/native tools/render.cpp -o $@

render: build/native/render
	./build/native/render $(SCENARIO) build/$(basename $(notdir $(SCENARIO))).wav

cost: build/dump build/native/render
	./scripts/cost.sh

$(WEB_DSP)/voice.wasm: $(WEB_DEPS)
	@mkdir -p $(WEB_DSP)
	$(FAUSTRS) -lang wasm -single --timeout 0 -I dsp dsp/elements_poly.dsp -o $@

$(WEB_DSP)/body.wasm: $(WEB_DEPS)
	@mkdir -p $(WEB_DSP)
	$(FAUSTRS) -lang wasm -single --timeout 0 -I dsp -pn effect dsp/elements_poly.dsp -o $@

web: $(WEB_DSP)/voice.wasm $(WEB_DSP)/body.wasm

web-check: web
	node scripts/web_check.mjs

web-presets: web
	node scripts/check_presets.mjs

web-fuzz: web
	node scripts/fuzz_web.mjs 2000 1

web-atlas: web/atlas.json

web/atlas.json: $(WEB_DSP)/voice.wasm $(WEB_DSP)/body.wasm web/controls.js scripts/gen_atlas.mjs
	node scripts/gen_atlas.mjs 2000 1

web-serve: web web/atlas.json
	$(PYTHON) scripts/web_serve.py $(PORT)

clean:
	rm -rf build
