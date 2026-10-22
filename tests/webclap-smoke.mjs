// webclap-smoke.mjs — instantiate an exported WebCLAP module.wasm in Node with a tiny CLAP
// host and exercise it: no imports, descriptor/params/ports, a few blocks of audio with notes
// and parameter events, finite output, a state round trip.
//
//   node tests/webclap-smoke.mjs <module.wasm> [--fx] [--params N]
//
// Get a module.wasm by extracting an exported .wclap.tar.gz.
import fs from "node:fs";
export function smoke(wasmPath, { synth, expectParams }) {
  const m = new WebAssembly.Module(fs.readFileSync(wasmPath));
  const imps = WebAssembly.Module.imports(m);
  if (imps.length) throw new Error("imports: " + JSON.stringify(imps));
  const e = new WebAssembly.Instance(m, {}).exports; const T = e.__indirect_function_table;
  const dv = () => new DataView(e.memory.buffer); const u32 = p => dv().getUint32(p, true);
  const fn = p => T.get(u32(p));
  const VAL = { i32: 0x7f, i64: 0x7e };
  const tramp = (params, results, f) => {
    const name = s => [s.length, ...[...s].map(c => c.charCodeAt(0))];
    const section = (id, bytes) => [id, bytes.length, ...bytes];
    const type = [1, 0x60, params.length, ...params.map(t => VAL[t]), results.length, ...results.map(t => VAL[t])];
    const bytes = new Uint8Array([0,0x61,0x73,0x6d,1,0,0,0, ...section(1,type), ...section(2,[1,...name("e"),...name("f"),0,0]), ...section(7,[1,...name("f"),0,0])]);
    return new WebAssembly.Instance(new WebAssembly.Module(bytes), { e: { f } }).exports.f;
  };
  const install = (ptr, params, results, f) => { const i = T.grow(1); T.set(i, tramp(params, results, f)); dv().setUint32(ptr, i, true); };
  const str = s => { const p = e.malloc(s.length + 1); new Uint8Array(e.memory.buffer, p, s.length + 1).set([...s, "\0"].map(c => c.charCodeAt(0))); return p; };
  const cstr = p => { let s = ""; const b = new Uint8Array(e.memory.buffer); while (b[p]) s += String.fromCharCode(b[p++]); return s; };
  const entry = e.clap_entry.value;
  if (!fn(entry + 12)(str("/"))) throw new Error("entry.init");
  const factory = fn(entry + 20)(str("clap.plugin-factory"));
  const desc = fn(factory + 4)(factory, 0);
  const id = cstr(u32(desc + 12));
  const host = e.malloc(48); new Uint8Array(e.memory.buffer, host, 48).fill(0);
  install(host + 32, ["i32", "i32"], ["i32"], () => 0);
  install(host + 44, ["i32"], [], () => {});
  const plugin = fn(factory + 8)(factory, host, str(id));
  if (!plugin || !fn(plugin + 8)(plugin)) throw new Error("create/init");
  if (!fn(plugin + 16)(plugin, 48000, 1, 512)) throw new Error("activate");
  const ext = n => fn(plugin + 40)(plugin, str(n));
  const params = ext("clap.params"), state = ext("clap.state"), audio = ext("clap.audio-ports"), notes = ext("clap.note-ports");
  const n = fn(params)(plugin);
  if (expectParams != null && n !== expectParams) throw new Error(`params ${n} != ${expectParams}`);
  const info = e.malloc(1320), vp = e.malloc(8);
  const ids = [];
  for (let i = 0; i < n; i++) {
    if (!fn(params + 4)(plugin, i, info)) throw new Error("get_info " + i);
    const pid = u32(info), lo = dv().getFloat64(info + 1296, true), hi = dv().getFloat64(info + 1304, true);
    fn(params + 8)(plugin, pid, vp); const v = dv().getFloat64(vp, true);
    if (!(v >= lo - 1e-9 && v <= hi + 1e-9)) throw new Error(`param ${pid} value ${v} outside ${lo}..${hi}`);
    ids.push({ pid, lo, hi });
  }
  if (synth !== !!notes) throw new Error("note-ports mismatch");
  const F = 512, EV = 48, evs = e.malloc(EV * 4);
  const setEv = (i, type, time, f) => { const p = evs + EV * i; new Uint8Array(e.memory.buffer, p, EV).fill(0); const v = dv(); v.setUint32(p, EV, true); v.setUint32(p + 4, time, true); v.setUint16(p + 10, type, true); f(p, v); };
  let evCount = 0;
  const inEv = e.malloc(12); install(inEv + 4, ["i32"], ["i32"], () => evCount); install(inEv + 8, ["i32", "i32"], ["i32"], (_l, i) => evs + EV * i);
  const outEv = e.malloc(8); install(outEv + 4, ["i32", "i32"], ["i32"], () => 1);
  const mkBuf = () => { const b = e.malloc(24), d = e.malloc(8), c0 = e.malloc(F * 4), c1 = e.malloc(F * 4); dv().setUint32(d, c0, true); dv().setUint32(d + 4, c1, true); dv().setUint32(b, d, true); dv().setUint32(b + 8, 2, true); return { b, c0, c1 }; };
  const bin = mkBuf(), bout = mkBuf();
  const proc = e.malloc(40); new Uint8Array(e.memory.buffer, proc, 40).fill(0);
  dv().setUint32(proc + 8, F, true); dv().setUint32(proc + 16, bin.b, true); dv().setUint32(proc + 20, bout.b, true);
  dv().setUint32(proc + 24, synth ? 0 : 1, true); dv().setUint32(proc + 28, 1, true); dv().setUint32(proc + 32, inEv, true); dv().setUint32(proc + 36, outEv, true);
  let peak = 0, bad = 0;
  for (let blk = 0; blk < 24; blk++) {
    evCount = 0;
    if (synth && blk === 0) { setEv(0, 0, 0, (p, v) => { v.setInt16(p + 24, 57, true); v.setFloat64(p + 32, 0.9, true); }); setEv(1, 0, 40, (p, v) => { v.setInt16(p + 24, 64, true); v.setFloat64(p + 32, 0.9, true); }); evCount = 2; }
    if (synth && blk === 12) { setEv(0, 1, 5, (p, v) => { v.setInt16(p + 24, 57, true); }); evCount = 1; }
    if (blk === 6 && ids.length) { setEv(0, 5, 100, (p, v) => { v.setUint32(p + 16, ids[0].pid, true); v.setFloat64(p + 40, ids[0].lo + (ids[0].hi - ids[0].lo) * 0.5, true); }); evCount = 1; }
    if (!synth) for (let i = 0; i < F; i++) { const x = 0.5 * Math.sin((blk * F + i) * 2 * Math.PI * 220 / 48000); dv().setFloat32(bin.c0 + i * 4, x, true); dv().setFloat32(bin.c1 + i * 4, x, true); }
    fn(plugin + 36)(plugin, proc);
    for (let i = 0; i < F; i++) for (const c of [bout.c0, bout.c1]) { const y = dv().getFloat32(c + i * 4, true); if (!Number.isFinite(y)) bad++; peak = Math.max(peak, Math.abs(y)); }
  }
  if (bad) throw new Error(bad + " non-finite samples");
  // state round trip
  let saved = null;
  const os = e.malloc(8); install(os + 4, ["i32", "i32", "i64"], ["i64"], (_s, p, k) => { saved = new Uint8Array(e.memory.buffer.slice(p, p + Number(k))); return k; });
  if (!fn(state)(plugin, os)) throw new Error("state save");
  const is = e.malloc(8); let cur = 0; install(is + 4, ["i32", "i32", "i64"], ["i64"], (_s, p, k) => { const c = Math.min(Number(k), saved.length - cur); new Uint8Array(e.memory.buffer).set(saved.subarray(cur, cur + c), p); cur += c; return BigInt(c); });
  if (!fn(state + 4)(plugin, is)) throw new Error("state load");
  return { id, params: n, peak, stateBytes: saved.length };
}

if (process.argv[1] && process.argv[1].endsWith("webclap-smoke.mjs")) {
  const [, , wasm, ...rest] = process.argv;
  if (!wasm) { console.error("usage: node tests/webclap-smoke.mjs <module.wasm> [--fx] [--params N]"); process.exit(2); }
  const pi = rest.indexOf("--params");
  try {
    const r = smoke(wasm, { synth: !rest.includes("--fx"), expectParams: pi >= 0 ? +rest[pi + 1] : null });
    console.log(`ok  ${r.id}  params ${r.params}  peak ${r.peak.toFixed(3)}  state ${r.stateBytes} bytes`);
  } catch (e) { console.error("FAIL " + e.message); process.exit(1); }
}
