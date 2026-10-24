// QR codes (ISO/IEC 18004) for the links the page shows: byte mode, error
// correction level M (15 % of the codewords can be lost), versions 1 to 20,
// that is up to 666 bytes of UTF-8 (a static app's address carries its
// configuration), the mask chosen by the standard's penalty.
// Written for this page after the structure of Project Nayuki's QR Code
// generator (MIT); checked by decoding with the system's reader
// (scripts/check_qrcode.mjs).

// Level M per version: [EC codewords per block, blocks of group 1, data
// codewords per block of group 1, blocks of group 2, data codewords per block].
const BLOCKS_M = [
  null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
  [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42],
  [28, 7, 45, 3, 46], [28, 10, 46, 1, 47], [26, 9, 43, 4, 44], [26, 3, 44, 11, 45], [26, 3, 41, 13, 42],
];
const MAX_VERSION = 20;
// The format bits of level M (L 01, M 00, Q 11, H 10).
const FORMAT_M = 0;

/**
 * The modules of a version left for data once the function patterns are drawn
 * (finders, separators, timing, alignment patterns, format and version bits),
 * that is its capacity in bits, codewords and remainder bits included.
 * @param {number} v - version, 1 .. 40
 * @returns {number}
 */
function rawModules(v) {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const align = Math.floor(v / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}

// The table agrees with the geometry, version by version: the codewords of its
// blocks fill the symbol's data modules (a wrong row fails here, at load).
for (let v = 1; v <= MAX_VERSION; v += 1) {
  const [ec, b1, d1, b2, d2] = BLOCKS_M[v];
  if (b1 * (d1 + ec) + b2 * (d2 + ec) !== Math.floor(rawModules(v) / 8)) {
    throw new Error(`qrcode: the level M table disagrees with version ${v}`);
  }
}

/**
 * The row and column coordinates of the alignment patterns' centres: 6, then
 * evenly spaced (even steps) up to size - 7; the patterns are drawn at every
 * pair of them but the three over the finders.
 * @param {number} v - version
 * @returns {number[]}
 */
function alignment(v) {
  if (v === 1) return [];
  const count = Math.floor(v / 7) + 2;
  const step = Math.ceil((v * 4 + 4) / (count - 1) / 2) * 2;
  const out = [6];
  for (let pos = v * 4 + 10; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

/**
 * The product in GF(256) with the field polynomial x^8 + x^4 + x^3 + x^2 + 1
 * (0x11d), by shift and add (Russian peasant).
 * @param {number} x - a byte
 * @param {number} y - a byte
 * @returns {number} a byte
 */
function mul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/**
 * The Reed-Solomon generator polynomial of a degree, the product of (x - 2^i)
 * for i < degree, its coefficients from the highest power down, the leading 1
 * left out.
 * @param {number} degree - the error correction codewords per block
 * @returns {number[]}
 */
function divisor(degree) {
  const d = new Array(degree).fill(0);
  d[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      d[j] = mul(d[j], root);
      if (j + 1 < degree) d[j] ^= d[j + 1];
    }
    root = mul(root, 2);
  }
  return d;
}

/**
 * The error correction codewords of a block: the remainder of the data
 * polynomial (times x^degree) by the generator, by long division.
 * @param {number[]} data - the block's data codewords
 * @param {number[]} div - from divisor
 * @returns {number[]} div.length codewords
 */
function remainder(data, div) {
  const r = new Array(div.length).fill(0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < div.length; i += 1) r[i] ^= mul(div[i], factor);
  }
  return r;
}

/** @returns {boolean} bit i of x */
const bit = (x, i) => ((x >>> i) & 1) !== 0;

/**
 * The codewords of a symbol: the byte-mode segment (mode 0100, the count on 8
 * bits up to version 9, 16 from 10, the bytes), a terminator of up to four zero
 * bits, zeros to a byte boundary, the pad bytes 0xec 0x11 alternating up to the
 * capacity; then the data split into the version's blocks, each followed by
 * its error correction, and interleaved: the blocks' first data codewords,
 * their second..., then their error correction codewords likewise.
 * @param {number[]} bytes - the text's UTF-8
 * @param {number} v - version, large enough
 * @returns {number[]}
 */
function codewords(bytes, v) {
  const [ec, b1, d1, b2, d2] = BLOCKS_M[v];
  const capacity = b1 * d1 + b2 * d2;
  const bits = [];
  const push = (value, n) => {
    for (let i = n - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
  const div = divisor(ec);
  const blocks = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i += 1) {
    const n = i < b1 ? d1 : d2;
    const d = data.slice(k, k + n);
    k += n;
    blocks.push([d, remainder(d, div)]);
  }
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i += 1) for (const [d] of blocks) if (i < d.length) out.push(d[i]);
  for (let i = 0; i < ec; i += 1) for (const [, e] of blocks) out.push(e[i]);
  return out;
}

// The eight data masks of the standard, by column x and row y: a module where
// the condition holds is inverted.
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * The symbol of a version with one mask: the function patterns (timing, the
 * three finders with their separators, the alignment patterns, the format bits
 * twice, the dark module, the version bits twice from version 7), then the
 * codewords' bits in the zigzag of two-module columns from the bottom right,
 * upwards then downwards, skipping the timing column, then the mask over the
 * data modules only.
 * @param {number} v - version
 * @param {number[]} words - from codewords
 * @param {number} mask - 0 .. 7
 * @returns {boolean[][]} dark modules by row
 */
function symbol(v, words, mask) {
  const size = v * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => {
    dark[y][x] = d;
    fixed[y][x] = true;
  };
  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = alignment(v);
  al.forEach((ax, i) => al.forEach((ay, j) => {
    const corner = (i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0);
    if (corner) return;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  // Format bits: level and mask, BCH(15, 5), masked by 0x5412.
  const data = (FORMAT_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i += 1) set(8, i, bit(format, i));
  set(8, 7, bit(format, 6));
  set(8, 8, bit(format, 7));
  set(7, 8, bit(format, 8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(format, i));
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(format, i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(format, i));
  set(8, size - 8, true);
  // Version bits from version 7: BCH(18, 6).
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i += 1) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const bits = (v << 12) | r;
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(bits, i));
      set(b, a, bit(bits, i));
    }
  }
  // The codewords in the zigzag of two-module columns, then the mask.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fixed[y][x]) {
          dark[y][x] = i < words.length * 8 && bit(words[i >>> 3], 7 - (i & 7));
          i += 1;
        }
      }
    }
  }
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!fixed[y][x] && MASKS[mask](x, y)) dark[y][x] = !dark[y][x];
  return dark;
}

/**
 * The standard's penalty of a masked symbol, lower is easier to read: runs of
 * five or more modules of one colour in a row or column (3, plus 1 per module
 * beyond five), 2 by 2 blocks of one colour (3 each), patterns that look like a
 * finder (1:1:3:1:1 with four light modules on one side, 40 each), and the
 * share of dark modules away from half (10 per 5 %).
 * @param {boolean[][]} m
 * @returns {number}
 */
function penalty(m) {
  const size = m.length;
  let p = 0;
  const lines = [];
  for (let y = 0; y < size; y += 1) lines.push(m[y]);
  for (let x = 0; x < size; x += 1) lines.push(m.map((row) => row[x]));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i += 1) {
      if (i < size && line[i] === line[i - 1]) run += 1;
      else {
        if (run >= 5) p += run - 2;
        run = 1;
      }
    }
    const s = line.map((d) => (d ? 1 : 0)).join("");
    for (const pattern of ["10111010000", "00001011101"]) {
      for (let k = s.indexOf(pattern); k >= 0; k = s.indexOf(pattern, k + 1)) p += 40;
    }
  }
  let darkCount = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (m[y][x]) darkCount += 1;
      if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    }
  }
  p += 10 * Math.floor(Math.abs((darkCount * 100) / (size * size) - 50) / 5);
  return p;
}

/**
 * The modules of the QR code of a text.
 * @param {string} text
 * @returns {boolean[][]} dark modules by row, without the quiet zone
 */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1;
  for (; v <= MAX_VERSION; v += 1) {
    const [, b1, d1, b2, d2] = BLOCKS_M[v];
    if (4 + (v < 10 ? 8 : 16) + 8 * bytes.length <= 8 * (b1 * d1 + b2 * d2)) break;
  }
  if (v > MAX_VERSION) throw new Error(`qrcode: ${bytes.length} bytes is more than version ${MAX_VERSION} holds`);
  const words = codewords(bytes, v);
  let best = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    const m = symbol(v, words, mask);
    const p = penalty(m);
    if (p < bestPenalty) {
      best = m;
      bestPenalty = p;
    }
  }
  return best;
}

/**
 * The QR code of a text as an SVG document, black on white with its quiet zone
 * of four modules.
 * @param {string} text
 * @param {number} [size] - the width and height, px
 * @returns {string}
 */
export function qrSvg(text, size = 220) {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let path = "";
  m.forEach((row, y) => row.forEach((d, x) => {
    if (d) path += `M${x + 4},${y + 4}h1v1h-1z`;
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">`
    + `<rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
