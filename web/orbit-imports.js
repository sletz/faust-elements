// The two modules web/orbit.js needs, in one place: the vendored faust-orbit-ui
// and the JSON walker of faust-wasm-dsp.js.
//
// web/timbre.js imports OrbitUI and computeConfigHashSync from here as well, so that the
// vendored component's path is written once.
//
// - OrbitUI: the component, a canvas of dots (one per control) around a centre, with its
//   toolbar (centre, random) and its library of named configurations (the calque);
// - computeConfigHashSync: the hash the component gives a configuration ({address:
//   value}), the key of its library records, so that records built by the page match its
//   own;
// - uiItems: the leaves of a Faust JSON `ui` tree, the controls without their groups.
export { OrbitUI, computeConfigHashSync } from "./vendor/faust-orbit-ui/index.js";
export { uiItems } from "./faust-wasm-dsp.js";
