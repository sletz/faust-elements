// The parameter space of the instrument explored with faust-orbit-ui (Yann
// Orlarey, MIT, web/vendor/faust-orbit-ui): every control of the voice and the
// body is a dot on an orbit, moved by dragging, randomized, or interpolated
// between the presets of a library projected on a plane (the calque: a
// PCA-weighted projection, Shepard interpolation between its discs).
//
// The library starts with the page's presets; what the user adds, renames or
// deletes there is kept in the browser (localStorage, when it allows it).
import { OrbitUI, computeConfigHashSync, uiItems } from "./orbit-imports.js";

// Controls the orbit leaves to the keyboard: the note, its velocity and gate,
// and the pitch offset.
const EXCLUDED = new Set(["freq", "gain", "gate", "performance/modulation"]);

const keyOf = (address) => address.split("/").filter(Boolean).slice(1).join("/");

// The voice's and the body's UI trees as one descriptor, without EXCLUDED.
function descriptor(voiceJson, bodyJson) {
  const keep = (items) => {
    const out = [];
    for (const item of items || []) {
      if (Array.isArray(item.items)) {
        const kids = keep(item.items);
        if (kids.length) out.push({ ...item, items: kids });
      } else if (item.address && !EXCLUDED.has(keyOf(item.address))) {
        out.push(item);
      }
    }
    return out;
  };
  const top = (json) => keep(json.ui).flatMap((g) => (Array.isArray(g.items) ? g.items : [g]));
  return [{ type: "vgroup", label: "elements", items: [...top(voiceJson), ...top(bodyJson)] }];
}

/**
 * @param {HTMLElement} container - the element the orbit renders into
 * @param {Object} o
 * @param {Object} o.voiceJson - the voice DSP's JSON
 * @param {Object} o.bodyJson - the body DSP's JSON
 * @param {Array<Object>} o.presets - the page's presets (controls.js)
 * @param {string} o.lang - "en" or "fr", for the presets' names
 * @param {Map<string, number>} o.values - the current control values, by key
 * @param {(key: string, value: number) => void} o.onChange - a control moved in
 *   the orbit (by key)
 * @param {Object} [o.tooltips] - the toolbar's tooltips, localized
 * @returns {{setValues: (entries: Array<[string, number]>) => void, resize: () => void,
 *   presetOf: (values: Map<string, number>) => (string|null)}}
 */
export function createOrbit(container, o) {
  const ui = descriptor(o.voiceJson, o.bodyJson);
  const addresses = uiItems(ui).map((item) => item.address);
  const address = new Map(addresses.map((a) => [keyOf(a), a]));
  const init = new Map(uiItems(ui).map((item) => [item.address, Number(item.init)]));

  const orbit = new OrbitUI(container, {
    uiDescriptor: ui,
    onParamChange: (path, value) => o.onChange(keyOf(path), value),
    onLibraryChange: (records) => save(records),
    tooltips: o.tooltips,
  });

  const storeKey = `faust-elements-orbit-library-${orbit.uiHash}`;
  function save(records) {
    try {
      localStorage.setItem(storeKey, JSON.stringify(records));
    } catch {
      // Storage refused: the library lives as long as the page.
    }
  }

  // A preset's configuration: its values over the DSPs' defaults.
  const configurationOf = (p) => {
    const configuration = {};
    for (const a of addresses) {
      const k = keyOf(a);
      configuration[a] = k in p.values ? p.values[k] : init.get(a);
    }
    return configuration;
  };
  // The presets by the hash of their configuration, the library's key.
  const presetByHash = new Map(o.presets.map((p) => [computeConfigHashSync(configurationOf(p)), p.id]));

  // The presets as named library records, the first one the most recent.
  function seed() {
    const now = Date.now();
    return o.presets.map((p, i) => {
      const configuration = configurationOf(p);
      return {
        uiHash: orbit.uiHash,
        configHash: computeConfigHashSync(configuration),
        name: p[o.lang][0],
        lastSeenAt: now - i * 1000,
        configuration,
      };
    });
  }

  // The preset the current values are exactly, or null.
  const presetOf = (values) => {
    const configuration = {};
    for (const a of addresses) configuration[a] = values.has(keyOf(a)) ? values.get(keyOf(a)) : init.get(a);
    return presetByHash.get(computeConfigHashSync(configuration)) ?? null;
  };

  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(storeKey) || "null");
  } catch {
    stored = null;
  }
  orbit.setLibrary(Array.isArray(stored) && stored.length ? stored : seed());

  const setValues = (entries) => {
    const config = {};
    for (const [k, v] of entries) if (address.has(k)) config[address.get(k)] = v;
    if (Object.keys(config).length) orbit.setParams(config);
  };
  setValues([...o.values]);

  // Cmd/Ctrl+Z inside the orbit: the library's history while the calque is
  // open, the parameters' history otherwise (the component's convention).
  window.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z" || event.repeat) return;
    if (!(event.target instanceof Element) || !event.target.closest(".orbit-ui-root")) return;
    event.preventDefault();
    const redo = event.shiftKey;
    if (container.classList.contains("orbit-ui-overlay-active")) {
      if (redo) orbit.redoLibrary();
      else orbit.undoLibrary();
    } else if (redo) {
      orbit.redoParams();
    } else {
      orbit.undoParams();
    }
  });

  return { setValues, resize: () => orbit.resize(), presetOf };
}
