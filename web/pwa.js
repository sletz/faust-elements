// The page's Phone tab: which controls follow which axis of the phone's
// accelerometer, a simulation of the axes to hear it here, and the phone app
// built in the page (a PWA: web/phone/ with the DSPs, the current patch and the
// mappings), stored by the page's server (scripts/web_serve.py, POST /pwa/apps)
// and shown as a QR code to install it from.
//
// Hosting: on the local network, over HTTPS with the certificate of make
// pwa-cert (the phone trusts its local authority once: a second QR code), or
// through an ngrok tunnel on a public HTTPS address.
import { AXES, CURVES, mapAxis, normalize } from "./motion.js";
import { qrSvg } from "./qrcode.js";

const STORE = "faust-elements-phone";
// The files of an app, from the page's directory, and where they go in it.
const ASSETS = [
  ["phone/phone.js", "phone.js"],
  ["phone/phone.css", "phone.css"],
  ["motion.js", "motion.js"],
  ["elements-processor.js", "elements-processor.js"],
  ["faust-wasm-dsp.js", "faust-wasm-dsp.js"],
  ["dsp/voice.wasm", "dsp/voice.wasm"],
  ["dsp/voice.json", "dsp/voice.json"],
  ["dsp/body.wasm", "dsp/body.wasm"],
  ["dsp/body.json", "dsp/body.json"],
];
// faust-ui (GPL-3.0-or-later), carried only by an app built with its interface.
const FAUST_UI = [
  ["vendor/faust-ui/index.js", "faust-ui/index.js"],
  ["vendor/faust-ui/index.css", "faust-ui/index.css"],
  ["vendor/faust-ui/README.md", "faust-ui/README.md"],
];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// Controls the phone leaves to its keyboard.
const KEYBOARD = new Set(["freq", "gain", "gate"]);

const TEXT = {
  en: {
    help: "Make an app for the phone: the current sound, a keyboard, and controls that follow the phone's motion. Tilting the phone moves the X axis (left, right) and the Y axis (towards you, away), from about −10 to 10 m/s²; Z is the screen facing up (10) or down (−10).",
    mappings: "Motion", add: "Add a control", remove: "Remove",
    parameter: "Control", axis: "Axis", curve: "Curve", sensor: "Axis: low, centre, high (m/s²)",
    values: "Control: min, centre, max",
    curves: { up: "Up", down: "Down", updown: "Up-down", downup: "Down-up" },
    simulate: "Simulate the axes here", simulateHelp: "Move the axes to hear the mappings on this computer.",
    app: "App", name: "Name", polyphony: "Voices", hosting: "Install from",
    lan: "The local network (HTTPS, Wi-Fi)", tunnel: "The internet (ngrok tunnel)",
    build: "Build the app", building: "Building…", tunnelling: "Opening the tunnel…",
    noServer: "The page's server does not answer /pwa/: start it with make web-serve.",
    noCert: "No certificate for the local network: run make pwa-cert, then restart make web-serve.",
    certMoved: "The certificate is for {old}, this computer is now {new}: run make pwa-cert, then restart make web-serve.",
    step1: "1. Once per phone: trust the local authority", step1Help: "Open, download ca.crt, then trust it. Android: tapping the download is refused (\"can't install CA certificates\"); go to Settings, search \"CA certificate\" (Security, Encryption & credentials, Install a certificate, CA certificate), Install anyway, pick faust-elements-ca.crt in Downloads (a screen lock is required). iPhone: Settings, Profile Downloaded, Install; then General, About, Certificate Trust Settings, full trust. Or build with the internet (ngrok): no certificate to install.",
    step2: "2. Open the app, then add it to the home screen", step2Help: "Same Wi-Fi as this computer. iPhone: Share, Add to Home Screen; Android: Install app.",
    tunnelHelp: "Open, then add it to the home screen (iPhone: Share, Add to Home Screen; Android: Install app). ngrok may first show a warning page: continue to the site. The app plays offline once installed.",
    stopTunnel: "Close the tunnel", built: "Built: {files} files, {size} MB.",
    show: "On the phone", keyboard: "Keyboard", onoff: "ON/OFF button holding the note",
    faustUI: "faust-ui interface: every control (the app is then GPL-3.0)",
  },
  fr: {
    help: "Fabriquer une application pour le téléphone : le son courant, un clavier, et des commandes qui suivent le mouvement du téléphone. Incliner le téléphone fait varier l'axe X (gauche, droite) et l'axe Y (vers soi, loin de soi), d'environ −10 à 10 m/s² ; Z est l'écran tourné vers le haut (10) ou vers le bas (−10).",
    mappings: "Mouvement", add: "Ajouter une commande", remove: "Retirer",
    parameter: "Commande", axis: "Axe", curve: "Courbe", sensor: "Axe : bas, centre, haut (m/s²)",
    values: "Commande : min, centre, max",
    curves: { up: "Monte", down: "Descend", updown: "Monte-descend", downup: "Descend-monte" },
    simulate: "Simuler les axes ici", simulateHelp: "Déplacez les axes pour entendre les associations sur cet ordinateur.",
    app: "Application", name: "Nom", polyphony: "Voix", hosting: "Installer depuis",
    lan: "Le réseau local (HTTPS, Wi-Fi)", tunnel: "Internet (tunnel ngrok)",
    build: "Fabriquer l'application", building: "Fabrication…", tunnelling: "Ouverture du tunnel…",
    noServer: "Le serveur de la page ne répond pas à /pwa/ : lancez-le avec make web-serve.",
    noCert: "Pas de certificat pour le réseau local : lancez make pwa-cert, puis relancez make web-serve.",
    certMoved: "Le certificat est pour {old}, cet ordinateur est maintenant {new} : lancez make pwa-cert, puis relancez make web-serve.",
    step1: "1. Une fois par téléphone : faire confiance à l'autorité locale", step1Help: "Ouvrez, téléchargez ca.crt, puis faites-lui confiance. Android : toucher le téléchargement est refusé (« Impossible d'installer les certificats CA ») ; allez dans Paramètres, cherchez « certificat CA » (Sécurité, Chiffrement et identifiants, Installer un certificat, Certificat CA), Installer quand même, choisissez faust-elements-ca.crt dans Téléchargements (un verrouillage de l'écran est nécessaire). iPhone : Réglages, Profil téléchargé, Installer ; puis Général, Informations, Réglages des certificats, confiance totale. Ou fabriquez avec Internet (ngrok) : aucun certificat à installer.",
    step2: "2. Ouvrir l'application, puis l'ajouter à l'écran d'accueil", step2Help: "Même Wi-Fi que cet ordinateur. iPhone : Partager, Sur l'écran d'accueil ; Android : Installer l'application.",
    tunnelHelp: "Ouvrez, puis ajoutez-la à l'écran d'accueil (iPhone : Partager, Sur l'écran d'accueil ; Android : Installer l'application). ngrok peut d'abord afficher une page d'avertissement : continuez vers le site. Une fois installée, l'application joue hors ligne.",
    stopTunnel: "Fermer le tunnel", built: "Fabriquée : {files} fichiers, {size} Mo.",
    show: "Sur le téléphone", keyboard: "Clavier", onoff: "Bouton ON/OFF qui tient la note",
    faustUI: "Interface faust-ui : toutes les commandes (l'application est alors sous GPL-3.0)",
  },
};

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "null") || {};
  } catch {
    return {};
  }
}

function save(state) {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    // Storage refused: the tab is not remembered.
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// An app's id: the time it was built and six random characters.
function appId() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${rand}`;
}

// The app's icon: rings of a resonator and the name's initial, as a PNG.
async function icon(size, name) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  g.fillStyle = "#1b1b1d";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "#e07a5f";
  for (let i = 1; i <= 4; i += 1) {
    g.globalAlpha = 1 - i * 0.18;
    g.lineWidth = size * 0.03;
    g.beginPath();
    g.arc(size / 2, size / 2, size * (0.12 + i * 0.08), 0, 2 * Math.PI);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = "#eee";
  g.font = `600 ${Math.round(size * 0.3)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText((name.trim()[0] || "E").toUpperCase(), size / 2, size / 2 + size * 0.01);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * @param {HTMLElement} container - the tab's panel content (emptied)
 * @param {Object} o
 * @param {string} o.lang - "en" or "fr"
 * @param {Array<Object>} o.controls - CONTROLS of controls.js (labels by language)
 * @param {Map<string, Object>} o.ranges - each control's {min, max, step, init}
 * @param {Map<string, number>} o.values - the current values
 * @param {(key: string, value: number) => void} o.setControl - sets a control
 * @param {() => string} o.presetName - the name of the current preset
 * @param {() => number} o.polyphony - the page's polyphony
 * @returns {{stopSimulation: () => void}}
 */
export function createPhoneTab(container, o) {
  const T = TEXT[o.lang] || TEXT.en;
  const state = load();
  const keys = o.controls.filter((c) => o.ranges.has(c.key) && !KEYBOARD.has(c.key)).map((c) => c.key);
  const label = (key) => (o.controls.find((c) => c.key === key) || { [o.lang]: [key] })[o.lang][0];
  let mappings = (state.mappings || []).filter((m) => o.ranges.has(m.key));
  const persist = () => save({ ...load(), mappings, name: nameInput.value, hosting: hostingValue(), show: showValue() });

  container.innerHTML = "";
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  container.append(el("p", "help", T.help));

  // --- The mappings.
  container.append(el("h3", "", T.mappings));
  const table = el("div", "phone-maps");
  container.append(table);
  const add = el("button", "", T.add);
  add.type = "button";
  container.append(add);

  const numberInput = (value, step) => {
    const i = document.createElement("input");
    i.type = "number";
    i.step = String(step);
    i.value = String(value);
    return i;
  };
  const select = (options, value) => {
    const s = document.createElement("select");
    for (const [v, text] of options) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = text;
      s.appendChild(opt);
    }
    s.value = value;
    return s;
  };

  function defaults(key) {
    const r = o.ranges.get(key);
    return { key, axis: "x", curve: "up", amin: -10, amid: 0, amax: 10, min: r.min, centre: o.values.get(key) ?? r.init, max: r.max };
  }

  function drawMappings() {
    table.innerHTML = "";
    if (!mappings.length) return;
    const head = el("div", "phone-map head");
    for (const h of [T.parameter, T.axis, T.curve, T.sensor, T.values, ""]) head.append(el("span", "", h));
    table.append(head);
    mappings.forEach((m, i) => {
      const r = o.ranges.get(m.key);
      const step = r.step >= 1 ? 1 : 0.001;
      const row = el("div", "phone-map");
      const param = select(keys.map((k) => [k, label(k)]), m.key);
      const axis = select(AXES.map((a) => [a, a.toUpperCase()]), m.axis);
      const curve = select(CURVES.map((c) => [c, T.curves[c]]), m.curve);
      const sensor = el("span", "triple");
      const [amin, amid, amax] = [m.amin, m.amid, m.amax].map((v) => numberInput(v, 0.1));
      sensor.append(amin, amid, amax);
      const vals = el("span", "triple");
      const [vmin, vcentre, vmax] = [m.min, m.centre, m.max].map((v) => numberInput(v, step));
      vals.append(vmin, vcentre, vmax);
      const remove = el("button", "", "×");
      remove.type = "button";
      remove.title = T.remove;
      remove.setAttribute("aria-label", T.remove);
      param.addEventListener("change", () => {
        mappings[i] = { ...defaults(param.value), axis: axis.value, curve: curve.value, amin: m.amin, amid: m.amid, amax: m.amax };
        persist();
        drawMappings();
      });
      const update = () => {
        mappings[i] = normalize({
          key: m.key, axis: axis.value, curve: curve.value,
          amin: amin.value, amid: amid.value, amax: amax.value,
          min: vmin.value, centre: vcentre.value, max: vmax.value,
        }, r);
        persist();
        simulate();
      };
      for (const input of [axis, curve, amin, amid, amax, vmin, vcentre, vmax]) input.addEventListener("change", update);
      remove.addEventListener("click", () => {
        mappings.splice(i, 1);
        persist();
        drawMappings();
      });
      row.append(param, axis, curve, sensor, vals, remove);
      table.append(row);
    });
  }

  add.addEventListener("click", () => {
    const free = keys.find((k) => !mappings.some((m) => m.key === k)) || keys[0];
    mappings.push(normalize(defaults(free), o.ranges.get(free)));
    persist();
    drawMappings();
  });

  // --- The simulation: three sliders in place of the phone's axes.
  const sim = el("div", "phone-sim");
  const simLabel = el("label");
  const simBox = document.createElement("input");
  simBox.type = "checkbox";
  simLabel.append(simBox, ` ${T.simulate}`);
  sim.append(simLabel, el("p", "help", T.simulateHelp));
  const axisValues = { x: 0, y: 0, z: 9.8 };
  const sliders = {};
  for (const a of AXES) {
    const row = el("label", "phone-axis");
    const s = document.createElement("input");
    s.type = "range";
    s.min = "-10";
    s.max = "10";
    s.step = "0.1";
    s.value = String(axisValues[a]);
    const v = el("span", "value", Number(s.value).toFixed(1));
    s.addEventListener("input", () => {
      axisValues[a] = Number(s.value);
      v.textContent = axisValues[a].toFixed(1);
      simulate();
    });
    sliders[a] = s;
    row.append(el("span", "", a.toUpperCase()), s, v);
    sim.append(row);
  }
  simBox.addEventListener("change", simulate);
  container.append(sim);

  function simulate() {
    if (!simBox.checked) return;
    for (const m of mappings) {
      const r = o.ranges.get(m.key);
      let value = mapAxis(m, axisValues[m.axis]);
      if (r.step >= 1) value = Math.round(value);
      o.setControl(m.key, value);
    }
  }

  // --- The app.
  container.append(el("h3", "", T.app));
  const form = el("div", "phone-app");
  const nameLabel = el("label", "", `${T.name} `);
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.value = state.name || o.presetName();
  nameInput.addEventListener("change", persist);
  nameLabel.append(nameInput);
  const hosting = el("fieldset", "phone-hosting");
  hosting.append(el("legend", "", T.hosting));
  for (const [v, text] of [["lan", T.lan], ["tunnel", T.tunnel]]) {
    const l = el("label");
    const r = document.createElement("input");
    r.type = "radio";
    r.name = "phone-hosting";
    r.value = v;
    r.checked = (state.hosting || "lan") === v;
    r.addEventListener("change", persist);
    l.append(r, ` ${text}`);
    hosting.append(l);
  }
  const hostingValue = () => hosting.querySelector("input:checked")?.value || "lan";

  // What the app shows: the keyboard, an ON/OFF button holding a note (as the
  // SmartFaust apps' ON/OFF switch), the faust-ui interface of every control.
  const shown = { keyboard: true, onoff: false, note: 57, faustUI: false, ...(state.show || {}) };
  const show = el("fieldset", "phone-show");
  show.append(el("legend", "", T.show));
  const check = (key, text) => {
    const l = el("label");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = Boolean(shown[key]);
    c.dataset.show = key;
    c.addEventListener("change", persist);
    l.append(c, ` ${text}`);
    return l;
  };
  const onoffRow = check("onoff", T.onoff);
  const note = select(Array.from({ length: 61 }, (_, i) => {
    const k = 24 + i;
    return [String(k), `${NOTE_NAMES[k % 12]}${Math.floor(k / 12) - 1}`];
  }), String(shown.note));
  note.addEventListener("change", persist);
  onoffRow.append(" ", note);
  show.append(check("keyboard", T.keyboard), onoffRow, check("faustUI", T.faustUI));
  const showValue = () => ({
    ...Object.fromEntries([...show.querySelectorAll("input[data-show]")].map((c) => [c.dataset.show, c.checked])),
    note: Number(note.value),
  });
  const build = el("button", "primary", T.build);
  build.type = "button";
  form.append(nameLabel, hosting, show, build);
  const result = el("div", "phone-result");
  container.append(form, result);

  async function api(path, body) {
    const r = await fetch(path, body === undefined ? undefined : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const ct = r.headers.get("Content-Type") || "";
    if (!ct.includes("application/json")) throw new Error(T.noServer);
    const json = await r.json();
    if (!r.ok && !json.lan) throw new Error(json.error || `${r.status}`);
    return json;
  }

  async function makeFiles(id, name) {
    const files = {};
    let size = 0;
    const put = (path, bytes) => {
      files[path] = base64(bytes);
      size += bytes.length;
    };
    const text = (s) => new TextEncoder().encode(s);
    const view = showValue();
    for (const [from, to] of [...ASSETS, ...(view.faustUI ? FAUST_UI : [])]) {
      const r = await fetch(from, { cache: "no-store" });
      if (!r.ok) throw new Error(`${from}: ${r.status}`);
      put(to, new Uint8Array(await r.arrayBuffer()));
    }
    const html = await fetch("phone/index.html", { cache: "no-store" }).then((r) => r.text());
    put("index.html", text(html.replace(/<!--[\s\S]*?-->\n/, "").replaceAll("__LANG__", o.lang).replaceAll("__NAME__", escapeHtml(name))));
    const patch = {};
    for (const [k, v] of o.values) if (!KEYBOARD.has(k)) patch[k] = v;
    const used = new Set(mappings.map((m) => m.key));
    const config = {
      name, lang: o.lang, build: id, polyphony: o.polyphony(), velocity: 0.8, octave: 4,
      keyboard: view.keyboard, onoff: view.onoff ? { key: view.note } : null, faustUI: view.faustUI,
      patch,
      mappings: mappings.map((m) => normalize(m, o.ranges.get(m.key))),
      labels: Object.fromEntries([...used].map((k) => [k, label(k)])),
      ranges: Object.fromEntries([...used].map((k) => [k, { min: o.ranges.get(k).min, max: o.ranges.get(k).max }])),
      steps: Object.fromEntries([...used].map((k) => [k, o.ranges.get(k).step])),
      curveNames: T.curves,
    };
    put("config.json", text(JSON.stringify(config, null, 1)));
    put("manifest.webmanifest", text(JSON.stringify({
      name, short_name: name.length > 12 ? name.slice(0, 12) : name, id: "./", start_url: "./", scope: "./",
      display: "standalone", orientation: "portrait", background_color: "#1b1b1d", theme_color: "#1b1b1d",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    }, null, 1)));
    for (const s of [180, 192, 512]) put(`icon-${s}.png`, await icon(s, name));
    // The service worker caches every other file, and the app's address itself.
    const list = ["./", ...Object.keys(files)];
    const sw = await fetch("phone/service-worker.js", { cache: "no-store" }).then((r) => r.text());
    put("service-worker.js", text(sw
      .replace('"faust-elements-__BUILD__"', JSON.stringify(`faust-elements-${id}`))
      .replace("const FILES = __FILES__;", `const FILES = ${JSON.stringify(list)};`)));
    return { files, size };
  }

  function showLinks(info, url, mode) {
    result.innerHTML = "";
    const block = (title, help, link) => {
      const b = el("div", "phone-qr");
      const qr = el("div", "qr");
      qr.innerHTML = qrSvg(link, 200);
      const a = el("a", "", link);
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      const textCol = el("div");
      textCol.append(el("strong", "", title), el("p", "help", help), a);
      b.append(qr, textCol);
      result.append(b);
    };
    if (mode === "lan") {
      block(T.step1, T.step1Help, info.lan.ca);
      block(T.step2, T.step2Help, url);
    } else {
      block(T.app, T.tunnelHelp, url);
      const stop = el("button", "", T.stopTunnel);
      stop.type = "button";
      stop.addEventListener("click", async () => {
        await api("/pwa/tunnel", { stop: true }).catch(() => {});
        result.innerHTML = "";
      });
      result.append(stop);
    }
  }

  build.addEventListener("click", async () => {
    build.disabled = true;
    result.innerHTML = "";
    const status = el("p", "help", T.building);
    result.append(status);
    try {
      const mode = hostingValue();
      let info = await api("/pwa/info");
      if (mode === "lan") {
        if (!info.lan.serving || !info.lan.cert_ip) throw new Error(T.noCert);
        if (!info.lan.certified) throw new Error(T.certMoved.replace("{old}", info.lan.cert_ip).replace("{new}", info.lan.ip));
      }
      const name = nameInput.value.trim() || o.presetName();
      const id = appId();
      const { files, size } = await makeFiles(id, name);
      info = await api("/pwa/apps", { id, files });
      let base = info.lan.apps;
      if (mode === "tunnel") {
        status.textContent = T.tunnelling;
        info = await api("/pwa/tunnel", {});
        if (!info.tunnel.url) throw new Error(info.tunnel.error || "ngrok");
        base = info.tunnel.url;
      }
      showLinks(info, `${base}${id}/`, mode);
      result.append(el("p", "help", T.built.replace("{files}", String(Object.keys(files).length)).replace("{size}", (size / 1e6).toFixed(1))));
    } catch (err) {
      result.innerHTML = "";
      result.append(el("p", "phone-error", err.message || String(err)));
    } finally {
      build.disabled = false;
    }
  });

  drawMappings();
  return { stopSimulation: () => { simBox.checked = false; } };
}
