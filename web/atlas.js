// The atlas: the sounds of web/atlas.json (scripts/gen_atlas.mjs), the presets
// and random patches, each played once offline and measured, laid out on a plane
// by what they sound like rather than by their controls. A dot is a patch; its
// colour is the resonator's model, the presets are labelled. Hovering shows the
// measures, a click hands the patch to the page. The wheel or a pinch zooms
// about the pointer (over an axis, that axis alone), a drag moves the view, a
// double click or the frame button shows the whole atlas again.
//
// How it fits: app.js makes two of them from the same data, the Atlas tab's (with its bar
// of axis menus, the play switch and the legend) and the compact map beside the orbit
// (the plot alone); both mark the current sound and the sound the timbre orbit asks for.
// web/atlas.json, written by scripts/gen_atlas.mjs, holds:
// - note: the note measured (describe.js's NOTE);
// - axes: the descriptors' names, the order of every point's `d`;
// - controls: the control keys, the order of every point's `v`;
// - components: the principal components, each {variance (a fraction), loadings by
//   descriptor};
// - projection: {axes, mean, sd}, the standardization of the components (describe.js's
//   project);
// - points: one per sound, {v, d, pc (its coordinates on the components), c (1 when its
//   decay was extrapolated), preset (its id, for a preset)}.
//
// Drawing is on a canvas sized to the stage in device pixels and scaled back to CSS
// pixels; the colours are read from the page's CSS custom properties at every draw, so
// that the plot follows the light and dark schemes.

// Measures read on a log scale, as in the principal components.
const LOG_AXES = new Set(["brightness", "attack", "decay"]);
// The room around the plot (CSS px) for the ticks' labels and the axes' titles.
const MARGIN = { left: 56, right: 14, top: 12, bottom: 40 };
const HIT = 10; // px, the reach of the pointer
const MAX_ZOOM = 400; // the narrowest view, as a fraction of the whole extent
const DRAG = 4; // px a press must move to be a drag rather than a click

/**
 * Builds an atlas in a container and draws it; it is drawn again when its box changes
 * size or the colour scheme changes.
 * @param {HTMLElement} container - the element the atlas renders into (emptied)
 * @param {Object} o
 * @param {Object} o.data - web/atlas.json
 * @param {Object} o.text - the localized words: axes {name: [label, unit]},
 *   models [3], pc, sound, xAxis, yAxis, play
 * @param {(id: string) => string} o.presetName - a preset's name by id
 * @param {(index: number, play: boolean) => void} o.onPick - a dot was clicked
 * @param {number} [o.current] - the index of the patch loaded from the atlas
 * @param {boolean} [o.compact] - a small map: the components only, no names
 * @returns {{resize: () => void, setCurrent: (index: number) => void,
 *   setSound: (sound: ?Object) => void, setTarget: (sound: ?Object) => void}}
 *   setSound marks the current sound, setTarget the sound the timbre orbit asks
 *   for: {pc, d (in data.axes order), c (decay extrapolated)}, or null
 */
export function createAtlas(container, o) {
  const { data, text } = o;
  // The index of the model in a point's `v`: the colour of its dot.
  const model = data.controls.indexOf("resonator/model");
  // The axes offered: the two components, then every measure. Each choice has an id, a
  // label (and for a component a short one), `get`, its value for a point, and `log`,
  // whether it is shown on a log scale.
  const choices = [
    ...data.components.map((c, i) => ({ id: `pc${i}`, label: pcLabel(i), short: `${text.pc} ${i + 1}`, get: (p) => p.pc[i], log: false })),
    ...data.axes.map((a, j) => ({
      id: a,
      label: text.axes[a][1] ? `${text.axes[a][0]} (${text.axes[a][1]})` : text.axes[a][0],
      get: (p) => p.d[j],
      log: LOG_AXES.has(a),
    })),
  ];
  // The state: the axes shown, the patch last loaded (a ring), the current sound (a
  // diamond) and the sound asked for (a dashed ring), the dot under the pointer, and
  // every dot's position on the canvas as last drawn (for picking).
  let xAxis = choices[0];
  let yAxis = choices[1];
  let current = o.current ?? -1;
  let sound = null;
  let target = null;
  const compact = Boolean(o.compact);
  const margin = compact ? { left: 30, right: 8, top: 8, bottom: 26 } : MARGIN;
  let hover = -1;
  let screen = new Float32Array(0); // x, y of every dot, CSS px
  // The range shown on each axis, in axis values (log10 on a log axis), or
  // null for the whole extent; and the plot's frame as last drawn.
  const view = { x: null, y: null };
  let frame = null;

  /**
   * The label of a component: its number, its share of the variance and its three
   * strongest loadings (by absolute value), each with the sign of its loading.
   * @param {number} i - the component's index
   * @returns {string}
   */
  function pcLabel(i) {
    const c = data.components[i];
    const top = Object.entries(c.loadings).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
    const parts = top.map(([k, v]) => `${text.axes[k][0].toLowerCase()} ${v > 0 ? "+" : "−"}`);
    return `${text.pc} ${i + 1}, ${Math.round(100 * c.variance)} % (${parts.join(", ")})`;
  }

  // The DOM: a bar (axis menus, the play switch, the legend of the models) above a stage
  // that holds the canvas, the tooltip and the zoom buttons; the compact map has the
  // stage alone.
  container.innerHTML = "";
  const bar = document.createElement("div");
  bar.className = "atlas-bar";
  /**
   * A labelled menu of the axes, set to `axis`, calling `set` with the choice made and
   * drawing again.
   * @param {string} label - the menu's label
   * @param {Object} axis - the choice shown first
   * @param {(choice: Object) => void} set - stores the new choice
   * @returns {HTMLLabelElement}
   */
  const select = (label, axis, set) => {
    const l = document.createElement("label");
    const s = document.createElement("select");
    for (const c of choices) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.label;
      s.appendChild(opt);
    }
    s.value = axis.id;
    s.addEventListener("change", () => {
      set(choices.find((c) => c.id === s.value));
      draw();
    });
    l.append(`${label} `, s);
    return l;
  };
  // Another measure on an axis: that axis shows all of it again.
  bar.append(
    select(text.xAxis, xAxis, (c) => {
      xAxis = c;
      view.x = null;
    }),
    select(text.yAxis, yAxis, (c) => {
      yAxis = c;
      view.y = null;
    }),
  );
  // "Play on click": whether a click on a dot also plays its note.
  const play = document.createElement("label");
  const playBox = document.createElement("input");
  playBox.type = "checkbox";
  playBox.checked = true;
  play.append(playBox, ` ${text.play}`);
  const legend = document.createElement("span");
  legend.className = "atlas-legend";
  for (const [m, name] of text.models.entries()) {
    const item = document.createElement("span");
    item.innerHTML = `<i class="atlas-dot m${m}"></i>`;
    item.append(name);
    legend.appendChild(item);
  }
  bar.append(play, legend);
  const stage = document.createElement("div");
  stage.className = "atlas-stage";
  const canvas = document.createElement("canvas");
  const tip = document.createElement("div");
  tip.className = "atlas-tip";
  tip.hidden = true;
  // Zoom in, out, and the whole atlas, over the plot's top right corner.
  const zoomBar = document.createElement("div");
  zoomBar.className = "atlas-zoom";
  /**
   * A button of the zoom bar.
   * @param {string} label - its text
   * @param {string} title - its tooltip and accessible name
   * @param {() => void} act - what a click does
   * @returns {HTMLButtonElement}
   */
  const zoomButton = (label, title, act) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", act);
    zoomBar.appendChild(b);
    return b;
  };
  // The buttons zoom about the plot's centre by a factor of 1.5; the frame button is
  // disabled while the whole atlas is shown.
  const centre = () => [frame.left + frame.pw / 2, frame.top + frame.ph / 2];
  zoomButton("+", text.zoomIn, () => frame && zoomAt(...centre(), 1 / 1.5, true, true));
  zoomButton("−", text.zoomOut, () => frame && zoomAt(...centre(), 1.5, true, true));
  const whole = zoomButton("⤢", text.zoomReset, () => resetView());
  stage.append(canvas, tip, zoomBar);
  if (compact) container.append(stage);
  else container.append(bar, stage);
  stage.classList.toggle("compact", compact);
  const ctx = canvas.getContext("2d");

  // A point's value on an axis: log10 on a log axis (floored at 1e-3), as the ticks and
  // the view are expressed.
  const value = (axis, p) => {
    const v = axis.get(p);
    return axis.log ? Math.log10(Math.max(v, 1e-3)) : v;
  };
  // The whole extent of an axis over every point, padded by 3 % on each side.
  const extent = (axis) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of data.points) {
      const v = value(axis, p);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const pad = 0.03 * (hi - lo || 1);
    return [lo - pad, hi + pad];
  };

  /**
   * Round ticks between lo and hi: steps of 1, 2 or 5 times a power of ten, and on a log
   * axis the 1, 2, 5 of every decade, or when zoomed within a decade round values placed
   * on the log scale.
   * @param {Object} axis - a choice of `choices`
   * @param {number} lo - the lowest value shown, in axis values (log10 on a log axis)
   * @param {number} hi - the highest
   * @returns {Array<[number, string]>} each tick's position in axis values and its label
   */
  function ticks(axis, lo, hi) {
    const out = [];
    if (axis.log) {
      for (let e = Math.floor(lo); e <= Math.ceil(hi); e += 1) {
        for (const m of [1, 2, 5]) {
          const v = Math.log10(m) + e;
          if (v >= lo && v <= hi) out.push([v, format10(m * 10 ** e)]);
        }
      }
      if (out.length >= 3) return out;
      return linearTicks(10 ** lo, 10 ** hi).filter(([v]) => v > 0).map(([v, label]) => [Math.log10(v), label]);
    }
    return linearTicks(lo, hi);
  }
  /**
   * About six round ticks between lo and hi: the step is the smallest of 1, 2, 5 or 10
   * times a power of ten that is not smaller than a sixth of the span; a tick within half
   * a step of 0 is labelled 0, against the residue of the additions.
   * @param {number} lo
   * @param {number} hi
   * @returns {Array<[number, string]>} each tick's value and its label
   */
  function linearTicks(lo, hi) {
    const out = [];
    const raw = (hi - lo) / 6;
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push([v, format10(Math.abs(v) < step / 2 ? 0 : v)]);
    return out;
  }
  // A tick's label: three significant digits, thousands as "k".
  const format10 = (v) => (Math.abs(v) >= 1000 ? `${v / 1000}k` : String(Number(v.toPrecision(3))));

  // A CSS custom property of the page (a colour), read at draw time.
  const css = (name) => getComputedStyle(container).getPropertyValue(name).trim();

  /**
   * Zoom by `factor` (below 1 zooms in) about the point (px, py) of the canvas, on the x
   * and/or the y axis, keeping the view within the whole extent. The span is held between
   * the whole extent and a MAX_ZOOM-th of it, and the value under the point stays under
   * it.
   * @param {number} px - CSS px from the canvas's left
   * @param {number} py - CSS px from the canvas's top
   * @param {number} factor - the new span over the old one
   * @param {boolean} onX - zoom the horizontal axis
   * @param {boolean} onY - zoom the vertical axis
   */
  function zoomAt(px, py, factor, onX, onY) {
    // One axis: `pos` is the point's place along the view, 0 to 1 from its low end; the
    // value there stays there while the span changes.
    const scale = (key, full, pos) => {
      const [lo, hi] = view[key] || full;
      const span = Math.min(full[1] - full[0], Math.max((full[1] - full[0]) / MAX_ZOOM, (hi - lo) * factor));
      const anchor = lo + pos * (hi - lo);
      view[key] = clampRange(anchor - pos * span, span, full);
    };
    if (onX) scale("x", frame.fullX, (px - frame.left) / frame.pw);
    if (onY) scale("y", frame.fullY, 1 - (py - frame.top) / frame.ph);
    tidyView();
    draw();
  }

  /**
   * Move the view by (dx, dy) CSS px, the plot following the pointer: an axis shown whole
   * does not move, and the view stays within the whole extent (the canvas's y grows
   * downwards, the axis's upwards).
   * @param {number} dx
   * @param {number} dy
   */
  function panBy(dx, dy) {
    for (const [key, full, d, len] of [["x", frame.fullX, -dx, frame.pw], ["y", frame.fullY, dy, frame.ph]]) {
      if (!view[key]) continue;
      const [lo, hi] = view[key];
      view[key] = clampRange(lo + (d / len) * (hi - lo), hi - lo, full);
    }
    draw();
  }

  // [lo, lo + span] moved inside full (span is at most the whole extent).
  const clampRange = (lo, span, full) => {
    const start = Math.min(Math.max(lo, full[0]), full[1] - span);
    return [start, start + span];
  };

  // A view that shows a whole axis is no zoom on it.
  function tidyView() {
    for (const [key, full] of [["x", frame.fullX], ["y", frame.fullY]]) {
      const v = view[key];
      if (v && v[1] - v[0] >= (full[1] - full[0]) * (1 - 1e-9)) view[key] = null;
    }
  }

  // The whole atlas again, on both axes.
  function resetView() {
    view.x = null;
    view.y = null;
    draw();
  }

  /**
   * Draws the atlas: the grid, the ticks and the axes' titles, then inside the plot's
   * frame (clipped) the random patches' dots, the presets' discs and names (no names on
   * the compact map), the sound asked for, the current sound, and the rings of the
   * hovered and the loaded patch. Also records the frame (`frame`) and every dot's
   * position (`screen`) for the pointer's handlers. Nothing is drawn while the stage has
   * no size (its tab hidden).
   */
  function draw() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    // A canvas of device pixels, displayed at CSS size, drawn in CSS px through the
    // transform: sharp on a high-density screen.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const fullX = extent(xAxis);
    const fullY = extent(yAxis);
    const [x0, x1] = view.x || fullX;
    const [y0, y1] = view.y || fullY;
    const pw = w - margin.left - margin.right;
    const ph = h - margin.top - margin.bottom;
    frame = { left: margin.left, top: margin.top, pw, ph, fullX, fullY };
    whole.disabled = !view.x && !view.y;
    // Axis values to CSS px; y grows upwards on the plot.
    const sx = (v) => margin.left + ((v - x0) / (x1 - x0)) * pw;
    const sy = (v) => margin.top + (1 - (v - y0) / (y1 - y0)) * ph;
    const ink = css("--ink");
    const muted = css("--muted");
    const line = css("--line");
    const colours = [0, 1, 2].map((m) => css(`--atlas-m${m}`));

    // Grid and ticks.
    ctx.font = "11px system-ui, sans-serif";
    ctx.lineWidth = 1;
    ctx.strokeStyle = line;
    ctx.fillStyle = muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const [v, label] of ticks(xAxis, x0, x1)) {
      const x = Math.round(sx(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + ph);
      ctx.stroke();
      ctx.fillText(label, x, margin.top + ph + 4);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const [v, label] of ticks(yAxis, y0, y1)) {
      const y = Math.round(sy(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + pw, y);
      ctx.stroke();
      ctx.fillText(label, margin.left - 6, y);
    }
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    // The axes' titles: the horizontal one centred below the ticks, the vertical one
    // rotated a quarter turn along the left edge.
    // The short title of a component when the long one does not fit.
    const title = (axis, room) => (axis.short && (compact || ctx.measureText(axis.label).width > room) ? axis.short : axis.label);
    ctx.fillText(title(xAxis, pw), margin.left + pw / 2, h - 2);
    ctx.save();
    ctx.translate(12, margin.top + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText(title(yAxis, ph), 0, 0);
    ctx.restore();

    // What is drawn on the plot stays inside its frame when zoomed.
    ctx.save();
    ctx.beginPath();
    ctx.rect(margin.left, margin.top, pw, ph);
    ctx.clip();
    // The dots, the random patches first, the presets above them.
    screen = new Float32Array(2 * data.points.length);
    data.points.forEach((p, i) => {
      screen[2 * i] = sx(value(xAxis, p));
      screen[2 * i + 1] = sy(value(yAxis, p));
    });
    // The random patches, translucent so that dense regions read as darker.
    ctx.globalAlpha = 0.65;
    data.points.forEach((p, i) => {
      if (p.preset) return;
      ctx.fillStyle = colours[p.v[model]] || ink;
      ctx.beginPath();
      ctx.arc(screen[2 * i], screen[2 * i + 1], 2.6, 0, 2 * Math.PI);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    // The presets, larger discs outlined in the panel's colour, collected for their
    // names.
    const presets = [];
    data.points.forEach((p, i) => {
      if (!p.preset) return;
      const x = screen[2 * i];
      const y = screen[2 * i + 1];
      presets.push([p, x, y]);
      ctx.fillStyle = colours[p.v[model]] || ink;
      ctx.strokeStyle = css("--panel");
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    });
    // Each preset's name right, left, above or below its disc, the first place
    // inside the plot that overlaps no name already drawn; none if there is no
    // such place (hovering still names it).
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    const taken = [];
    for (const [p, x, y] of compact ? [] : presets) {
      const name = o.presetName(p.preset);
      const tw = ctx.measureText(name).width;
      const th = 12;
      const places = [[x + 8, y], [x - 8 - tw, y], [x - tw / 2, y - 12], [x - tw / 2, y + 12]];
      const at = places.find(([lx, ly]) => lx >= margin.left && lx + tw <= margin.left + pw
        && ly - th / 2 >= margin.top && ly + th / 2 <= margin.top + ph
        && !taken.some(([ax, ay, aw]) => lx < ax + aw && ax < lx + tw && Math.abs(ly - ay) < th));
      if (!at) continue;
      taken.push([at[0], at[1], tw]);
      ctx.strokeStyle = css("--panel");
      ctx.strokeText(name, at[0], at[1]);
      ctx.fillStyle = ink;
      ctx.fillText(name, at[0], at[1]);
    }
    // The sound asked for (a dashed ring), the current sound (a diamond), and the
    // gap between them.
    const at = (m) => [sx(value(xAxis, m)), sy(value(yAxis, m))];
    const accent = css("--accent");
    if (target && sound) {
      const [tx, ty] = at(target);
      const [cx, cy] = at(sound);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(cx, cy);
      ctx.stroke();
    }
    if (target) {
      const [tx, ty] = at(target);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.arc(tx, ty, 8, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (sound) {
      const [cx, cy] = at(sound);
      ctx.fillStyle = accent;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 7);
      ctx.lineTo(cx + 7, cy);
      ctx.lineTo(cx, cy + 7);
      ctx.lineTo(cx - 7, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // A ring around the hovered dot, and a larger, thicker one around the patch loaded.
    for (const [i, r] of [[hover, 7], [current, 9]]) {
      if (i < 0) continue;
      ctx.strokeStyle = ink;
      ctx.lineWidth = i === current ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(screen[2 * i], screen[2 * i + 1], r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Whether the canvas point (x, y), in CSS px, lies on the plot.
  const onPlot = (x, y) => frame && x >= frame.left && x <= frame.left + frame.pw && y >= frame.top && y <= frame.top + frame.ph;

  /**
   * The dot nearest the pointer within HIT px, or -1; only the dots inside the plot count
   * (a zoomed view leaves others outside).
   * @param {MouseEvent} e - a pointer or mouse event on the canvas
   * @returns {number} the index of the point in data.points, or -1
   */
  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = -1;
    let bestD = HIT * HIT;
    if (!onPlot(x, y)) return -1;
    for (let i = 0; i < data.points.length; i += 1) {
      if (!onPlot(screen[2 * i], screen[2 * i + 1])) continue;
      const dx = screen[2 * i] - x;
      const dy = screen[2 * i + 1] - y;
      // A preset wins over a random patch at the same distance.
      const d = dx * dx + dy * dy - (data.points[i].preset ? 9 : 0);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * A descriptor's value as the tooltip shows it, with its unit; an extrapolated decay is
   * marked approximate, and "at least 30 s" at the limit.
   * @param {string} a - the descriptor
   * @param {number} v - its value (Hz, dB, s, or a ratio for the harmonicity)
   * @param {boolean} extrapolated - the point's `c`
   * @returns {string}
   */
  const measure = (a, v, extrapolated) => {
    if (a === "decay" && extrapolated) return `≈ ${v >= 30 ? "≥ 30 s" : measure(a, v, false)}`;
    switch (a) {
      case "brightness": return `${Math.round(v)} Hz`;
      case "harmonicity": return v.toFixed(2);
      case "attack":
      case "decay": return v < 1 ? `${Math.round(1000 * v)} ms` : `${v.toFixed(2)} s`;
      default: return `${v.toFixed(1)} dB`;
    }
  };

  /**
   * Shows the tooltip of a point (its name, its model, its measures), right of its dot or
   * left of it when there is no room, kept within the stage vertically; hides it for -1.
   * @param {number} i - the index of the point, or -1
   */
  function showTip(i) {
    if (i < 0) {
      tip.hidden = true;
      return;
    }
    const p = data.points[i];
    tip.innerHTML = "";
    const title = document.createElement("strong");
    title.textContent = p.preset ? o.presetName(p.preset) : `${text.sound} ${i + 1}`;
    const sub = document.createElement("div");
    sub.className = "atlas-sub";
    sub.textContent = text.models[p.v[model]];
    const table = document.createElement("dl");
    data.axes.forEach((a, j) => {
      const dt = document.createElement("dt");
      dt.textContent = text.axes[a][0];
      const dd = document.createElement("dd");
      dd.textContent = measure(a, p.d[j], p.c);
      table.append(dt, dd);
    });
    tip.append(title, sub, table);
    tip.hidden = false;
    const x = screen[2 * i];
    const y = screen[2 * i + 1];
    const left = x + 14 + tip.offsetWidth > stage.clientWidth ? x - 14 - tip.offsetWidth : x + 14;
    const top = Math.min(Math.max(4, y - tip.offsetHeight / 2), stage.clientHeight - tip.offsetHeight - 4);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  // The pointers pressed on the canvas (two for a pinch), where they are, and
  // whether the press became a drag (then it is not a click).
  const pressed = new Map();
  let dragged = false;
  let pinch = 0; // the distance between two pressed pointers
  // A pointer's position on the canvas, CSS px.
  const local = (e) => {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  // A press: one pointer may start a drag (or be a click), a second one starts a pinch,
  // which is never a click. The canvas captures the pointer, so that a drag goes on
  // outside it.
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const [x, y] = local(e);
    pressed.set(e.pointerId, { x, y, x0: x, y0: y });
    if (pressed.size === 1) dragged = false;
    if (pressed.size === 2) {
      const [a, b] = [...pressed.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      dragged = true;
    }
    canvas.setPointerCapture(e.pointerId);
  });
  // A move: with two pointers, zoom about their middle by the ratio of their distances;
  // with one, once it has moved DRAG px, pan the view; with none pressed, hover (the
  // cursor shows what a click or a drag would do).
  canvas.addEventListener("pointermove", (e) => {
    const press = pressed.get(e.pointerId);
    if (press && frame) {
      const [x, y] = local(e);
      if (pressed.size === 2) {
        press.x = x;
        press.y = y;
        const [a, b] = [...pressed.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch / d, true, true);
        pinch = d;
        return;
      }
      if (!dragged && Math.hypot(x - press.x0, y - press.y0) < DRAG) return;
      if (!dragged) {
        dragged = true;
        hover = -1;
        showTip(-1);
      }
      canvas.style.cursor = view.x || view.y ? "grabbing" : "default";
      const [dx, dy] = [x - press.x, y - press.y];
      press.x = x;
      press.y = y;
      panBy(dx, dy);
      return;
    }
    const i = pick(e);
    if (i === hover) return;
    hover = i;
    canvas.style.cursor = i >= 0 ? "pointer" : view.x || view.y ? "grab" : "default";
    draw();
    showTip(i);
  });
  // A pointer lifted or lost ends the pinch; `dragged` stays set until the next press so
  // that the click that follows a drag is ignored.
  const release = (e) => {
    pressed.delete(e.pointerId);
    if (pressed.size < 2) pinch = 0;
    canvas.style.cursor = "default";
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  // Leaving the canvas clears the hover, unless a drag goes on.
  canvas.addEventListener("pointerleave", () => {
    if (pressed.size) return;
    hover = -1;
    draw();
    showTip(-1);
  });
  // A click on a dot (not the end of a drag) marks it as loaded and hands it to the page.
  canvas.addEventListener("click", (e) => {
    if (dragged) return;
    const i = pick(e);
    if (i < 0) return;
    current = i;
    draw();
    o.onPick(i, playBox.checked);
  });
  // A double click on the background shows the whole atlas again.
  canvas.addEventListener("dblclick", (e) => {
    if (pick(e) < 0) resetView();
  });
  // The wheel, and a trackpad's pinch (a wheel event with ctrlKey), zoom about
  // the pointer: both axes on the plot, one over its ticks.
  canvas.addEventListener("wheel", (e) => {
    if (!frame) return;
    const [x, y] = local(e);
    e.preventDefault();
    const overXTicks = y > frame.top + frame.ph;
    const overYTicks = x < frame.left;
    // The delta in pixels (a line counted as 16 px, a page as 400), then an exponential
    // factor: a trackpad's pinch reports small deltas, hence its larger coefficient. The
    // point is kept inside the plot when the pointer is over the ticks.
    const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const factor = Math.exp(e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.002));
    const px = Math.min(Math.max(x, frame.left), frame.left + frame.pw);
    const py = Math.min(Math.max(y, frame.top), frame.top + frame.ph);
    zoomAt(px, py, factor, !overYTicks || overXTicks, !overXTicks || overYTicks);
    hover = -1;
    showTip(-1);
  }, { passive: false });

  // Drawn again when its box changes size and when the colours change.
  let lastSize = "";
  new ResizeObserver(() => {
    const size = `${stage.clientWidth}x${stage.clientHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    draw();
  }).observe(stage);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);

  draw();
  return {
    // `resize` draws again (when the tab is shown); the setters change what is marked and
    // draw again.
    resize: draw,
    setCurrent: (i) => {
      current = i;
      draw();
    },
    setSound: (m) => {
      sound = m;
      draw();
    },
    setTarget: (m) => {
      target = m;
      draw();
    },
  };
}
