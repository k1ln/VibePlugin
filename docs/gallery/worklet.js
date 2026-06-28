// worklet.js — AudioWorkletProcessor that runs a VibePlugin WASM DSP module live.
//
// Implements the SAME ABI as the C++ host (see src/WasmAbi.h): planar f32
// buffers, init/process, the pointer getters, optional noteOn/noteOff, and the
// optional sample buffer. The module is self-contained (no imports). Audio is
// processed one 128-frame render quantum at a time.

const MAX_FRAMES   = 8192;   // ABI constant — per-channel stride in the buffers
const MAX_CHANNELS = 2;
const MAX_PARAMS   = 64;

const noteToHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

class VstaiProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.notes = [];                       // queued note events
    this.shadow = new Float32Array(MAX_PARAMS);  // GUI param values, mirrored each block
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  async onMessage(m) {
    if (m.type === "load") {
      // keep the bytes/config so we can re-instantiate if the DSP ever traps
      this.wasmBytes = m.wasm;
      this.sr = m.sampleRate;
      this.channels = Math.min(MAX_CHANNELS, m.channels || 2);
      try {
        await this.instantiate(true);
      } catch (err) {
        this.port.postMessage({ type: "error", message: String((err && err.message) || err) });
      }
      return;
    }

    if (m.type === "param") { if (m.i >= 0 && m.i < MAX_PARAMS) this.shadow[m.i] = +m.v; return; }
    if (m.type === "note")  { this.notes.push(m); return; }
    if (m.type === "sample") { this.loadSample(m); return; }
  }

  // (re)build the WASM instance from the stored bytes. `seed` mirrors the
  // module's default params into the shadow (only on the very first load).
  async instantiate(seed) {
    this.ready = false;
    // The module has no imports; env.abort is provided defensively.
    const { instance } = await WebAssembly.instantiate(this.wasmBytes, { env: { abort() {} } });
    this.ex = instance.exports;
    this.memory = this.ex.memory;
    this.f32 = null;

    this.ex.init(this.sr, 128, this.channels);

    this.inPtr     = this.ex.getInputPtr()  >>> 2;   // >> 2 → f32 index
    this.outPtr    = this.ex.getOutputPtr() >>> 2;
    this.paramsPtr = this.ex.getParamsPtr() >>> 2;
    this.numParams = this.ex.getNumParams();

    this.hasNoteOn = typeof this.ex.noteOn === "function";
    this.hasSample = typeof this.ex.getSamplePtr === "function"
                   && typeof this.ex.setSampleInfo === "function";

    if (seed) {
      const f = this.view();
      for (let i = 0; i < MAX_PARAMS; i++) this.shadow[i] = f[this.paramsPtr + i];
      this.port.postMessage({ type: "ready", numParams: this.numParams,
                              isSynth: this.hasNoteOn, hasSample: this.hasSample });
    }
    this.ready = true;
  }

  // Re-derive the Float32 view if the module grew (and replaced) its memory.
  view() {
    if (!this.f32 || this.f32.buffer !== this.memory.buffer)
      this.f32 = new Float32Array(this.memory.buffer);
    return this.f32;
  }

  loadSample(m) {
    if (!this.hasSample) return;
    const cap = this.ex.getSampleCapacity();
    const ch  = Math.min(MAX_CHANNELS, m.channels || 1);
    const n   = Math.min(m.frames | 0, cap);
    const base = this.ex.getSamplePtr() >>> 2;
    const f = this.view();
    // m.data is planar: channel c starts at c * m.frames
    for (let c = 0; c < ch; c++)
      for (let i = 0; i < n; i++) f[base + c * MAX_FRAMES + i] = m.data[c * m.frames + i];
    this.ex.setSampleInfo(n, ch, m.rate || sampleRate);
    this.port.postMessage({ type: "sampleLoaded", frames: n, channels: ch });
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!this.ready || !out || out.length === 0) {
      if (out) for (const c of out) c.fill(0);
      return true;
    }

    const f = this.view();
    const numFrames = out[0].length;                 // 128
    const ch = Math.min(this.channels, out.length);

    // notes
    if (this.hasNoteOn && this.notes.length) {
      for (const ev of this.notes) {
        if (ev.on) this.ex.noteOn(ev.note | 0, noteToHz(ev.note), ev.vel == null ? 1 : ev.vel);
        else if (typeof this.ex.noteOff === "function") this.ex.noteOff(ev.note | 0);
      }
      this.notes.length = 0;
    }

    // params (mirror the GUI's values into the module each block)
    for (let i = 0; i < this.numParams; i++) f[this.paramsPtr + i] = this.shadow[i];

    // input → inBuf (effects). Synths have no connected input; zero it.
    const inp = inputs[0];
    for (let c = 0; c < this.channels; c++) {
      const dst = this.inPtr + c * MAX_FRAMES;
      const src = inp && inp[c] ? inp[c] : (inp && inp[0] ? inp[0] : null);
      if (src) for (let i = 0; i < numFrames; i++) f[dst + i] = src[i];
      else     for (let i = 0; i < numFrames; i++) f[dst + i] = 0;
    }

    // A bad DSP state (e.g. a runaway feedback/delay path) can trap the WASM.
    // Catch it, output silence, and rebuild the instance so audio recovers
    // instead of the worklet dying silently.
    try {
      this.ex.process(numFrames);
    } catch (err) {
      this.ready = false;
      for (const c of out) c.fill(0);
      this.port.postMessage({ type: "error", message: "DSP recovered from: " + String((err && err.message) || err) });
      if (!this.reloading) {
        this.reloading = true;
        this.instantiate(false).then(() => { this.reloading = false; },
                                     () => { this.reloading = false; });
      }
      return true;
    }

    // outBuf → outputs (re-view in case process grew memory), sanitised so a NaN
    // or runaway value can't propagate or blast the output.
    const g = this.view();
    for (let c = 0; c < ch; c++) {
      const s = this.outPtr + c * MAX_FRAMES;
      const o = out[c];
      for (let i = 0; i < numFrames; i++) {
        let v = g[s + i];
        if (v !== v || v === Infinity || v === -Infinity) v = 0;   // NaN / Inf
        else if (v > 1) v = 1; else if (v < -1) v = -1;            // hard clip
        o[i] = v;
      }
    }
    // duplicate to extra output channels if the module is mono-ish
    for (let c = ch; c < out.length; c++) out[c].set(out[Math.min(ch - 1, 0)]);

    return true;
  }
}

registerProcessor("vstai-dsp", VstaiProcessor);
