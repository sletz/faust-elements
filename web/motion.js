// The phone's accelerometer driving controls: the mapping of an axis to a
// control, shared by the phone app (web/phone/phone.js) and the page's
// simulation (web/pwa.js).
//
// The semantics are those of Faust's `[acc: axis curve amin amid amax]`
// metadata (faustwasm's FaustSensors.ts, the architectures' ValueConverter.h),
// written again here: the axis value, in m/s² with gravity (about -9.8 .. 9.8
// for a phone tilted from one side to the other), is clipped to amin .. amax and
// mapped by two straight segments, amin .. amid and amid .. amax, onto
//   Up      min .. centre .. max
//   Down    max .. centre .. min
//   UpDown  min .. max .. min      (the centre unused)
//   DownUp  max .. min .. max      (the centre unused)
// where min, centre and max are values of the control.

export const AXES = ["x", "y", "z"];
export const CURVES = ["up", "down", "updown", "downup"];

// A straight segment from (x1, y1) to (x2, y2), x clipped to [x1, x2].
function segment(x, x1, x2, y1, y2) {
  if (x2 <= x1) return y1;
  const t = Math.min(1, Math.max(0, (x - x1) / (x2 - x1)));
  return y1 + t * (y2 - y1);
}

/**
 * The value of a control for an axis value.
 * @param {Object} m - a mapping: {curve, amin, amid, amax, min, centre, max}
 * @param {number} a - the axis value, m/s²
 * @returns {number}
 */
export function mapAxis(m, a) {
  const [lo, mid, hi] = {
    up: [m.min, m.centre, m.max],
    down: [m.max, m.centre, m.min],
    updown: [m.min, m.max, m.min],
    downup: [m.max, m.min, m.max],
  }[m.curve] ?? [m.min, m.centre, m.max];
  return a < m.amid ? segment(a, m.amin, m.amid, lo, mid) : segment(a, m.amid, m.amax, mid, hi);
}

/**
 * A mapping's values checked and completed: the axis and the curve known, the
 * sensor's points ordered, the control's points within its range.
 * @param {Object} m - {key, axis, curve, amin, amid, amax, min, centre, max}
 * @param {{min: number, max: number}} range - the control's range
 * @returns {Object} a mapping mapAxis can use
 */
export function normalize(m, range) {
  const clip = (v, d) => (Number.isFinite(Number(v)) ? Math.min(range.max, Math.max(range.min, Number(v))) : d);
  const [amin, amid, amax] = [Number(m.amin), Number(m.amid), Number(m.amax)]
    .map((v, i) => (Number.isFinite(v) ? v : [-10, 0, 10][i]))
    .sort((a, b) => a - b);
  return {
    key: m.key,
    axis: AXES.includes(m.axis) ? m.axis : "x",
    curve: CURVES.includes(m.curve) ? m.curve : "up",
    amin,
    amid,
    amax,
    min: clip(m.min, range.min),
    centre: clip(m.centre, (range.min + range.max) / 2),
    max: clip(m.max, range.max),
  };
}

/**
 * Follows the accelerometer and gives the controls' values: the axes smoothed
 * by a one-pole low-pass (the sensor is noisy and its rate varies), Android's
 * axes turned to iOS's (their signs are opposite, as faustwasm and the
 * architectures do).
 */
export class MotionMapper {
  /**
   * @param {Array<Object>} mappings - normalized mappings
   * @param {Object} [o]
   * @param {number} [o.smoothing] - the low-pass time constant, s
   * @param {boolean} [o.android] - invert the axes' signs
   */
  constructor(mappings, o = {}) {
    this.mappings = mappings;
    this.tau = o.smoothing ?? 0.08;
    this.sign = o.android ? -1 : 1;
    this.axes = { x: 0, y: 0, z: 0 };
    this.time = -1;
  }

  /**
   * One sample of the accelerometer.
   * @param {{x: number, y: number, z: number}} g - accelerationIncludingGravity
   * @param {number} t - its time, s
   */
  update(g, t) {
    const dt = this.time < 0 ? Infinity : Math.max(0, t - this.time);
    this.time = t;
    const k = 1 - Math.exp(-dt / this.tau);
    for (const a of AXES) {
      const v = this.sign * (Number(g[a]) || 0);
      this.axes[a] += k * (v - this.axes[a]);
    }
  }

  /** @returns {Array<[string, number]>} each mapped control and its value */
  values() {
    return this.mappings.map((m) => [m.key, mapAxis(m, this.axes[m.axis])]);
  }
}
