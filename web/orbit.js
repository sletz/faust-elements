// The parameter space of the instrument explored with faust-orbit-ui (Yann
// Orlarey, MIT, web/vendor/faust-orbit-ui): every control of the voice and the
// body is a dot on an orbit, moved by dragging, randomized, or interpolated
// between the presets of a library projected on a plane (the calque: a
// PCA-weighted projection, Shepard interpolation between its discs).
//
// The library starts with the page's presets; what the user adds, renames or
// deletes there is kept in the browser (localStorage, when it allows it).
//
// How it fits: app.js builds the orbit the first time the Orbit tab is shown with the
// DSPs loaded (makeOrbit). A dot moved in the orbit calls `onChange`, which app.js sends
// on as any control change (setControl), then checks which preset the sound now is
// (presetOf); a control changed elsewhere (a slider, a preset, the atlas, the timbre
// orbit) moves its dot by `setValues`. Controls are addressed by key, the Faust address
// without the program name ("exciter/bow"); the component uses full addresses
// ("/elements_poly/exciter/bow").
import { OrbitUI, computeConfigHashSync, uiItems } from "./orbit-imports.js";

// Controls the orbit leaves to the keyboard: the note, its velocity and gate,
// and the pitch offset.
const EXCLUDED = new Set(["freq", "gain", "gate", "performance/modulation"]);

// A full address without its program name: faust-wasm-dsp.js's controlKey.
const keyOf = (address) => address.split("/").filter(Boolean).slice(1).join("/");

/**
 * The voice's and the body's UI trees as one descriptor, without EXCLUDED: the groups
 * emptied by the exclusion are dropped, and each DSP's top group is unwrapped so that the
 * two programs' groups sit side by side in one vgroup.
 * @param {Object} voiceJson - the voice DSP's JSON
 * @param {Object} bodyJson - the body DSP's JSON
 * @returns {Array<Object>} a Faust JSON `ui` array, as the component's uiDescriptor
 */
function descriptor(voiceJson, bodyJson) {
  // The items kept, depth first: a group with at least one control left, a control not
  // excluded.
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
  // A DSP's groups, its top group unwrapped.
  const top = (json) => keep(json.ui).flatMap((g) => (Array.isArray(g.items) ? g.items : [g]));
  return [{ type: "vgroup", label: "elements", items: [...top(voiceJson), ...top(bodyJson)] }];
}

/**
 * Builds the orbit of the controls and its library, seeded with the presets or restored
 * from the browser's storage.
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
  // The component's descriptor; every control's full address, the address by key, and the
  // DSPs' default (init) by address.
  const ui = descriptor(o.voiceJson, o.bodyJson);
  const addresses = uiItems(ui).map((item) => item.address);
  const address = new Map(addresses.map((a) => [keyOf(a), a]));
  const init = new Map(uiItems(ui).map((item) => [item.address, Number(item.init)]));

  // The component reports a dot moved by its full address, and the whole library after
  // every addition, renaming or deletion.
  const orbit = new OrbitUI(container, {
    uiDescriptor: ui,
    onParamChange: (path, value) => o.onChange(keyOf(path), value),
    onLibraryChange: (records) => save(records),
    tooltips: o.tooltips,
  });

  // The library is stored under the hash of the UI: when the DSPs' controls change, their
  // library starts again from the presets rather than recalling configurations of other
  // controls.
  const storeKey = `faust-elements-orbit-library-${orbit.uiHash}`;
  /**
   * Stores the library's records (JSON), when the browser allows it.
   * @param {Array<Object>} records - the component's library records
   */
  function save(records) {
    try {
      localStorage.setItem(storeKey, JSON.stringify(records));
    } catch {
      // Storage refused: the library lives as long as the page.
    }
  }

  // A preset's configuration: its values over the DSPs' defaults, by full address (every
  // control, so that its hash is the one the component computes for the same sound).
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

  // The presets as named library records, the first one the most recent (`lastSeenAt`
  // orders the component's list), in the page's language.
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

  // The preset the current values are exactly (the same configuration hash), or null; a
  // control missing from `values` counts as its default.
  const presetOf = (values) => {
    const configuration = {};
    for (const a of addresses) configuration[a] = values.has(keyOf(a)) ? values.get(keyOf(a)) : init.get(a);
    return presetByHash.get(computeConfigHashSync(configuration)) ?? null;
  };

  // The stored library if there is one, else the presets; storage refused or unreadable
  // counts as none.
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(storeKey) || "null");
  } catch {
    stored = null;
  }
  orbit.setLibrary(Array.isArray(stored) && stored.length ? stored : seed());

  // Moves the dots of the given controls ([key, value] pairs): the component does not
  // report values set by the host, so `onChange` is not called, and it clears its
  // parameters' undo history. Keys the orbit does not show (EXCLUDED) are ignored.
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
    if (!(event.target instanceof Node) || !container.contains(event.target)) return;
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

  // `resize` lays the dots out again from the container's size, when the tab is shown.
  return { setValues, resize: () => orbit.resize(), presetOf };
}
