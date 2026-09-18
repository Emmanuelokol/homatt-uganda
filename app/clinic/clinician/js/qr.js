/* A QR encoder, written out rather than fetched.
 *
 * The clinic shows this code to a clinician standing in front of them. That
 * happens in a room with no connection as often as not — it is the moment
 * somebody arrives to start work, which is exactly when nothing has been set
 * up yet. A QR library pulled from a CDN would work perfectly on the laptop it
 * was written on and show an empty box in Gulu.
 *
 * So: byte mode, versions 1–10, all four error-correction levels, no
 * dependencies, ~9 KB. Renders to a <canvas> or to an SVG string.
 *
 * Verified rather than trusted: tests/measure-qr.js compares the module matrix
 * this produces, bit for bit, against Python's `qrcode` reference library —
 * 10 versions × 4 levels × 8 masks. An encoder that is subtly wrong still
 * draws a convincing square, and nobody finds out until a phone will not read
 * it, in a clinic, with somebody waiting.
 */
(function (global) {
  'use strict';

  // ── GF(256), primitive polynomial 0x11D ───────────────────────────────
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  // The generator polynomial for `n` error-correction codewords.
  function rsPoly(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], 1);
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    var gen = rsPoly(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift(); res.push(0);
      if (factor !== 0) {
        for (var j = 0; j < gen.length - 1; j++) {
          res[j] ^= gmul(gen[j + 1], factor);
        }
      }
    }
    return res;
  }

  // ── Block structure ───────────────────────────────────────────────────
  // Per version (1-10), per level: [ecPerBlock, blocks1, data1, blocks2, data2]
  // Taken from ISO/IEC 18004 table 9. Every row is checked against the
  // reference library by tests/measure-qr.js — a wrong number here produces a
  // symbol that looks right and scans as rubbish.
  var EC = { L: 0, M: 1, Q: 2, H: 3 };
  var BLOCKS = {
    1:  [[7,1,19,0,0],   [10,1,16,0,0],  [13,1,13,0,0],  [17,1,9,0,0]],
    2:  [[10,1,34,0,0],  [16,1,28,0,0],  [22,1,22,0,0],  [28,1,16,0,0]],
    3:  [[15,1,55,0,0],  [26,1,44,0,0],  [18,2,17,0,0],  [22,2,13,0,0]],
    4:  [[20,1,80,0,0],  [18,2,32,0,0],  [26,2,24,0,0],  [16,4,9,0,0]],
    5:  [[26,1,108,0,0], [24,2,43,0,0],  [18,2,15,2,16], [22,2,11,2,12]],
    6:  [[18,2,68,0,0],  [16,4,27,0,0],  [24,4,19,0,0],  [28,4,15,0,0]],
    7:  [[20,2,78,0,0],  [18,4,31,0,0],  [18,2,14,4,15], [26,4,13,1,14]],
    8:  [[24,2,97,0,0],  [22,2,38,2,39], [22,4,18,2,19], [26,4,14,2,15]],
    9:  [[30,2,116,0,0], [22,3,36,2,37], [20,4,16,4,17], [24,4,12,4,13]],
    10: [[18,2,68,2,69], [26,4,43,1,44], [24,6,19,2,20], [28,6,15,2,16]],
  };

  var ALIGN = {
    1: [], 2: [6,18], 3: [6,22], 4: [6,26], 5: [6,30],
    6: [6,34], 7: [6,22,38], 8: [6,24,42], 9: [6,26,46], 10: [6,28,50],
  };

  function capacity(version, level) {
    var b = BLOCKS[version][EC[level]];
    return b[1] * b[2] + b[3] * b[4];
  }

  // ── Bit buffer ────────────────────────────────────────────────────────
  function Bits() { this.bytes = []; this.len = 0; }
  Bits.prototype.put = function (val, n) {
    for (var i = n - 1; i >= 0; i--) this.putBit(((val >>> i) & 1) === 1);
  };
  Bits.prototype.putBit = function (bit) {
    var i = this.len >>> 3;
    if (this.bytes.length <= i) this.bytes.push(0);
    if (bit) this.bytes[i] |= (0x80 >>> (this.len & 7));
    this.len++;
  };

  function utf8(str) {
    var out = [], s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  // ── The codeword stream ───────────────────────────────────────────────
  function makeCodewords(text, version, level) {
    var data = utf8(text);
    var bits = new Bits();
    bits.put(4, 4);                                  // byte mode
    bits.put(data.length, version < 10 ? 8 : 16);    // character count
    for (var i = 0; i < data.length; i++) bits.put(data[i], 8);

    var total = capacity(version, level) * 8;
    if (bits.len > total) return null;               // does not fit

    // Terminator, then pad to a byte, then the two alternating pad bytes.
    for (var t = 0; t < 4 && bits.len < total; t++) bits.putBit(false);
    while (bits.len % 8 !== 0) bits.putBit(false);
    var pads = [0xEC, 0x11], p = 0;
    while (bits.bytes.length < capacity(version, level)) {
      bits.bytes.push(pads[p++ % 2]);
    }

    // Split into blocks, error-correct each, then interleave.
    var spec = BLOCKS[version][EC[level]];
    var ecLen = spec[0];
    var dataBlocks = [], ecBlocks = [], offset = 0;
    var groups = [[spec[1], spec[2]], [spec[3], spec[4]]];
    for (var g = 0; g < 2; g++) {
      for (var b = 0; b < groups[g][0]; b++) {
        var blk = bits.bytes.slice(offset, offset + groups[g][1]);
        offset += groups[g][1];
        dataBlocks.push(blk);
        ecBlocks.push(rsEncode(blk, ecLen));
      }
    }

    var out = [], maxData = Math.max(spec[2], spec[4]);
    for (var c = 0; c < maxData; c++) {
      for (var d = 0; d < dataBlocks.length; d++) {
        if (c < dataBlocks[d].length) out.push(dataBlocks[d][c]);
      }
    }
    for (var e = 0; e < ecLen; e++) {
      for (var f = 0; f < ecBlocks.length; f++) out.push(ecBlocks[f][e]);
    }
    return out;
  }

  // ── The matrix ────────────────────────────────────────────────────────
  function newMatrix(size) {
    var m = [];
    for (var i = 0; i < size; i++) m.push(new Array(size).fill(null));
    return m;
  }

  function placeFunction(m, version) {
    var size = m.length;

    function finder(r, c) {
      for (var i = -1; i <= 7; i++) {
        for (var j = -1; j <= 7; j++) {
          var rr = r + i, cc = c + j;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          var on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                   (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                   (i >= 2 && i <= 4 && j >= 2 && j <= 4);
          m[rr][cc] = on ? 1 : 0;
        }
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // Timing patterns
    for (var i = 8; i < size - 8; i++) {
      var v = (i % 2 === 0) ? 1 : 0;
      if (m[6][i] === null) m[6][i] = v;
      if (m[i][6] === null) m[i][6] = v;
    }

    // Alignment patterns sit at every combination of the version's coordinates
    // EXCEPT the three corners already occupied by finders.
    //
    // Not "skip anything already occupied": the patterns at (6, x) and (x, 6)
    // cross the timing line and are still drawn, on top of it. Skipping those
    // gives exactly the right answer up to version 6 — where the only surviving
    // combination is the far corner anyway — and then silently drops six
    // patterns at version 7, which shifts every data module after them.
    var pos = ALIGN[version], last = pos.length - 1;
    for (var a = 0; a <= last; a++) {
      for (var b = 0; b <= last; b++) {
        if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
        var r = pos[a], c = pos[b];
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            var on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            m[r + dr][c + dc] = on ? 1 : 0;
          }
        }
      }
    }

    // The one module that is always dark
    m[size - 8][8] = 1;

    // Reserve the format areas so data never lands there
    for (var k = 0; k <= 8; k++) {
      if (m[8][k] === null) m[8][k] = 0;
      if (m[k][8] === null) m[k][8] = 0;
    }
    for (var n = 0; n < 8; n++) {
      if (m[8][size - 1 - n] === null) m[8][size - 1 - n] = 0;
      if (m[size - 1 - n][8] === null) m[size - 1 - n][8] = 0;
    }

    // Version information, versions 7 and up
    if (version >= 7) {
      var rem = version;
      for (var q = 0; q < 12; q++) {
        rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1F25);
      }
      var vbits = (version << 12) | rem;          // 18 bits
      for (var t = 0; t < 18; t++) {
        var bit = (vbits >>> t) & 1;              // least significant first
        var a = size - 11 + (t % 3), b = Math.floor(t / 3);
        m[a][b] = bit;
        m[b][a] = bit;
      }
    }
  }

  function placeData(m, codewords) {
    var size = m.length, idx = 0, bitIdx = 0, up = true;
    for (var right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;                 // skip the timing column
      for (var vert = 0; vert < size; vert++) {
        var row = up ? size - 1 - vert : vert;
        for (var k = 0; k < 2; k++) {
          var col = right - k;
          if (m[row][col] !== null) continue;
          var bit = 0;
          if (idx < codewords.length) {
            bit = (codewords[idx] >>> (7 - bitIdx)) & 1;
          }
          m[row][col] = bit;
          bitIdx++;
          if (bitIdx === 8) { bitIdx = 0; idx++; }
        }
      }
      up = !up;
    }
  }

  var MASKS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i)    { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return ((i * j) % 2) + ((i * j) % 3) === 0; },
    function (i, j) { return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0; },
    function (i, j) { return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0; },
  ];

  // Which modules may be masked: everything that is not a function pattern.
  function functionMap(version, size) {
    var f = newMatrix(size);
    placeFunction(f, version);
    var map = [];
    for (var i = 0; i < size; i++) {
      map.push([]);
      for (var j = 0; j < size; j++) map[i].push(f[i][j] !== null);
    }
    return map;
  }

  function applyMask(m, isFunction, maskId) {
    var size = m.length, out = [];
    for (var i = 0; i < size; i++) {
      out.push([]);
      for (var j = 0; j < size; j++) {
        var v = m[i][j];
        if (!isFunction[i][j] && MASKS[maskId](i, j)) v = v ^ 1;
        out[i].push(v);
      }
    }
    return out;
  }

  function placeFormat(m, level, maskId) {
    var size = m.length;
    var LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
    var fmt = (LEVEL_BITS[level] << 3) | maskId;
    var rem = fmt;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
    var bits = ((fmt << 10) | rem) ^ 0x5412;

    // The 15 bits are laid down MOST significant first. Getting this backwards
    // costs exactly 13 modules out of 441 — the data is untouched and the
    // symbol still looks completely normal, it simply will not decode.
    function bit(i) { return (bits >>> (14 - i)) & 1; }

    for (var k = 0; k <= 5; k++)       m[8][k] = bit(k);
    m[8][7] = bit(6);
    m[8][8] = bit(7);
    m[7][8] = bit(8);
    for (var n = 9; n <= 14; n++)      m[14 - n][8] = bit(n);

    // The second copy is 7 modules up the left column and 8 along the top row.
    // Not 8 and 7: the eighth module of the column is (size-8, 8), which is the
    // always-dark module, so a bit written there is a bit thrown away.
    for (var p = 0; p <= 6; p++)       m[size - 1 - p][8] = bit(p);
    m[size - 8][8] = 1;                // always dark — never a format bit
    for (var q = 7; q <= 14; q++)      m[8][size - 15 + q] = bit(q);
  }

  // ── Penalty scoring, so the least-confusing mask wins ─────────────────
  function penalty(m) {
    var size = m.length, score = 0, i, j, run, dark = 0;

    for (i = 0; i < size; i++) {
      run = 1;
      for (j = 1; j < size; j++) {
        if (m[i][j] === m[i][j - 1]) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (j = 0; j < size; j++) {
      run = 1;
      for (i = 1; i < size; i++) {
        if (m[i][j] === m[i - 1][j]) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    for (i = 0; i < size - 1; i++) {
      for (j = 0; j < size - 1; j++) {
        var s = m[i][j] + m[i][j + 1] + m[i + 1][j] + m[i + 1][j + 1];
        if (s === 0 || s === 4) score += 3;
      }
    }

    var PAT1 = [1,0,1,1,1,0,1,0,0,0,0], PAT2 = [0,0,0,0,1,0,1,1,1,0,1];
    function matches(get, at, pat) {
      for (var k = 0; k < pat.length; k++) if (get(at + k) !== pat[k]) return false;
      return true;
    }
    for (i = 0; i < size; i++) {
      for (j = 0; j <= size - 11; j++) {
        var rowGet = (function (r) { return function (c) { return m[r][c]; }; })(i);
        var colGet = (function (c) { return function (r) { return m[r][c]; }; })(i);
        if (matches(rowGet, j, PAT1) || matches(rowGet, j, PAT2)) score += 40;
        if (matches(colGet, j, PAT1) || matches(colGet, j, PAT2)) score += 40;
      }
    }

    for (i = 0; i < size; i++) for (j = 0; j < size; j++) dark += m[i][j];
    var pct = dark * 100 / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  // ── The public call ───────────────────────────────────────────────────
  // encode(text, {level, version}) → { size, modules: [[0|1]…] }
  function encode(text, opts) {
    opts = opts || {};
    var level = opts.level || 'M';
    if (!(level in EC)) level = 'M';

    var version = opts.version || 0;
    if (!version) {
      for (var v = 1; v <= 10; v++) {
        if (makeCodewords(text, v, level)) { version = v; break; }
      }
    }
    if (!version) throw new Error('too much text for a version-10 QR code');

    var codewords = makeCodewords(text, version, level);
    if (!codewords) throw new Error('too much text for version ' + version);

    var size = version * 4 + 17;
    var base = newMatrix(size);
    placeFunction(base, version);
    placeData(base, codewords);
    var isFn = functionMap(version, size);

    var best = null, bestScore = Infinity, bestMask = 0;
    for (var mask = 0; mask < 8; mask++) {
      var cand = applyMask(base, isFn, mask);
      placeFormat(cand, level, mask);
      var s = penalty(cand);
      if (s < bestScore) { bestScore = s; best = cand; bestMask = mask; }
    }
    return { size: size, version: version, level: level, mask: bestMask, modules: best };
  }

  // A QR code is unreadable without a quiet zone, and the specification asks
  // for four modules. On a phone screen held up to another phone's camera that
  // margin is the difference between scanning at once and not at all.
  function toSVG(text, opts) {
    opts = opts || {};
    var q = encode(text, opts);
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var total = q.size + quiet * 2;
    var dark = opts.dark || '#000000';
    var light = opts.light || '#FFFFFF';
    var path = '';
    for (var i = 0; i < q.size; i++) {
      for (var j = 0; j < q.size; j++) {
        if (q.modules[i][j]) path += 'M' + (j + quiet) + ' ' + (i + quiet) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
      '<path d="' + path + '" fill="' + dark + '"/></svg>';
  }

  function toCanvas(canvas, text, opts) {
    opts = opts || {};
    var q = encode(text, opts);
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var total = q.size + quiet * 2;
    var px = Math.max(1, Math.floor((opts.size || 260) / total));
    var side = px * total;
    canvas.width = side; canvas.height = side;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.light || '#FFFFFF';
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = opts.dark || '#000000';
    for (var i = 0; i < q.size; i++) {
      for (var j = 0; j < q.size; j++) {
        if (q.modules[i][j]) ctx.fillRect((j + quiet) * px, (i + quiet) * px, px, px);
      }
    }
    return q;
  }

  global.HomattQR = { encode: encode, toSVG: toSVG, toCanvas: toCanvas };
})(typeof window !== 'undefined' ? window : globalThis);
