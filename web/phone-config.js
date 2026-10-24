// The configuration of a phone app carried in its address, for the apps that no
// server stores (web/play/, on GitHub Pages or any static host): the page's
// Phone tab writes it (web/pwa.js), the app reads it (web/phone/phone.js), and
// the static app's service worker names the app from it.
//
//   ?c=BASE64URL(JSON)
//
// Compact JSON: {v: 1, n: name, l: lang, p: polyphony, k: keyboard 0/1,
// o: ON/OFF note or absent, d: [[control index, value]...]
// the patch's values that differ from the controls' defaults, m: [[control
// index, axis, curve, amin, amid, amax, min, centre, max]...]}. A control's
// index is its rank in controlKeys (the voice's then the body's controls, as
// their JSON lists them, but the keyboard's).

const KEYBOARD = new Set(["freq", "gain", "gate"]);

/** The leaves of a Faust JSON `ui` tree, depth first (as faust-wasm-dsp.js). */
function leaves(ui, out = []) {
  for (const item of ui || []) {
    if (Array.isArray(item.items)) leaves(item.items, out);
    else out.push(item);
  }
  return out;
}

const keyOf = (address) => address.split("/").filter(Boolean).slice(1).join("/");

/**
 * The controls of the voice and the body, but the keyboard's, in order, with
 * their ranges.
 * @param {Object} voiceJson
 * @param {Object} bodyJson
 * @returns {Array<{key: string, min: number, max: number, step: number, init: number}>}
 */
export function controlList(voiceJson, bodyJson) {
  const out = [];
  for (const json of [voiceJson, bodyJson]) {
    for (const item of leaves(json.ui)) {
      if (item.min === undefined) continue;
      const key = keyOf(item.address);
      if (KEYBOARD.has(key) || out.some((c) => c.key === key)) continue;
      out.push({ key, min: Number(item.min), max: Number(item.max), step: Number(item.step), init: Number(item.init) });
    }
  }
  return out;
}

const round = (x) => Number(Number(x).toPrecision(4));

function base64url(text) {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function unbase64url(s) {
  const b = atob(s.replaceAll("-", "+").replaceAll("_", "/"));
  return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
}

/**
 * A configuration as the text of `c`.
 * @param {Object} config - {name, lang, polyphony, keyboard, onoff: {key}|null,
 *   patch: {key: value}, mappings: [normalized mappings]}
 * @param {Array<Object>} controls - from controlList
 * @returns {string}
 */
export function encodeConfig(config, controls) {
  const index = new Map(controls.map((c, i) => [c.key, i]));
  const d = [];
  controls.forEach((c, i) => {
    const v = config.patch[c.key];
    if (v !== undefined && round(v) !== round(c.init)) d.push([i, round(v)]);
  });
  const m = config.mappings.filter((x) => index.has(x.key)).map((x) => [
    index.get(x.key), x.axis, x.curve, round(x.amin), round(x.amid), round(x.amax), round(x.min), round(x.centre), round(x.max),
  ]);
  const compact = { v: 1, n: config.name, l: config.lang, p: config.polyphony, k: config.keyboard ? 1 : 0, d, m };
  if (config.onoff) compact.o = config.onoff.key;
  return base64url(JSON.stringify(compact));
}

/**
 * The compact configuration in the text of `c`, or null.
 * @param {string} c
 * @returns {Object|null}
 */
export function decodeConfig(c) {
  try {
    const compact = JSON.parse(unbase64url(c));
    return compact && compact.v === 1 ? compact : null;
  } catch {
    return null;
  }
}

/**
 * A compact configuration made whole, as a built app's config.json: the patch
 * over the controls' defaults, the mappings with their keys.
 * @param {Object|null} compact - from decodeConfig (null: the defaults)
 * @param {Array<Object>} controls - from controlList
 * @returns {Object}
 */
export function expandConfig(compact, controls) {
  const c = compact || {};
  const patch = Object.fromEntries(controls.map((x) => [x.key, x.init]));
  for (const [i, v] of c.d || []) if (controls[i]) patch[controls[i].key] = v;
  const mappings = (c.m || []).filter(([i]) => controls[i]).map(([i, axis, curve, amin, amid, amax, min, centre, max]) => ({
    key: controls[i].key, axis, curve, amin, amid, amax, min, centre, max,
  }));
  return {
    name: c.n || "Elements",
    lang: c.l === "fr" ? "fr" : "en",
    polyphony: Number.isInteger(c.p) && c.p >= 1 && c.p <= 16 ? c.p : 8,
    velocity: 0.8,
    octave: 4,
    keyboard: c.k !== 0,
    onoff: Number.isInteger(c.o) ? { key: c.o } : null,
    patch,
    mappings,
  };
}

/**
 * A short, stable name for a configuration (FNV-1a of its text), to tell its
 * installed app from the others.
 * @param {string} c
 * @returns {string}
 */
export function configHash(c) {
  let h = 0x811c9dc5;
  for (let i = 0; i < c.length; i += 1) {
    h ^= c.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
