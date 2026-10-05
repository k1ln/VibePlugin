// =====================================================================
//  KHEVEREST data tables, shared by build.mjs (DSP), the GUI and the tests.
//
//  WAVETABLES: the Peak ships 60 wavetables (banks of five waveforms, swept by
//  SHAPE AMOUNT). Only their NAMES are taken from the manual; the contents here
//  are original recipes — 60 families × 5 columns, each a 64-harmonic spectrum
//  (formant vowels, drawbars, FM, sync sweeps, combs, random clusters …). Spectra
//  are stored as sqrt-companded magnitudes (phases are all sine, so neighbouring
//  columns always morph smoothly) and the DSP builds the band-limited mip-mapped
//  tables lazily on first use.
// =====================================================================

export const H = 64;                       // harmonics per wave
const hs = Array.from({ length: H }, (_, i) => i + 1);
const g = (x, mu, sg) => Math.exp(-((x - mu) * (x - mu)) / (2 * sg * sg));
const odd = (h) => h % 2 === 1;
function rng(seed) { let s = (seed * 2654435761 + 12345) >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// time-domain recipe → harmonic magnitudes via DFT
function td(fn) {
  const N = 1024, mags = [];
  const y = Array.from({ length: N }, (_, i) => fn(i / N));
  for (const h of hs) {
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) { const a = 2 * Math.PI * h * i / N; re += y[i] * Math.cos(a); im += y[i] * Math.sin(a); }
    mags.push(Math.hypot(re, im) / N * 2);
  }
  return mags;
}
const S = (ph) => Math.sin(2 * Math.PI * ph);
const frac = (x) => x - Math.floor(x);

// vowel formants (Hz) — F1, F2, F3
const V = {
  oo: [300, 870, 2240], oh: [450, 800, 2830], ah: [730, 1090, 2440], eh: [530, 1840, 2480], ee: [270, 2290, 3010],
  ae: [660, 1720, 2410], ih: [390, 1990, 2550], uh: [640, 1190, 2390],
  fa: [850, 1220, 2810], fe: [610, 2330, 2990], fi: [310, 2790, 3310], fo: [590, 920, 2710], fu: [370, 950, 2670],
};
function vowelSpec(seq, f0, bw = 1, tilt = 1) {
  return (c) => {
    const t = c / 4 * (seq.length - 1), i = Math.min(seq.length - 2, Math.floor(t)), fr = t - i;
    const A = V[seq[i]], B = V[seq[i + 1]];
    const F = A.map((a, k) => a + (B[k] - a) * fr);
    return hs.map((h) => {
      const f = h * f0;
      return Math.pow(h, -tilt) * (1.0 * g(f, F[0], 90 * bw + 0.1 * F[0]) + 0.7 * g(f, F[1], 140 * bw + 0.07 * F[1]) + 0.35 * g(f, F[2], 220 * bw)) + 0.012 / h;
    });
  };
}
const mask = (set, w = 1) => (h) => (set.includes(h) ? w : 0);

// ---- the 60 recipes: each returns 64 magnitudes for column c (0..4) ----------
const REC = {
  "BS sine": (c) => td((p) => S(p + (2.6 * c / 4) * S(p))),
  "Random": (c) => { const r = rng(10 + c); return hs.map((h) => Math.pow(r(), 2) / Math.pow(h, 0.6)); },
  "Zing": (c) => hs.map((h) => Math.pow(h, -0.35) * (0.15 + 0.85 * (0.5 + 0.5 * Math.cos(2 * Math.PI * h / (3 + 1.5 * c))))),
  "Tubey": (c) => hs.map((h) => (odd(h) ? 1 / h : (c / 4) * 0.8 / h) + 0.01 / h),
  "Octaves": (c) => hs.map((h) => { const k = Math.log2(h); return Number.isInteger(k) && k <= 1 + c * 1.25 ? Math.pow(0.75, k) : 0.004; }),
  "Wobbler": (c) => { const h0 = 2 + 2 * c; return hs.map((h) => Math.pow(h, -1.5) + (h === h0 || h === h0 + 1 ? 0.9 : 0)); },
  "Chords": (c) => { const sets = [[2, 3, 4], [4, 5, 6], [5, 6, 8], [6, 8, 10], [8, 10, 12]][c]; return hs.map((h) => { let a = 0.01; for (const s of sets) for (let m = 1; m <= 4; m++) if (h === s * m) a = Math.max(a, 1 / m); return a; }); },
  "Didgery": (c) => hs.map((h) => Math.pow(h, -0.5) * (1 + 6 * g(h, [2, 4, 7, 11, 16][c], 1.2))),
  "Harsh": (c) => { const r = 1 + 2.5 * c / 4; return td((p) => 2 * frac(r * p) - 1); },
  "Organ": (c) => { const W = [{ 1: 1, 2: 0.6 }, { 1: 1, 2: 0.7, 3: 0.5 }, { 1: 1, 2: 0.8, 3: 0.6, 4: 0.5, 6: 0.3 }, { 1: 1, 2: 0.8, 3: 0.7, 4: 0.6, 6: 0.5, 8: 0.4 }, { 1: 1, 2: 0.9, 3: 0.9, 4: 0.8, 5: 0.6, 6: 0.7, 8: 0.6, 10: 0.5 }][c]; return hs.map((h) => W[h] || 0.003); },
  "E.Piano": (c) => { const t = c / 4; return hs.map((h) => (h === 1 ? 1 : h === 2 ? 0.45 * (1 - t) + 0.2 : 0) + Math.pow(h, -1.7) + (h === 14 ? 0.15 + 0.6 * t : 0) + (h === 7 ? 0.3 * t : 0)); },
  "VoxOooEe": vowelSpec(["oo", "oh", "ah", "eh", "ee"], 130),
  "VoxYahEe": vowelSpec(["ah", "ae", "eh", "ih", "ee"], 130, 0.9),
  "Winds": (c) => { const r = rng(40 + c); return hs.map((h) => (odd(h) ? Math.pow(h, -1.2) : (c / 4) * 0.7 * Math.pow(h, -1.4)) + 0.025 * r() / Math.sqrt(h)); },
  "SoftClav": (c) => { const p = 0.08 + 0.06 * c; return hs.map((h) => Math.abs(Math.sin(Math.PI * h * p)) * Math.pow(h, -0.9) + 0.003); },
  "String": (c) => { const p = [1 / 12, 1 / 9, 1 / 7, 1 / 5, 1 / 4][c]; return hs.map((h) => (0.35 + Math.abs(Math.sin(Math.PI * h * p))) / h); },
  "BassOrgn": (c) => { const t = c / 4; return hs.map((h) => (h === 1 ? 1 : h === 2 ? 0.7 : h === 3 ? 0.2 + 0.6 * t : h === 4 || h === 6 ? 0.45 * t : 0) + Math.pow(h, -2) * 0.4 + 0.002); },
  "Acid": (c) => hs.map((h) => (1 / h) * (1 + 5 * g(h, 3 + 4 * c, 1.5))),
  "Buzzy": (c) => { const d = 0.5 - 0.11 * c; return hs.map((h) => Math.abs(Math.sin(Math.PI * h * d)) / h + 0.002); },
  "Carousel": (c) => { const m = 4 + c; return hs.map((h) => (h % m === 1 ? Math.pow(h, -0.7) : 0.05 / h)); },
  "Choral": vowelSpec(["oo", "oh", "ah", "eh", "ee"], 220, 1.6, 0.9),
  "Climbing": (c) => { const ctr = Math.pow(2, c + 1); return hs.map((h) => Math.pow(h, -0.6) * (0.6 + 4 * g(h, ctr, ctr * 0.12 + 0.5)) * (h === 1 ? 1 : 0.7)); },
  "CoinFlip": (c) => hs.map((h) => (((c % 2 === 0) === odd(h)) ? 1 : (c === 4 ? 0.8 : 0.12)) / Math.pow(h, 0.8)),
  "Deep": (c) => { const t = c / 4; return hs.map((h) => (h === 1 ? 1 : h === 2 ? 0.5 + 0.4 * t : Math.pow(h, -2 + 1.2 * t) * 0.6)); },
  "Dub": (c) => { const k = 0.8 + 2.5 * c / 4; return td((p) => S(k * S(p))); },
  "Eee": (c) => { const F2 = 2000 + 225 * c; return hs.map((h) => { const f = h * 110; return (1 / h) * (g(f, 270, 60) + 0.8 * g(f, F2, 220) + 0.4 * g(f, 3010, 260)) + 0.006 / h; }); },
  "Eris": (c) => { const I = 0.4 + 3.1 * c / 4; return td((p) => S(p + I * S(5 * p))); },
  "Flame": (c) => { const r = rng(70 + c), t = c / 4; return hs.map((h) => Math.pow(h, -0.8) * (1 + 2.2 * t * r()) + t * 0.5 * g(h, 33, 9)); },
  "Further": (c) => { const t = c / 4; return hs.map((h) => Math.pow(h, -0.5) * (h % 8 === 0 ? 1 + 5 * t : 0.35)); },
  "GlassSaw": (c) => { const m = 2 + c; return hs.map((h) => (1 / h) * (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(2 * Math.PI * h / m))) * (1 + 2 * g(h, 8, 2))); },
  "Glassy": (c) => { const sets = [[1, 2, 3, 5, 8], [1, 3, 6, 10, 15], [1, 4, 7, 12, 18], [1, 5, 9, 14, 22], [1, 6, 11, 17, 25]][c]; return hs.map((h) => (sets.includes(h) ? Math.pow(h, -0.2) : 0.01)); },
  "Granular": (c) => { const r = rng(90 + c); return hs.map((h) => (r() < 0.45 ? 1 : 0.02) * Math.pow(h, -0.45)); },
  "Grime": (c) => { const k = 3 + 12 * c / 4; return td((p) => Math.tanh(k * (2 * frac(p) - 1) * 0.8)); },
  "Drow": (c) => hs.map((h) => (1 / h) * (1 + 3 * g(h, 2 + c, 0.9) + 2 * g(h, 3 + c, 0.9)) + 0.003),
  "Heavy": (c) => hs.map((h) => Math.pow(h, -0.7) * (1 + 4 * Math.exp(-((h - 2) ** 2) / 4)) * (odd(h) ? 1 : 0.6 + 0.1 * c)),
  "Hedge": (c) => { const d = [0.5, 0.35, 0.22, 0.12, 0.06][c]; return hs.map((h) => (Math.abs(Math.sin(Math.PI * h * d)) / h) / (1 + (h / 20) ** 2) + 0.002); },
  "Hungry": (c) => hs.map((h) => Math.pow(h, -0.7) * (0.3 + 3 * g(h, 2 + 0.7 * c, 1) + 2 * g(h, 6 + 2 * c, 1.5))),
  "Ladders": (c) => { const s = 0.6 + 0.4 * c / 2; return hs.map((h) => Math.pow(2, -Math.floor(Math.log2(h)) * s)); },
  "Lead": (c) => hs.map((h) => (1 / h) * (1 + (0.8 + 0.5 * c) * g(h, 6 + 2 * c, 2))),
  "Modeling": (c) => { const p = [0.5, 0.33, 0.25, 0.2, 0.14][c]; return hs.map((h) => (Math.abs(Math.sin(Math.PI * h * p)) + 0.03) / (h * h)); },
  "Modem": (c) => { const I = 0.3 + 4.7 * c / 4; return td((p) => S(p + I * S(9 * p))); },
  "Monster": (c) => hs.map((h) => Math.pow(h, -0.6) * (0.7 + 0.3 * Math.cos(2 * Math.PI * h / 3.7)) * (1 + 2 * g(h, 4 + c, 2))),
  "Screech": (c) => hs.map((h) => g(h, 14 + 6 * c, 8) + 0.2 / h),
  "SeaBase": (c) => { const r = rng(110 + c); return hs.map((h) => (h === 1 ? 1 : Math.pow(h, -1.6)) + 0.02 * r()); },
  "Shmorgan": (c) => { const r = rng(130 + c * 7); const pk = [0, 1, 2].map(() => [2 + r() * 38, 1 + r() * 3, 0.4 + r()]); return hs.map((h) => 0.02 + pk.reduce((a, [m, s, w]) => a + w * g(h, m, s), 0)); },
  "Spirals": (c) => { const I = 0.5 + 3 * c / 4; return td((p) => S(p + I * S(2 * p + 0.7 * I * S(3 * p)))); },
  "Steel": (c) => { const t = c / 4, set = { 1: 1, 3: 0.8, 5: 0.6, 9: 0.5, 13: 0.4, 19: 0.3, 27: 0.25 }; return hs.map((h) => (set[h] ? set[h] * (h > 3 ? 0.4 + 0.6 * t : 1) : 0.01)); },
  "Sunrise": (c) => hs.map((h) => Math.pow(h, -(3 - 2.5 * c / 4))),
  "Swell": (c) => { const t = c / 4, e = 2 - Math.min(t * 2, 1), ev = Math.max(0, (t - 0.5) * 2); return hs.map((h) => (odd(h) ? Math.pow(h, -e) : ev / h) + 0.002); },
  "Thicker": (c) => hs.map((h) => (1 / h) * (1 + 0.6 * Math.cos(2 * Math.PI * h * 0.03 * c)) * (h === 1 ? 1.5 : 1)),
  "Thinner": (c) => hs.map((h) => Math.pow(h, -0.8) * (h === 1 ? 0.15 : h === 2 ? 0.3 : 1) * g(h, 8 + 6 * c, 12)),
  "Tides": (c) => hs.map((h) => (1 / h) * (1 + 0.9 * Math.cos(2 * Math.PI * h / (4 + 3 * c)))),
  "Tokyo": (c) => { const I = 0.5 + 3 * c / 4; return td((p) => S(p + I * S(4 * p) * 0.8 + 0.3 * I * S(3 * p))); },
  "Tops": (c) => hs.map((h) => g(h, 18 + 4 * c, 6) + (h === 1 ? 0.15 : 0.01)),
  "V.Chord": (c) => { const v = vowelSpec(["ah", "eh", "ee", "oh", "oo"], 130)(c); const m = mask([4, 5, 6, 8, 10, 12, 16, 20, 24, 32], 1); return hs.map((h, i) => v[i] * (0.15 + 0.85 * m(h))); },
  "Variance": (c) => { const r = rng(150 + c * 13), tilt = 0.3 + r() * 1.2; return hs.map((h) => Math.pow(r(), 3) / Math.pow(h, tilt) + 0.003); },
  "Vocaloid": vowelSpec(["fa", "fe", "fi", "fo", "fu"], 260, 1.1),
  "Vowelled": vowelSpec(["ee", "eh", "ah", "oh", "oo"], 110),
  "WeirdVox": (c) => hs.map((h) => { const f = h * 150, t = c / 4; return (1 / h) * (g(f, 1100 - 400 * t, 120) + 0.9 * g(f, 700 + 300 * t, 150) + 0.5 * g(f, 3300, 300)) * (0.6 + 0.4 * Math.cos(h * 0.7 * (1 + t))) + 0.004 / h; }),
  "Yeah": vowelSpec(["ee", "ih", "eh", "ae", "ah"], 130, 0.85),
};

// ---- unified bank: every table = 8 columns × 64 harmonics × (sine, cosine) int8, sqrt-companded.
//  The 60 Peak-named recipes (5 columns each, sine phase) are resampled to 8 columns; imported
//  third-party tables (wt-extra.json) are already in this format.
import { PEAK_WAVETABLES, WT_EXTRA } from "./params.mjs";
export const WT_COLS = 8;
export function buildBank() {
  const per = WT_COLS * H * 2;
  const out = new Int8Array((PEAK_WAVETABLES.length + WT_EXTRA.length) * per);
  PEAK_WAVETABLES.forEach((name, w) => {
    const fn = REC[name];
    if (!fn) throw new Error("no recipe for wavetable " + name);
    const cols5 = [0, 1, 2, 3, 4].map((c) => { const a = fn(c).map((v) => Math.abs(v)); const m = Math.max(...a, 1e-9); return a.map((v) => v / m); });
    for (let c = 0; c < WT_COLS; c++) {
      const t = c * 4 / (WT_COLS - 1), i = Math.min(3, Math.floor(t)), f = t - i;
      const a = cols5[i].map((v, h) => v * (1 - f) + cols5[i + 1][h] * f);
      const m = Math.max(...a, 1e-9);
      a.forEach((v, h) => { out[w * per + (c * H + h) * 2] = Math.round(127 * Math.sqrt(v / m)); });
    }
  });
  WT_EXTRA.forEach((t, k) => {
    const bytes = Buffer.from(t.b64, "base64");
    if (bytes.length !== per) throw new Error(`table ${t.name}: ${bytes.length} bytes, want ${per}`);
    for (let i = 0; i < per; i++) out[(PEAK_WAVETABLES.length + k) * per + i] = bytes.readInt8(i);
  });
  return out;
}
export const WT_COUNT = PEAK_WAVETABLES.length + WT_EXTRA.length;
export const WT_B64 = Buffer.from(buildBank().buffer).toString("base64");

// ---- tuning tables: 12 pitch-class offsets (cents from equal temperament), C..B ----
export const TUNINGS = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 11.7, 3.9, 15.6, -13.7, -2.0, -9.8, 2.0, 13.7, -15.6, 17.6, -11.7],
  [0, -9.8, 3.9, -5.9, 7.8, -2.0, -11.7, 2.0, -7.8, 5.9, -3.9, 9.8],
  [0, -24.0, -6.8, 10.3, -13.7, 3.4, -20.5, -3.4, -27.4, -10.3, 6.8, -17.1],
  [0, -9.8, -7.8, -5.9, -9.8, -2.0, -11.7, -3.9, -7.8, -11.7, -3.9, -7.8],
  [0, -9.8, -6.8, -5.9, -13.7, -2.0, -7.8, -3.4, -7.8, -10.3, -3.9, -11.7],
  [0, -5.9, -3.9, -2.0, -7.8, 1.9, -7.8, -2.0, -3.9, -5.9, -2.0, -9.8],
  [0, -9.8, -3.9, -5.9, -7.8, -2.0, -11.7, -2.0, -7.8, -5.9, -3.9, -9.8],
  [0, 0, 0, 0, -50, 0, 0, 0, 0, 0, 0, -50],
  [0, 0, 0, -50, 0, 0, 0, 0, 0, 0, -50, 0],
  [0, -9.8, 3.9, -5.9, -13.7, -2.0, -9.8, 2.0, -7.8, -15.6, -3.9, -11.7],
  [0, -36.8, -10.5, -47.4, -21.1, 5.3, -31.6, -5.3, -42.1, -15.8, -52.6, -26.3],
  [0, 11.7, 3.9, -33.1, -13.7, -2.0, -17.5, 2.0, 13.7, -15.6, -31.2, -11.7],
  [0, 20, 70, 10, -30, 0, 40, -15, 25, 80, -20, 10],
  [0, 0, 40, 0, 0, -20, 0, 20, 0, 60, 0, 0],
  [0, 25, -25, 25, -25, 25, -25, 25, -25, 25, -25, 25],
  [0, -2, -4, -2, -5, 2, -4, -2, -2, -5, 0, -7],
];

// ---- arpeggiator rhythm patterns (manual p.30: 33 pre-defined sequences) ---
//  x note · X accented note · o short note · - rest · _ tie (holds the previous note)
export const ARP_PATTERNS = [
  "x", "x-", "xx-", "x-xx", "x-x-xx--", "xoxo", "x--x", "x-x", "xxx-", "x--x--x-",
  "X-x-x-x-", "xxxxxxx-", "x-xx-xx-", "ooxo", "x-ox-ox-", "XooX", "x-xxx-x-xxx-", "x___", "x_x_", "xx_-",
  "x-x_x-xx", "oooxooox", "x-o-x-o-", "X-xx-xX-", "xo-xo-xo-", "x-xx--xx", "xxo-xxo-", "X--x--x-", "ox-ox-ox", "xxxo-xxo",
  "X-oxoX-ox", "XxoxXxox", "X-xoxx-ox-xx",
];
