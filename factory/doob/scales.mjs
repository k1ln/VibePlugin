// =====================================================================
//  Scale tables for the reissue's SCALE option. All are semitone offsets from equal temperament
//  (12-tone scales are rooted on C) or absolute semitone positions above the root key (Partch).
// =====================================================================
const cents = (r) => 1200 * Math.log2(r);
const dev12 = (ratios) => ratios.map((r, i) => (cents(r) - 100 * i) / 100);
// Pythagorean, rooted on C
const PYTH = [1, 2187 / 2048, 9 / 8, 32 / 27, 81 / 64, 4 / 3, 729 / 512, 3 / 2, 6561 / 4096, 27 / 16, 16 / 9, 243 / 128];
// "Super-just" 12-note just intonation (best-effort reconstruction of the 17-/11-/13-/7-limit set)
const SUPERJUST = [1, 17 / 16, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 11 / 8, 3 / 2, 13 / 8, 5 / 3, 7 / 4, 15 / 8];
export const SCALE_DEV = [...dev12(PYTH), ...dev12(SUPERJUST)];
// Harry Partch's 43-tone scale (11-limit), one tone per key of the 44-key keyboard
const PARTCH_R = [1 / 1, 81 / 80, 33 / 32, 21 / 20, 16 / 15, 12 / 11, 11 / 10, 10 / 9, 9 / 8, 8 / 7, 7 / 6, 32 / 27, 6 / 5, 11 / 9, 5 / 4, 14 / 11, 9 / 7, 21 / 16, 4 / 3, 27 / 20, 11 / 8, 7 / 5, 10 / 7, 16 / 11, 40 / 27, 3 / 2, 32 / 21, 14 / 9, 11 / 7, 8 / 5, 18 / 11, 5 / 3, 27 / 16, 12 / 7, 7 / 4, 16 / 9, 9 / 5, 20 / 11, 11 / 6, 15 / 8, 40 / 21, 64 / 33, 160 / 81];
if (PARTCH_R.length !== 43) throw new Error("partch table must have 43 tones, has " + PARTCH_R.length);
export const PARTCH = PARTCH_R.map((r) => cents(r) / 100);
// vintage keyboard: 43 × 10 Ω 1 % resistors → a cumulative random walk, ±1 cent per step (deterministic)
let s = 0x2c1b3c6d; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
export const KEYERR = []; { let acc = 0; for (let i = 0; i < 44; i++) { if (i > 0) acc += (rnd() * 2 - 1) * 0.01; KEYERR.push(+acc.toFixed(5)); } }
