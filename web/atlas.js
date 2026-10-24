// The atlas: the sounds of web/atlas.json (scripts/gen_atlas.mjs), the presets
// and random patches, each played once offline and measured, laid out on a plane
// by what they sound like rather than by their controls. A dot is a patch; its
// colour is the resonator's model, the presets are labelled. Hovering shows the
// measures, a click hands the patch to the page.

// Measures read on a log scale, as in the principal components.
const LOG_AXES = new Set(["brightness", "attack", "decay"]);
const MARGIN = { left: 56, right: 14, top: 12, bottom: 40 };
const HIT = 10; // px, the reach of the pointer

/**
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
  const model = data.controls.indexOf("resonator/model");
  // The axes offered: the two components, then every measure.
  const choices = [
    ...data.components.map((c, i) => ({ id: `pc${i}`, label: pcLabel(i), short: `${text.pc} ${i + 1}`, get: (p) => p.pc[i], log: false })),
    ...data.axes.map((a, j) => ({
      id: a,
      label: text.axes[a][1] ? `${text.axes[a][0]} (${text.axes[a][1]})` : text.axes[a][0],
      get: (p) => p.d[j],
      log: LOG_AXES.has(a),
    })),
  ];
  let xAxis = choices[0];
  let yAxis = choices[1];
  let current = o.current ?? -1;
  let sound = null;
  let target = null;
  const compact = Boolean(o.compact);
  const margin = compact ? { left: 30, right: 8, top: 8, bottom: 26 } : MARGIN;
  let hover = -1;
  let screen = new Float32Array(0); // x, y of every dot, CSS px

  function pcLabel(i) {
    const c = data.components[i];
    const top = Object.entries(c.loadings).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
    const parts = top.map(([k, v]) => `${text.axes[k][0].toLowerCase()} ${v > 0 ? "+" : "−"}`);
    return `${text.pc} ${i + 1}, ${Math.round(100 * c.variance)} % (${parts.join(", ")})`;
  }

  container.innerHTML = "";
  const bar = document.createElement("div");
  bar.className = "atlas-bar";
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
  bar.append(
    select(text.xAxis, xAxis, (c) => (xAxis = c)),
    select(text.yAxis, yAxis, (c) => (yAxis = c)),
  );
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
  stage.append(canvas, tip);
  if (compact) container.append(stage);
  else container.append(bar, stage);
  stage.classList.toggle("compact", compact);
  const ctx = canvas.getContext("2d");

  const value = (axis, p) => {
    const v = axis.get(p);
    return axis.log ? Math.log10(Math.max(v, 1e-3)) : v;
  };
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

  // Round ticks between lo and hi: steps of 1, 2 or 5 times a power of ten,
  // and on a log axis the 1, 2, 5 of every decade.
  function ticks(axis, lo, hi) {
    const out = [];
    if (axis.log) {
      for (let e = Math.floor(lo); e <= Math.ceil(hi); e += 1) {
        for (const m of [1, 2, 5]) {
          const v = Math.log10(m) + e;
          if (v >= lo && v <= hi) out.push([v, format10(m * 10 ** e)]);
        }
      }
      return out;
    }
    const raw = (hi - lo) / 6;
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push([v, format10(Math.abs(v) < step / 2 ? 0 : v)]);
    return out;
  }
  const format10 = (v) => (Math.abs(v) >= 1000 ? `${v / 1000}k` : String(Number(v.toPrecision(3))));

  const css = (name) => getComputedStyle(container).getPropertyValue(name).trim();

  function draw() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const [x0, x1] = extent(xAxis);
    const [y0, y1] = extent(yAxis);
    const pw = w - margin.left - margin.right;
    const ph = h - margin.top - margin.bottom;
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
    // The short title of a component when the long one does not fit.
    const title = (axis, room) => (axis.short && (compact || ctx.measureText(axis.label).width > room) ? axis.short : axis.label);
    ctx.fillText(title(xAxis, pw), margin.left + pw / 2, h - 2);
    ctx.save();
    ctx.translate(12, margin.top + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = "middle";
    ctx.fillText(title(yAxis, ph), 0, 0);
    ctx.restore();

    // The dots, the random patches first, the presets above them.
    screen = new Float32Array(2 * data.points.length);
    data.points.forEach((p, i) => {
      screen[2 * i] = sx(value(xAxis, p));
      screen[2 * i + 1] = sy(value(yAxis, p));
    });
    ctx.globalAlpha = 0.65;
    data.points.forEach((p, i) => {
      if (p.preset) return;
      ctx.fillStyle = colours[p.v[model]] || ink;
      ctx.beginPath();
      ctx.arc(screen[2 * i], screen[2 * i + 1], 2.6, 0, 2 * Math.PI);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
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
    for (const [i, r] of [[hover, 7], [current, 9]]) {
      if (i < 0) continue;
      ctx.strokeStyle = ink;
      ctx.lineWidth = i === current ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(screen[2 * i], screen[2 * i + 1], r, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  // The dot nearest the pointer within HIT px, or -1.
  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = -1;
    let bestD = HIT * HIT;
    for (let i = 0; i < data.points.length; i += 1) {
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

  canvas.addEventListener("pointermove", (e) => {
    const i = pick(e);
    if (i === hover) return;
    hover = i;
    canvas.style.cursor = i >= 0 ? "pointer" : "default";
    draw();
    showTip(i);
  });
  canvas.addEventListener("pointerleave", () => {
    hover = -1;
    draw();
    showTip(-1);
  });
  canvas.addEventListener("click", (e) => {
    const i = pick(e);
    if (i < 0) return;
    current = i;
    draw();
    o.onPick(i, playBox.checked);
  });

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
