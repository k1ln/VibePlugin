// Every drum-family plugin build.mjs knows how to assemble.
import { FULL_808, KICK_808, SNARE_808, TOMS_808, RIM_808, CLAP_808, COWBELL_808, CYMBAL_808, HATS_808, BASS_808 } from "./tr808/defs.mjs";

// Shared look + common controls for the single-voice 808 plugins.
const T808 = { accent: "#f08a24", accent2: "#f2d23c", pad: "#e2382a" };
const feel808 = { title: "Feel", controls: [
  { key: "AC", label: "Accent" },
  { key: "VELMODE", type: "selector", label: "Velocity", options: ["808", "Dynamic"] },
  { key: "DRIVE", label: "Drive" } ] };
const VEL_HINT = "Velocity: in 808 mode a hit is either normal or accented (velocity 100+), like the hardware; Dynamic follows velocity smoothly. ";
const single808 = (o) => ({
  machine: "tr808", gui: "ui/single.html", theme: { accent: T808.accent, accent2: T808.accent2 },
  guiConfig: { family: "BRIDGEWELL", model: o.model, sub: o.sub, theme: T808, sections: o.sections, pads: o.pads, hint: o.hint },
  ...o,
});
const BW = "Modelled on the Roland TR-808 from its Service Notes; the same circuit model as inside Bridgewell 80, on its own so it gets its own mixer channel. ";

import { FULL_909, KICK_909, SNARE_909, TOMS_909, RIM_909, CLAP_909, HATS_909, CRASH_909, RIDE_909 } from "./tr909/defs.mjs";

const T909 = { accent: "#ff7a1a", accent2: "#ffd24a", pad: "#d8d6cf", padInk: "#141414", panel: "#1d1e1f", panel2: "#3a3b3c" };
const feel909 = { title: "Feel", controls: [
  { key: "AC", label: "Accent" },
  { key: "VELMODE", type: "selector", label: "Velocity", options: ["909", "Dynamic"] },
  { key: "DRIVE", label: "Drive" } ] };
const VEL909 = "Velocity: in 909 mode a hit is normal or accented (velocity 100+); Dynamic follows velocity smoothly. ";
const WH = "Modelled on the Roland TR-909 from its Owner's Manual and Service Notes; the same model as inside Warehouse 909, on its own mixer channel. ";
const single909 = (o) => ({
  machine: "tr909", gui: "ui/single.html", theme: { accent: T909.accent, accent2: T909.accent2 },
  guiConfig: { family: "WAREHOUSE", model: o.model, sub: o.sub, theme: T909, sections: o.sections, pads: o.pads, hint: o.hint },
  ...o,
});

import { FULL_606, KICK_606, SNARE_606, TOMS_606, CYMBAL_606, HATS_606 } from "./tr606/defs.mjs";

const T606 = { accent: "#e5531a", accent2: "#ffd24a", pad: "#e5531a", panel: "#2b2e30", panel2: "#4a4e51" };
const feel606 = { title: "Feel", controls: [
  { key: "AC", label: "Accent" },
  { key: "VELMODE", type: "selector", label: "Velocity", options: ["606", "Dynamic"] },
  { key: "DRIVE", label: "Drive" } ] };
const VEL606 = "Velocity: in 606 mode a hit is normal or accented (velocity 100+); Dynamic follows velocity smoothly. Mod knobs fully left = the stock circuit. ";
const SB = "Modelled on the Roland TR-606 from its manual and service notes; the same model as inside Silverbox 606, on its own mixer channel. ";
const modFmt = "pct";
const single606 = (o) => ({
  machine: "tr606", gui: "ui/single.html", theme: { accent: T606.accent, accent2: T606.accent2 },
  guiConfig: { family: "SILVERBOX", model: o.model, sub: o.sub, theme: T606, sections: o.sections, pads: o.pads, hint: o.hint },
  ...o,
});

import { TESSITURA, ALEATORA, COLOSSUS } from "../strings/defs.mjs";

export const REGISTRY = [
  {
    slug: "bridgewell-80",
    name: "Bridgewell 80",
    machine: "tr808",
    wrapper: "full.ts",
    gui: "ui/bridgewell80.html",
    defs: FULL_808,
    theme: { accent: "#f08a24", accent2: "#f2d23c" },
    explanation:
      "A complete analog rhythm composer modelled circuit-by-circuit on the Roland TR-808, from its " +
      "Operation Manual and 1981 Service Notes: all 16 sounds (bass drum, snare, three toms/congas, " +
      "rim shot/claves, hand clap/maracas, cowbell, cymbal, open and closed hi-hat) with every panel " +
      "control — LEVEL, TONE, DECAY, SNAPPY, TUNING, the five instrument-select switches, ACCENT and " +
      "MASTER VOLUME. The bass drum rings a bridged-T filter that jumps an octave for its first 4 ms and " +
      "'sighs' down in pitch as it decays; toms bend down the same way; the metals come from six " +
      "free-running square oscillators. Voices are tuned and timed to Roland's own adjustment chart. " +
      "Built-in 16-step sequencer with PRE-SCALE (triplets to 32nds), last step, A/AB/B variations and " +
      "an accent row, locked sample-accurately to your DAW's song position. Play it from MIDI on the " +
      "General-MIDI drum map (36 kick, 38 snare, 42/46 hats…); velocity 100+ is accented.",
  },
  single808({
    slug: "bridgewell-kick", name: "Bridgewell Kick", wrapper: "kick.ts", defs: KICK_808, model: "KICK", sub: "Bass drum",
    sections: [{ title: "Bass drum", controls: [{ key: "LEV", label: "Level" }, { key: "TONE", label: "Tone" }, { key: "DEC", label: "Decay" }, { key: "TUNE", label: "Tune", fmt: "semi" }] }, feel808],
    pads: [{ label: "Kick", sub: "any note", note: 36 }],
    hint: VEL_HINT + "Tune is the circuit's service trimmer (the hardware sits at 56 Hz).",
    explanation: BW + "A bridged-T resonator rings at 56 Hz, jumps an octave for its first 4 ms, and sighs down in pitch as it fades — more so on accented hits. Level, Tone (the passive filter on the beater click), Decay (50 ms to a long boom), Tune. Any MIDI note plays it.",
  }),
  single808({
    slug: "bridgewell-snare", name: "Bridgewell Snare", wrapper: "snare.ts", defs: SNARE_808, model: "SNARE", sub: "Snare drum",
    sections: [{ title: "Snare drum", controls: [{ key: "LEV", label: "Level" }, { key: "TONE", label: "Tone" }, { key: "SNAP", label: "Snappy" }, { key: "TUNE", label: "Tune", fmt: "semi" }] }, feel808],
    pads: [{ label: "Snare", sub: "any note", note: 38 }],
    hint: VEL_HINT + "Tone balances the two drum resonators (238 / 476 Hz); Snappy is the noise envelope.",
    explanation: BW + "Two bridged-T resonators (238 and 476 Hz) for the drum, balanced by Tone, plus a separately enveloped high-passed noise for the snares, set by Snappy. Any MIDI note plays it.",
  }),
  single808({
    slug: "bridgewell-toms", name: "Bridgewell Toms", wrapper: "toms.ts", defs: TOMS_808, model: "TOMS", sub: "Toms & congas",
    sections: [
      { title: "Low", controls: [{ key: "SWITCH", type: "bit", bit: 0, off: "TOM", on: "CONGA" }, { key: "LT_TUNE", label: "Tuning" }, { key: "LT_LEV", label: "Level" }] },
      { title: "Mid", controls: [{ key: "SWITCH", type: "bit", bit: 1, off: "TOM", on: "CONGA" }, { key: "MT_TUNE", label: "Tuning" }, { key: "MT_LEV", label: "Level" }] },
      { title: "Hi", controls: [{ key: "SWITCH", type: "bit", bit: 2, off: "TOM", on: "CONGA" }, { key: "HT_TUNE", label: "Tuning" }, { key: "HT_LEV", label: "Level" }] },
      { title: "Mix", controls: [{ key: "WIDTH", label: "Stereo" }] }, feel808],
    pads: [{ label: "Low", sub: "C–D♯ · 41", note: 41, flash: 0 }, { label: "Mid", sub: "E–G · 45", note: 45, flash: 1 }, { label: "Hi", sub: "G♯–B · 48", note: 48, flash: 2 }],
    hint: VEL_HINT + "GM notes 41/45/48 always play toms and 64/63/62 always congas; any other note picks low/mid/hi by pitch class and plays tom or conga as the switch says.",
    explanation: BW + "The three tom/conga slots. Each drum's pitch starts high and falls as it rings (the circuit's diodes), toms add a whisper of noise 'reverb'. Frequencies follow Roland's chart: toms 80–220 Hz, congas 165–455 Hz.",
  }),
  single808({
    slug: "bridgewell-rim", name: "Bridgewell Rim & Claves", wrapper: "rim.ts", defs: RIM_808, model: "RIM · CLAVES", sub: "Rim shot / claves",
    sections: [{ title: "Rim shot / claves", controls: [{ key: "SWITCH", type: "bit", bit: 0, off: "RIM", on: "CLAVES" }, { key: "LEV", label: "Level" }] }, feel808],
    pads: [{ label: "Rim", sub: "37", note: 37, flash: 0 }, { label: "Claves", sub: "75", note: 75, flash: 1 }],
    hint: VEL_HINT + "Note 37 is always the rim shot, 75 the claves; any other note plays what the switch selects.",
    explanation: BW + "Rim shot: two resonators (455 / 1667 Hz) through the 808's harmonics-rich 'swing' VCA on a 10 ms envelope. Claves: a single high-Q 2.5 kHz ring.",
  }),
  single808({
    slug: "bridgewell-clap", name: "Bridgewell Clap & Maracas", wrapper: "clap.ts", defs: CLAP_808, model: "CLAP · MARACAS", sub: "Hand clap / maracas",
    sections: [{ title: "Hand clap / maracas", controls: [{ key: "SWITCH", type: "bit", bit: 0, off: "CLAP", on: "MARACAS" }, { key: "LEV", label: "Level" }] }, feel808],
    pads: [{ label: "Clap", sub: "39", note: 39, flash: 0 }, { label: "Maracas", sub: "70", note: 70, flash: 1 }],
    hint: VEL_HINT + "Note 39 is always the clap, 70 the maracas; any other note plays what the switch selects.",
    explanation: BW + "The clap is band-passed noise through a sawtooth envelope that re-fires three times before the fourth ramp is left to decay, over a slower 'reverb' envelope — the multiple-hands sound. Maracas: short high-passed noise.",
  }),
  single808({
    slug: "bridgewell-cowbell", name: "Bridgewell Cowbell", wrapper: "cowbell.ts", defs: COWBELL_808, model: "COWBELL", sub: "Cowbell",
    sections: [{ title: "Cowbell", controls: [{ key: "LEV", label: "Level" }] }, feel808],
    pads: [{ label: "Cowbell", sub: "any note", note: 56 }],
    hint: VEL_HINT,
    explanation: BW + "Two free-running square oscillators at 540 and 800 Hz, gated and band-passed, with the circuit's two-stage envelope: an abrupt drop after the strike, then a ringing tail.",
  }),
  single808({
    slug: "bridgewell-cymbal", name: "Bridgewell Cymbal", wrapper: "cymbal.ts", defs: CYMBAL_808, model: "CYMBAL", sub: "Cymbal",
    sections: [{ title: "Cymbal", controls: [{ key: "LEV", label: "Level" }, { key: "TONE", label: "Tone" }, { key: "DEC", label: "Decay" }] }, feel808],
    pads: [{ label: "Cymbal", sub: "any note", note: 49 }],
    hint: VEL_HINT + "Decay runs 350 ms to 1.2 s as on the hardware.",
    explanation: BW + "Six square oscillators (205–800 Hz) summed and split into three bands with their own envelopes; Tone sets the ratio, Decay the length of the main band (350–1200 ms).",
  }),
  single808({
    slug: "bridgewell-hats", name: "Bridgewell Hats", wrapper: "hats.ts", defs: HATS_808, model: "HATS", sub: "Open & closed hi-hat",
    sections: [{ title: "Open hi-hat", controls: [{ key: "OH_LEV", label: "Level" }, { key: "OH_DEC", label: "Decay" }] }, { title: "Closed hi-hat", controls: [{ key: "CH_LEV", label: "Level" }] }, feel808],
    pads: [{ label: "Closed", sub: "42 · C–F", note: 42, flash: 0 }, { label: "Open", sub: "46 · F♯–B", note: 46, flash: 1 }],
    hint: VEL_HINT + "A closed hat cuts a ringing open hat short, as on the hardware. 42/44 closed, 46 open; other notes: C–F closed, F♯–B open.",
    explanation: BW + "Open and closed hi-hat from the six-oscillator metal source's upper band, each through its own harmonics-rich VCA and high-pass. Kept together in one plugin so the closed hat can choke the open one.",
  }),
  single808({
    slug: "bridgewell-bass", name: "Bridgewell Bass", wrapper: "bass.ts", defs: BASS_808, model: "BASS", sub: "Pitched 808",
    sections: [
      { title: "Drum", controls: [{ key: "LEV", label: "Level" }, { key: "TONE", label: "Tone" }, { key: "CLICK", label: "Click" }, { key: "SIGH", label: "Sigh", fmt: "x" }] },
      { title: "Envelope", controls: [{ key: "DEC", label: "Decay" }, { key: "RELEASE", label: "Release" }] },
      { title: "Glide", controls: [{ key: "GLIDE", label: "Time" }, { key: "GLIDE_MODE", type: "selector", label: "Mode", options: ["Always", "Legato"] }] },
      { title: "Pitch", controls: [{ key: "OCTAVE", label: "Octave", fmt: "oct", sens: 0.5 }, { key: "BEND_RANGE", label: "Bend", fmt: "int", sens: 0.5 }] },
      { title: "Output", controls: [{ key: "DRIVE", label: "Drive" }, { key: "AC", label: "Accent" }, { key: "VELMODE", type: "selector", label: "Velocity", options: ["808", "Dynamic"] }] }],
    pads: [{ label: "C1", note: 24 }, { label: "G1", note: 31 }, { label: "C2", note: 36 }],
    hint: "Play it like a bass: monophonic, last note wins. Legato glide bends the ringing drum to the new note without re-striking it. Release shortens the tail when you let go (full right = let it ring). Pitch bend follows the Bend range.",
    explanation: "The 808 bass drum as a pitched instrument, the way hip-hop and trap use it. The same bridged-T circuit as Bridgewell Kick — attack octave jump, pitch sigh, beater click — tuned to the note you play, with decay stretched to 4 s, release on note-off, glide (always or legato-only), octave, pitch bend and a drive stage for the distorted 808.",
  }),
  {
    slug: "warehouse-909", name: "Warehouse 909", machine: "tr909", wrapper: "full.ts", gui: "ui/warehouse909.html",
    defs: FULL_909, theme: { accent: "#ff7a1a", accent2: "#ffd24a" },
    explanation:
      "A complete hybrid rhythm composer modelled on the Roland TR-909 from its Owner's Manual and Service Notes. " +
      "Analog bass drum (tune, level, attack, decay: a waveshaped VCO with a falling pitch contour and a separate click), " +
      "snare (two synced triangle VCOs bent down over 20 ms, plus low- and high-passed noise for Tone and Snappy), three toms, " +
      "rim shot and hand clap; hi-hat, crash and ride as 6-bit PCM read at the original ~30 kHz clock — the closed hat is the " +
      "first third of the open hat's sample, exactly as in the hardware (the samples themselves are our own). Sequencer as the " +
      "manual describes: four scales, last step, shuffle 1–7, flam with eight intervals on BD/SD/toms, a total-accent row and " +
      "per-instrument accent on BD, SD, toms and closed hat, sample-locked to your DAW. MIDI on the 909's own map (36 BD, 38 SD, 42/46 hats, 49 crash, 51 ride).",
  },
  single909({ slug: "warehouse-kick", name: "Warehouse Kick", wrapper: "kick.ts", defs: KICK_909, model: "KICK", sub: "Bass drum",
    sections: [{ title: "Bass drum", controls: [{ key: "TUNE", label: "Tune" }, { key: "LEV", label: "Level" }, { key: "ATT", label: "Attack" }, { key: "DEC", label: "Decay" }] }, feel909],
    pads: [{ label: "Kick", sub: "any note", note: 36 }], hint: VEL909 + "Tune sets how high the pitch contour starts and how fast it falls; Attack is the click.",
    explanation: WH + "A sawtooth VCO shaped to a near-sine, swept down from several times its pitch, plus a noise-and-pulse click. Tune, Level, Attack, Decay — accent lifts and lengthens it." }),
  single909({ slug: "warehouse-snare", name: "Warehouse Snare", wrapper: "snare.ts", defs: SNARE_909, model: "SNARE", sub: "Snare drum",
    sections: [{ title: "Snare drum", controls: [{ key: "TUNE", label: "Tune" }, { key: "LEV", label: "Level" }, { key: "TONE", label: "Tone" }, { key: "SNAP", label: "Snappy" }] }, feel909],
    pads: [{ label: "Snare", sub: "any note", note: 38 }], hint: VEL909,
    explanation: WH + "Two triangle VCOs (≈180 and 330 Hz) reset together and bent down over 20 ms, on separate decays; Tone opens the noise low-pass, Snappy adds the high-passed snare wires." }),
  single909({ slug: "warehouse-toms", name: "Warehouse Toms", wrapper: "toms.ts", defs: TOMS_909, model: "TOMS", sub: "Low, mid, hi tom",
    sections: [
      { title: "Low", controls: [{ key: "LT_TUNE", label: "Tune" }, { key: "LT_LEV", label: "Level" }, { key: "LT_DEC", label: "Decay" }] },
      { title: "Mid", controls: [{ key: "MT_TUNE", label: "Tune" }, { key: "MT_LEV", label: "Level" }, { key: "MT_DEC", label: "Decay" }] },
      { title: "Hi", controls: [{ key: "HT_TUNE", label: "Tune" }, { key: "HT_LEV", label: "Level" }, { key: "HT_DEC", label: "Decay" }] },
      { title: "Mix", controls: [{ key: "WIDTH", label: "Stereo" }] }, feel909],
    pads: [{ label: "Low", sub: "C–D♯ · 41", note: 41, flash: 0 }, { label: "Mid", sub: "E–G · 45", note: 45, flash: 1 }, { label: "Hi", sub: "G♯–B · 48", note: 48, flash: 2 }],
    hint: VEL909 + "GM notes 41/45/48 (and 43/47/50); any other note picks low/mid/hi by pitch class — tune them to play melodic toms, as the manual suggests.",
    explanation: WH + "Three toms: a VCO with a falling pitch contour, a faint shell partial and a burst of tom noise. Tune, Level and Decay each." }),
  single909({ slug: "warehouse-rim", name: "Warehouse Rim", wrapper: "rim.ts", defs: RIM_909, model: "RIM SHOT", sub: "Rim shot",
    sections: [{ title: "Rim shot", controls: [{ key: "LEV", label: "Level" }] }, feel909], pads: [{ label: "Rim", sub: "any note", note: 37 }], hint: VEL909,
    explanation: WH + "Two ringing filters (≈500 Hz and 1.7 kHz) through a harmonics-rich VCA on a very short envelope." }),
  single909({ slug: "warehouse-clap", name: "Warehouse Clap", wrapper: "clap.ts", defs: CLAP_909, model: "CLAP", sub: "Hand clap",
    sections: [{ title: "Hand clap", controls: [{ key: "LEV", label: "Level" }] }, feel909], pads: [{ label: "Clap", sub: "any note", note: 39 }], hint: VEL909,
    explanation: WH + "Band-passed noise re-struck four times in quick succession over a reverb-like tail." }),
  single909({ slug: "warehouse-hats", name: "Warehouse Hats", wrapper: "hats.ts", defs: HATS_909, model: "HATS", sub: "6-bit hi-hat",
    sections: [{ title: "Hi-hat", controls: [{ key: "LEV", label: "Level" }, { key: "CH_DEC", label: "CH decay" }, { key: "OH_DEC", label: "OH decay" }] }, feel909],
    pads: [{ label: "Closed", sub: "42 · C–F", note: 42, flash: 0 }, { label: "Open", sub: "46 · F♯–B", note: 46, flash: 1 }],
    hint: VEL909 + "Open and closed are one sample: a closed hit stops the open one, as on the 909.",
    explanation: WH + "One 6-bit sample at ~30 kHz: the closed hat plays its first third, the open hat three quarters, each shaped by its own analog decay. The sample is synthesised, the playback path is the 909's." }),
  single909({ slug: "warehouse-crash", name: "Warehouse Crash", wrapper: "crash.ts", defs: CRASH_909, model: "CRASH", sub: "6-bit crash",
    sections: [{ title: "Crash", controls: [{ key: "LEV", label: "Level" }, { key: "TUNE", label: "Tune" }] }, feel909], pads: [{ label: "Crash", sub: "any note", note: 49 }],
    hint: VEL909 + "Tune changes the sample clock, so higher is also shorter — as on the hardware.",
    explanation: WH + "A 6-bit crash read at a tunable ~30 kHz clock; its decay comes from the playback position, so tuning up shortens it, like the original." }),
  single909({ slug: "warehouse-ride", name: "Warehouse Ride", wrapper: "ride.ts", defs: RIDE_909, model: "RIDE", sub: "6-bit ride",
    sections: [{ title: "Ride", controls: [{ key: "LEV", label: "Level" }, { key: "TUNE", label: "Tune" }] }, feel909], pads: [{ label: "Ride", sub: "any note", note: 51 }],
    hint: VEL909 + "Tune changes the sample clock, so higher is also shorter.",
    explanation: WH + "A 6-bit ride with a bell partial, read at a tunable ~30 kHz clock, decay from the playback position." }),
  {
    slug: "silverbox-606", name: "Silverbox 606", machine: "tr606", wrapper: "full.ts", gui: "ui/silverbox606.html",
    defs: FULL_606, theme: { accent: "#e5531a", accent2: "#ffd24a" },
    explanation:
      "The portable analog rhythm box, modelled on the Roland TR-606: bass drum, snare, low and high tom, cymbal, open and " +
      "closed hi-hat with the panel's ACCENT and six instrument-mix levels, VOLUME and TEMPO. The metals come from six free-running " +
      "Schmitt oscillators (245–625 Hz) through band-passes at 3.44 and 7.1 kHz; the stock open hat has no decay knob — its length " +
      "follows the tempo, and a closed hat cuts it, just like the hardware. A Mods section adds the classic hardware mods (decays, " +
      "tunes, snappy) — fully left is stock. 16-step sequencer with scale 1–4, last step and an accent row, locked to your DAW.",
  },
  single606({ slug: "silverbox-kick", name: "Silverbox Kick", wrapper: "kick.ts", defs: KICK_606, model: "KICK", sub: "606 bass drum",
    sections: [{ title: "Bass drum", controls: [{ key: "LEV", label: "Level" }] }, { title: "Mods", controls: [{ key: "DEC", label: "Decay" }, { key: "TUNE", label: "Tune", fmt: "semi" }] }, feel606],
    pads: [{ label: "Kick", sub: "any note", note: 36 }], hint: VEL606,
    explanation: SB + "A short, punchy twin-T kick with a clicky edge; the stock 606 has only a level control, the mod knobs add decay and tune." }),
  single606({ slug: "silverbox-snare", name: "Silverbox Snare", wrapper: "snare.ts", defs: SNARE_606, model: "SNARE", sub: "606 snare",
    sections: [{ title: "Snare drum", controls: [{ key: "LEV", label: "Level" }] }, { title: "Mods", controls: [{ key: "TUNE", label: "Tune", fmt: "semi" }, { key: "SNAP", label: "Snappy" }] }, feel606],
    pads: [{ label: "Snare", sub: "any note", note: 38 }], hint: VEL606,
    explanation: SB + "A twin-T drum and high-passed noise — bright and thin, the acid-house snare. Mods: the classic pitch-down, and snappy." }),
  single606({ slug: "silverbox-toms", name: "Silverbox Toms", wrapper: "toms.ts", defs: TOMS_606, model: "TOMS", sub: "Low & high tom",
    sections: [{ title: "Toms", controls: [{ key: "LT_LEV", label: "Low" }, { key: "HT_LEV", label: "High" }, { key: "WIDTH", label: "Stereo" }] },
      { title: "Mods", controls: [{ key: "LT_TUNE", label: "Low tune", fmt: "semi" }, { key: "HT_TUNE", label: "High tune", fmt: "semi" }, { key: "DEC", label: "Decay" }] }, feel606],
    pads: [{ label: "Low", sub: "41 · C–F", note: 41, flash: 0 }, { label: "High", sub: "48 · F♯–B", note: 48, flash: 1 }], hint: VEL606,
    explanation: SB + "Two twin-T toms with a short burst of low-passed noise rumble." }),
  single606({ slug: "silverbox-cymbal", name: "Silverbox Cymbal", wrapper: "cymbal.ts", defs: CYMBAL_606, model: "CYMBAL", sub: "606 cymbal",
    sections: [{ title: "Cymbal", controls: [{ key: "LEV", label: "Level" }] }, { title: "Mods", controls: [{ key: "DEC", label: "Decay" }] }, feel606],
    pads: [{ label: "Cymbal", sub: "any note", note: 49 }], hint: VEL606,
    explanation: SB + "Six square oscillators through both band-passes, two VCAs on one envelope and two high-passes." }),
  single606({ slug: "silverbox-hats", name: "Silverbox Hats", wrapper: "hats.ts", defs: HATS_606, model: "HATS", sub: "606 hi-hats",
    sections: [{ title: "Hi-hat", controls: [{ key: "LEV", label: "Level" }] },
      { title: "Open-hat length", controls: [{ key: "FOLLOW", type: "selector", label: "Tempo from", options: ["Knob", "DAW"] }, { key: "TEMPO", label: "Tempo", fmt: "int" }, { key: "OH_DEC", label: "Mod decay" }] }, feel606],
    pads: [{ label: "Closed", sub: "42 · C–F", note: 42, flash: 0 }, { label: "Open", sub: "46 · F♯–B", note: 46, flash: 1 }],
    hint: VEL606 + "The stock open hat's length follows the tempo (as on the 606): from your DAW, or the Tempo knob. Closed cuts open.",
    explanation: SB + "Open and closed hi-hat from the metal oscillators' upper band, bright up in the 10 kHz region. The stock open hat has no decay knob: its length follows the tempo." }),
  {
    slug: "tessitura", name: "Tessitura", sources: ["../strings/core.ts", "../strings/section.ts", "../strings/tessitura.ts"],
    gui: "../strings/ui/tessitura.html", defs: TESSITURA, theme: { accent: "#d9a54a", accent2: "#f0cf86" },
    explanation:
      "A physically modelled orchestral string section — no samples. Every note is bowed by up to six players, each a real-time " +
      "bowed-string model (the McIntyre–Schumacher–Woodhouse waveguide with stick-slip bow friction, as in Cook & Scavone's STK) " +
      "on a violin, viola, cello or bass body, with their own intonation, vibrato and bow timing, seated across the stage. " +
      "Eight articulations on keyswitches C0–G0 — sustain, tremolo, pizzicato, spiccato, marcato, harmonics, sul ponticello, " +
      "col legno — and the controls composers expect: CC1 dynamics (bow speed, pressure and tone together), CC11 expression, " +
      "CC21 vibrato, sustain pedal, true legato (soft notes slide, hard notes change bow). Close, tree and ambient microphones into a hall.",
  },
  {
    slug: "aleatora", name: "Aleatora", sources: ["../strings/core.ts", "../strings/section.ts", "../strings/aleatora.ts"],
    gui: "../strings/ui/aleatora.html", defs: ALEATORA, theme: { accent: "#7fd3ff", accent2: "#c8f0ff" },
    explanation:
      "Aleatoric string textures for film and trailer sound design, played by the same physically modelled bowed-string section " +
      "as Tessitura. Each key spawns a cluster of players spread by cents (optionally on a quarter-tone grid); Swarm sends every " +
      "player gliding after its own random pitch targets; Rise or Fall glides the whole mass over up to 30 seconds — the trailer " +
      "riser; Scratch digs the bow in with real overpressure; Shimmer adds an octave-up flautando; Pulse swells the bow in time " +
      "with your DAW; Freeze holds the hall forever. Chaos scales it all. Eight articulations on C0–G0, CC1 dynamics, CC11 expression.",
  },
  {
    slug: "colossus", name: "Colossus", sources: ["../strings/core.ts", "../strings/colossus.ts"],
    gui: "../strings/ui/colossus.html", defs: COLOSSUS, theme: { accent: "#ff5a2a", accent2: "#ffb38a" },
    explanation:
      "Hybrid trailer strings. Every note is three ensembles at once — an octave down, unison and an octave up — each up to " +
      "five detuned band-limited voices with their own drift, plus a sub, bow-hair rosin noise and a marcato bite that opens " +
      "the filter. The Ostinato engine replays the held chord in rhythm, locked to your DAW's bar: 8ths, 16ths, gallop, reverse " +
      "gallop, triplets, the 3-3-2 figure, dotted 8ths and 32nds, with note length, accent and swing. Evolve moves the tone over " +
      "time, Tension adds a quiet minor second, Pump ducks every beat. String-body formants, tape saturation and a hall. CC1 " +
      "dynamics, CC11 expression, pitch bend.",
  },
];
