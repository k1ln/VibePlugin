// StandardUi.h
// =====================================================================
//  The VibePlugin "standard" GUI component kit — a known-good, self-contained
//  HTML document used three ways:
//    1. as the starter GUI shown before anything is generated (live, playable),
//    2. as the house-style reference injected into every build prompt, and
//    3. as the editable seed of the "Standard UI" tab.
//
//  It is a normal generated-GUI document: inline CSS/JS only, no external
//  requests, and it talks to the engine through window.vstai. Keep it that way
//  so the model can copy these patterns verbatim.
// =====================================================================

#pragma once

#include <juce_core/juce_core.h>
#include "WebAssets.h"

namespace vstai
{
    // Compiled-in fallback copy of the house-style kit. The real source of truth is
    // the on-disk file ui/standard.html (shipped in the bundle's Resources, easy for
    // a designer or the AI to read/edit); this baked copy is only used if that file
    // is missing (e.g. an unsigned dev run from an unexpected working directory).
    // Returned by a function (not an inline variable) to avoid any ODR / large-static
    // concerns across translation units. Keep it in sync with ui/standard.html.
    inline const char* bakedStandardUiHtml()
    {
        return R"HTML(<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>VibePlugin Standard Kit</title>
<style>
  /* ---- THEME TOKENS -------------------------------------------------------
     House style: "minimal utilitarian" — the look of stock DAW devices
     (Ableton / Bitwig) and tools like FabFilter. Flat matte surfaces, thin
     hairline borders, small dense controls, NO neon bloom / drop-shadow glow /
     film grain. Depth comes from a 1px lighter top edge + darker recessed
     wells, never from blur. One muted amber accent, one muted blue for
     modulation. Re-skin everything from here. */
  :root{
    --bg:#171717;            /* app base                 */
    --panel:#1f1f1f;         /* module surface           */
    --panel-2:#262626;       /* raised / hover           */
    --track:#0d0d0d;         /* recessed wells, displays */
    --line:rgba(255,255,255,.06);   /* hairline divider  */
    --line-2:rgba(255,255,255,.11);  /* control border   */
    --line-3:rgba(255,255,255,.20);  /* emphasis / hover */
    --edge:rgba(255,255,255,.05);    /* 1px top highlight (fake bevel) */
    --ink:#d7d7d9; --ink-2:#9a9b9e; --muted:#67696e;
    --accent:#c8923a;        /* muted amber (values, fills)   */
    --accent-2:#3fa98c;      /* muted teal  (modulation)      */
    --warn:#c75d52;          /* clip / danger                 */
    --ok:#5fae7e;            /* signal present                */
    --radius:3px; --radius-sm:2px;
  }
  body.light{
    --bg:#dfe0e2; --panel:#ececee; --panel-2:#f6f6f7; --track:#cfd0d3;
    --line:rgba(0,0,0,.07); --line-2:rgba(0,0,0,.14); --line-3:rgba(0,0,0,.26);
    --edge:rgba(255,255,255,.55);
    --ink:#1c1d20; --ink-2:#4a4c50; --muted:#7a7c80;
    --accent:#b07820; --accent-2:#2f8f73;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{
    background:var(--bg); color:var(--ink); padding:0;
    font:11px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;
    -webkit-font-smoothing:antialiased; -webkit-user-select:none;user-select:none;
  }
  /* ---- structural chrome -------------------------------------------------- */
  .app{display:flex;flex-direction:column;min-height:100%}
  .topbar{display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;
          background:var(--panel);border-bottom:1px solid var(--line)}
  .topbar .brand{font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-2)}
  .topbar .sp{flex:1}
  .tabs{display:flex;gap:1px;height:28px;padding:0 8px;background:var(--panel);border-bottom:1px solid var(--line)}
  .tab{appearance:none;border:0;background:transparent;color:var(--muted);font:inherit;font-size:10px;
       letter-spacing:.8px;text-transform:uppercase;padding:0 12px;cursor:pointer;
       border-bottom:2px solid transparent}
  .tab:hover{color:var(--ink-2)}
  .tab.on{color:var(--ink);border-bottom-color:var(--accent)}
  .page{display:none;padding:12px}
  .page.on{display:block}
  .row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}
  /* ---- panel / section (collapsible) -------------------------------------- */
  .panel{background:var(--panel);border:1px solid var(--line);border-top-color:var(--edge);
         border-radius:var(--radius);min-width:0}
  .panel>.head{display:flex;align-items:center;gap:6px;height:22px;padding:0 8px;
       font-size:9px;letter-spacing:1.1px;text-transform:uppercase;color:var(--muted);
       border-bottom:1px solid var(--line);cursor:default}
  .panel>.head .caret{cursor:pointer;color:var(--ink-2);width:10px;text-align:center;transition:transform .12s}
  .panel.collapsed>.head .caret{transform:rotate(-90deg)}
  .panel.collapsed>.body{display:none}
  .panel>.body{padding:10px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
  /* ---- control cell (label under control) --------------------------------- */
  .cell{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0}
  .cell .lbl{font-size:9px;letter-spacing:.4px;color:var(--ink-2);white-space:nowrap}
  .cell .sub{font-size:8.5px;color:var(--muted)}
  /* readout chip (also the editable numeric field) */
  .num{font-size:10px;color:var(--ink);font-variant-numeric:tabular-nums;background:var(--track);
       border:1px solid var(--line-2);border-radius:var(--radius-sm);padding:1px 6px;min-width:44px;
       text-align:center;cursor:text}
  .num:focus{outline:none;border-color:var(--accent);color:#fff}
  /* ---- knob — flat/minimal: the arc IS the scale, no skeuomorphic tick ring */
  .knob{cursor:ns-resize;touch-action:none;display:block}
  .knob .face{fill:var(--track);stroke:var(--line-2);stroke-width:1}
  .knob .track{fill:none;stroke:var(--line-2);stroke-width:2.5}
  .knob .arc{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linecap:butt}
  .knob .mod{fill:none;stroke:var(--accent-2);stroke-width:2.5;stroke-linecap:butt;opacity:.85}
  .knob .ind{stroke:var(--ink);stroke-width:2;stroke-linecap:round}
  .knob.endless .arc{stroke:var(--accent-2)}
  /* ---- fader (vertical + horizontal) -------------------------------------- */
  .fader{position:relative;background:var(--track);border:1px solid var(--line-2);
         border-radius:var(--radius-sm);cursor:pointer;touch-action:none;overflow:hidden}
  .fader.v{width:22px;height:108px}
  .fader.h{width:140px;height:22px}
  .fader .fill{position:absolute;background:var(--accent);opacity:.8}
  .fader.v .fill{left:0;right:0;bottom:0}
  .fader.h .fill{left:0;top:0;bottom:0}
  .fader .cap{position:absolute;background:var(--ink-2)}
  .fader.v .cap{left:0;right:0;height:3px}
  .fader.h .cap{top:0;bottom:0;width:3px}
  /* ---- buttons / toggles -------------------------------------------------- */
  .btn{appearance:none;border:1px solid var(--line-2);border-top-color:var(--edge);
       background:var(--panel-2);color:var(--ink-2);font:inherit;font-size:10px;font-weight:600;
       letter-spacing:.3px;padding:5px 11px;border-radius:var(--radius-sm);cursor:pointer;min-width:54px}
  .btn:hover{border-color:var(--line-3);color:var(--ink)}
  .btn:active{background:var(--panel)}
  .btn.on{background:var(--accent);border-color:var(--accent);color:#111}
  /* segmented selector / radio group */
  .seg{display:inline-flex;border:1px solid var(--line-2);border-radius:var(--radius-sm);overflow:hidden}
  .seg button{appearance:none;border:0;border-left:1px solid var(--line);background:var(--panel-2);
       color:var(--ink-2);font:inherit;font-size:10px;padding:4px 9px;cursor:pointer}
  .seg button:first-child{border-left:0}
  .seg button:hover{color:var(--ink)}
  .seg button.on{background:var(--accent);color:#111}
  /* dropdown / combo */
  .sel{appearance:none;background:var(--panel-2);color:var(--ink);font:inherit;font-size:10px;
       border:1px solid var(--line-2);border-radius:var(--radius-sm);padding:4px 22px 4px 8px;cursor:pointer;
       background-image:linear-gradient(45deg,transparent 50%,var(--ink-2) 50%),linear-gradient(-45deg,transparent 50%,var(--ink-2) 50%);
       background-position:calc(100% - 12px) 50%,calc(100% - 8px) 50%;background-size:4px 4px;background-repeat:no-repeat}
  .sel:hover{border-color:var(--line-3)}
  /* stepper */
  .step{display:inline-flex;align-items:stretch;border:1px solid var(--line-2);border-radius:var(--radius-sm);overflow:hidden}
  .step button{appearance:none;border:0;background:var(--panel-2);color:var(--ink-2);font:inherit;
       width:20px;cursor:pointer;font-size:12px;line-height:1}
  .step button:hover{color:var(--ink);background:var(--panel)}
  .step .v{min-width:42px;text-align:center;align-self:center;font-variant-numeric:tabular-nums;
       border-left:1px solid var(--line);border-right:1px solid var(--line);padding:3px 0}
  /* LED */
  .led{width:7px;height:7px;border-radius:50%;background:var(--track);border:1px solid var(--line-2)}
  .led.on{background:var(--ok);border-color:var(--ok)}
  .led.warn.on{background:var(--warn);border-color:var(--warn)}
  /* ---- canvas displays (scope/spectrum/curve/wavetable/lfo/adsr/seq) ------ */
  .disp{position:relative;background:var(--track);border:1px solid var(--line-2);border-radius:var(--radius-sm)}
  .disp canvas{display:block;width:100%;height:100%}
  .disp .tag{position:absolute;top:4px;left:6px;font-size:8px;letter-spacing:.8px;text-transform:uppercase;color:var(--muted)}
  .disp .rd{position:absolute;top:4px;right:6px;font-size:9px;color:var(--ink-2);font-variant-numeric:tabular-nums}
  /* ---- XY pad ------------------------------------------------------------- */
  .xy{position:relative;background:
        linear-gradient(var(--line),transparent 1px) 0 0/100% 25%,
        linear-gradient(90deg,var(--line),transparent 1px) 0 0/25% 100%,
        var(--track);
      border:1px solid var(--line-2);border-radius:var(--radius-sm);cursor:crosshair;touch-action:none}
  .xy .pt{position:absolute;width:10px;height:10px;margin:-5px;border-radius:50%;background:var(--accent);border:1px solid #111}
  .xy .ch{position:absolute;background:var(--line);pointer-events:none}
  /* ---- meter -------------------------------------------------------------- */
  .meter{display:flex;gap:3px;height:108px;padding:3px;background:var(--track);
         border:1px solid var(--line-2);border-radius:var(--radius-sm)}
  .meter .ch{width:9px;align-self:stretch;background:var(--bg);position:relative;overflow:hidden}
  .meter .ch .fl{position:absolute;left:0;right:0;bottom:0;background:var(--ok)}
  .meter .ch .pk{position:absolute;left:0;right:0;height:1px;background:var(--ink)}
  /* ---- piano -------------------------------------------------------------- */
  .piano{position:relative;height:74px;display:flex;border:1px solid var(--line-2);
         border-radius:var(--radius-sm);overflow:hidden;background:#000}
  .wk{flex:1;background:#cfd0d2;border-right:1px solid #2a2a2a;cursor:pointer}
  .wk:active,.wk.down{background:var(--accent)}
  .bk{position:absolute;top:0;width:5%;height:62%;background:#202022;z-index:2;cursor:pointer;
      border:1px solid #000;border-top:0;border-radius:0 0 2px 2px}
  .bk:active,.bk.down{background:var(--accent)}
  /* ---- mod matrix --------------------------------------------------------- */
  table.mtx{border-collapse:collapse;font-size:9px}
  table.mtx th{color:var(--muted);font-weight:500;padding:3px 6px;text-align:center;
       letter-spacing:.3px;border:1px solid var(--line)}
  table.mtx th.src{text-align:right}
  table.mtx td{border:1px solid var(--line);width:34px;height:22px;padding:0;position:relative;cursor:ns-resize}
  table.mtx td .fl{position:absolute;left:0;right:0;bottom:0;background:var(--accent-2);opacity:.85}
  table.mtx td.neg .fl{background:var(--warn);opacity:.7}
  /* ---- step sequencer ----------------------------------------------------- */
  .seq{display:flex;gap:2px;align-items:flex-end;height:84px;padding:4px;background:var(--track);
       border:1px solid var(--line-2);border-radius:var(--radius-sm)}
  .seq .st{flex:1;background:var(--bg);position:relative;cursor:ns-resize;min-width:10px;align-self:stretch}
  .seq .st .fl{position:absolute;left:0;right:0;bottom:0;background:var(--accent)}
  .seq .st.cur{outline:1px solid var(--ink-2);outline-offset:-1px}
  .seq .st.off .fl{background:var(--line-2)}
  /* ---- preset browser ----------------------------------------------------- */
  .pbrow{display:flex;align-items:center;gap:4px}
  .pbrow input{background:var(--track);border:1px solid var(--line-2);border-radius:var(--radius-sm);
       color:var(--ink);font:inherit;font-size:10px;padding:3px 7px;width:150px}
  .pbrow input:focus{outline:none;border-color:var(--accent)}
  .plist{margin-top:6px;max-height:128px;overflow:auto;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--track)}
  .plist .it{display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;border-bottom:1px solid var(--line)}
  .plist .it:hover{background:var(--panel)}
  .plist .it.on{background:var(--panel-2);color:#fff}
  .plist .it .fav{color:var(--muted);width:12px;text-align:center}
  .plist .it .fav.y{color:var(--accent)}
  .plist .it .cat{margin-left:auto;font-size:8.5px;color:var(--muted);letter-spacing:.4px;text-transform:uppercase}
  /* ---- tooltip + context menu (shared, JS-driven) ------------------------- */
  .tip{position:fixed;z-index:50;background:#000;color:var(--ink);border:1px solid var(--line-2);
       border-radius:var(--radius-sm);padding:3px 7px;font-size:10px;pointer-events:none;
       white-space:nowrap;opacity:0;transition:opacity .08s}
  .tip.show{opacity:1}
  .menu{position:fixed;z-index:60;background:var(--panel);border:1px solid var(--line-3);
        border-radius:var(--radius-sm);padding:3px;min-width:130px;box-shadow:0 4px 14px rgba(0,0,0,.5)}
  .menu .mi{padding:5px 10px;font-size:10px;color:var(--ink-2);cursor:pointer;border-radius:var(--radius-sm)}
  .menu .mi:hover{background:var(--panel-2);color:var(--ink)}
  .menu .sep{height:1px;background:var(--line);margin:3px 0}
  /* showcase-onepage: every section on one page, no tabs — design showcase */
  .tabs{display:none!important}
  .page{display:block!important}
</style>
</head>
<body>
<div class="app">
  <!-- ====================== TOP BAR + PRESET BROWSER ====================== -->
  <div class="topbar">
    <span class="led on" id="sigLed" data-tip="Signal present"></span>
    <span class="brand">VibePlugin</span>
    <div class="pbrow" style="margin-left:8px">
      <button class="btn preset-prev" style="min-width:24px;padding:5px 6px">‹</button>
      <input id="presetSearch" placeholder="search presets…" autocomplete="off"/>
      <button class="btn preset-next" style="min-width:24px;padding:5px 6px">›</button>
    </div>
    <span class="sp"></span>
    <button class="btn" id="abBtn" data-tip="A/B compare">A</button>
    <button class="btn" id="themeBtn" data-tip="Toggle light / dark">◐</button>
  </div>

  <!-- =============================== TABS ================================= -->
  <div class="tabs" id="tabs">
    <button class="tab on" data-page="osc">Osc</button>
    <button class="tab" data-page="filter">Filter</button>
    <button class="tab" data-page="mod">Env / Mod</button>
    <button class="tab" data-page="fx">FX</button>
    <button class="tab" data-page="seq">Seq / Keys</button>
  </div>

  <!-- =============================== OSC PAGE ============================= -->
  <div class="page on" id="page-osc">
    <div class="row">
      <div class="panel"><div class="head"><span class="caret">▾</span>Oscillator</div>
        <div class="body">
          <div class="cell"><div class="knob-host" data-index="0" data-min="0" data-max="1" data-def="0.5"></div>
            <div class="lbl">Shape</div><div class="num num-host"></div></div>
          <div class="cell"><div class="knob-host endless" data-index="1" data-endless="1" data-def="0"></div>
            <div class="lbl">Phase</div><div class="sub">endless</div></div>
          <div class="cell"><div class="seg-host" data-index="2"
                 data-options="Sine,Saw,Square,Tri"></div><div class="lbl">Waveform</div></div>
          <div class="cell"><div class="step-host" data-index="3" data-min="-4" data-max="4" data-def="0" data-step="1" data-suffix=" oct"></div>
            <div class="lbl">Octave</div></div>
        </div>
      </div>
      <div class="panel"><div class="head"><span class="caret">▾</span>Wavetable</div>
        <div class="body">
          <div class="disp wavetable-host" data-index="4" style="width:200px;height:120px"><span class="tag">Table</span></div>
          <div class="cell"><div class="fader-host" data-orient="v" data-index="5" data-min="0" data-max="1" data-def="0.3"></div>
            <div class="lbl">Position</div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- ============================= FILTER PAGE =========================== -->
  <div class="page" id="page-filter">
    <div class="row">
      <div class="panel"><div class="head"><span class="caret">▾</span>Filter</div>
        <div class="body">
          <!-- knob with a modulation ring (data-mod = simulated modulated value) -->
          <div class="cell"><div class="knob-host" data-index="6" data-min="20" data-max="20000"
                 data-def="1200" data-log="1" data-mod="0.18" data-suffix=" Hz"></div>
            <div class="lbl">Cutoff</div><div class="num num-host"></div></div>
          <div class="cell"><div class="knob-host" data-index="7" data-min="0" data-max="1" data-def="0.2" data-mod="-0.1"></div>
            <div class="lbl">Reso</div><div class="num num-host"></div></div>
          <div class="cell"><div class="seg-host" data-index="8" data-options="LP,HP,BP,Notch"></div>
            <div class="lbl">Type</div></div>
        </div>
      </div>
      <div class="panel"><div class="head">Response</div>
        <div class="body">
          <div class="disp curve-host" data-cutoff="6" data-reso="7" data-type="8"
               style="width:230px;height:120px"><span class="tag">Filter</span><span class="rd"></span></div>
        </div>
      </div>
      <div class="panel"><div class="head">Performance</div>
        <div class="body">
          <div class="cell"><div class="xy-host" data-x="6" data-y="7" style="width:120px;height:120px"></div>
            <div class="lbl">Cutoff × Reso</div></div>
          <div class="cell"><select class="sel sel-host" data-index="9"
               data-options="LFO 1,LFO 2,Env 2,Velocity,Mod Wheel,Random"></select>
            <div class="lbl">Mod source</div></div>
        </div>
      </div>
    </div>
  </div>

  <!-- ============================ ENV / MOD PAGE ========================= -->
  <div class="page" id="page-mod">
    <div class="row">
      <div class="panel"><div class="head">Amp Envelope</div>
        <div class="body">
          <div class="disp adsr-host" data-a="10" data-d="11" data-s="12" data-r="13"
               style="width:260px;height:120px"><span class="tag">ADSR</span></div>
        </div>
      </div>
      <div class="panel"><div class="head">LFO 1</div>
        <div class="body">
          <div class="disp lfo-host" data-shape="14" style="width:160px;height:90px"><span class="tag">LFO</span></div>
          <div class="cell"><div class="seg-host" data-index="14" data-options="Sin,Tri,Saw,Sqr,S&amp;H"></div>
            <div class="lbl">Shape</div></div>
          <div class="cell"><div class="knob-host" data-index="15" data-min="0.01" data-max="20" data-def="2"
                 data-log="1" data-suffix=" Hz"></div><div class="lbl">Rate</div><div class="num num-host"></div></div>
        </div>
      </div>
    </div>
    <div class="row" style="margin-top:10px">
      <div class="panel"><div class="head">Modulation Matrix</div>
        <div class="body"><div class="mtx-host"
             data-sources="LFO 1,LFO 2,Env 2,Vel"
             data-dests="Cutoff,Reso,Pitch,Amp,Pan"></div></div>
      </div>
    </div>
  </div>

  <!-- =============================== FX PAGE ============================= -->
  <div class="page" id="page-fx">
    <div class="row">
      <div class="panel"><div class="head">Drive</div>
        <div class="body">
          <div class="cell"><div class="knob-host" data-index="16" data-min="0" data-max="1" data-def="0.3"></div>
            <div class="lbl">Drive</div><div class="num num-host"></div></div>
          <div class="cell"><div class="knob-host" data-index="17" data-min="0" data-max="1" data-def="0.5"></div>
            <div class="lbl">Mix</div><div class="num num-host"></div></div>
          <div class="cell"><button class="btn toggle-host" data-index="18">Bypass</button><div class="lbl">Toggle</div></div>
          <div class="cell"><button class="btn momentary-host" data-index="19">Freeze</button><div class="lbl">Momentary</div></div>
        </div>
      </div>
      <div class="panel"><div class="head">Output</div>
        <div class="body">
          <div class="cell"><div class="fader-host" data-orient="h" data-index="20" data-min="0" data-max="1" data-def="0.7"></div>
            <div class="lbl">Level</div><div class="num num-host"></div></div>
          <div class="cell"><div class="meter-host" data-stereo="1"></div><div class="lbl">Meter</div></div>
        </div>
      </div>
    </div>
    <div class="row" style="margin-top:10px">
      <div class="panel" style="flex:1"><div class="head">Oscilloscope</div>
        <div class="body"><div class="disp scope-host" style="width:100%;height:110px"></div></div></div>
      <div class="panel" style="flex:1"><div class="head">Spectrum</div>
        <div class="body"><div class="disp spectrum-host" style="width:100%;height:110px"></div></div></div>
    </div>
  </div>

  <!-- ============================ SEQ / KEYS PAGE ======================== -->
  <div class="page" id="page-seq">
    <div class="row">
      <div class="panel" style="flex:1"><div class="head">Step Sequencer</div>
        <div class="body" style="display:block">
          <div class="seq-host" data-base="21" data-steps="16"></div>
          <div class="row" style="margin-top:10px">
            <div class="cell"><div class="seg-host" data-index="37" data-options="Up,Down,U/D,Rand"></div>
              <div class="lbl">Arp mode</div></div>
            <div class="cell"><select class="sel sel-host" data-index="38"
                 data-options="1/4,1/8,1/8T,1/16,1/16T,1/32"></select><div class="lbl">Rate</div></div>
            <div class="cell"><div class="step-host" data-index="39" data-min="1" data-max="4" data-def="1" data-step="1" data-suffix=" oct"></div>
              <div class="lbl">Range</div></div>
            <div class="cell"><button class="btn toggle-host" data-index="40">Hold</button><div class="lbl">Latch</div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="row" style="margin-top:10px">
      <div class="panel" style="flex:1"><div class="head">Keyboard</div>
        <div class="body" style="display:block"><div class="piano" id="kbd"></div></div></div>
    </div>
  </div>
</div>

<!-- preset list lives outside the bar so it can overlay; populated by JS -->
<div class="plist" id="presetList" style="position:fixed;top:34px;left:60px;width:240px;display:none;z-index:40"></div>

<script>
"use strict";
/* ===================================================================== *
 *  ENGINE BRIDGE — never touch window.vstai before it exists.            *
 * ===================================================================== */
function whenReady(cb){
  function go(){ (window.vstai.onReady ? window.vstai.onReady(cb) : cb()); }
  if (window.vstai) return go();
  const t=setInterval(()=>{ if(window.vstai){ clearInterval(t); go(); } },25);
}
const setParam=(i,v)=>{ if(window.vstai) window.vstai.setParam(i,v); };
const onParam =(cb)=>{ if(window.vstai&&window.vstai.onParam) window.vstai.onParam(cb); };
const noteOn  =(n,v)=>{ if(window.vstai&&window.vstai.noteOn ) window.vstai.noteOn(n,v); };
const noteOff =(n)  =>{ if(window.vstai&&window.vstai.noteOff) window.vstai.noteOff(n); };
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmt=v=>Math.abs(v)>=1000?Math.round(v).toLocaleString():Math.abs(v)>=100?Math.round(v):Math.abs(v)>=10?v.toFixed(1):v.toFixed(2);
const ns="http://www.w3.org/2000/svg";
const svgEl=(t,a)=>{ const e=document.createElementNS(ns,t); for(const k in a) e.setAttribute(k,a[k]); return e; };

/* ===================================================================== *
 *  SHARED: tooltip + right-click context menu.                          *
 *  A real plugin's perceived quality leans heavily on these — right-     *
 *  click any continuous control for reset / fine / MIDI-learn / assign.  *
 * ===================================================================== */
const tip=document.createElement("div"); tip.className="tip"; document.body.append(tip);
function showTip(t,x,y){ tip.textContent=t; tip.style.left=(x+12)+"px"; tip.style.top=(y+14)+"px"; tip.classList.add("show"); }
function hideTip(){ tip.classList.remove("show"); }
function bindTip(el,text){
  el.addEventListener("pointerenter",e=>showTip(typeof text==="function"?text():text,e.clientX,e.clientY));
  el.addEventListener("pointermove",e=>{ if(tip.classList.contains("show")) showTip(typeof text==="function"?text():text,e.clientX,e.clientY); });
  el.addEventListener("pointerleave",hideTip);
}
document.querySelectorAll("[data-tip]").forEach(el=>bindTip(el,el.dataset.tip));

let openMenu=null;
function closeMenu(){ if(openMenu){ openMenu.remove(); openMenu=null; } }
addEventListener("pointerdown",e=>{ if(openMenu&&!openMenu.contains(e.target)) closeMenu(); },true);
function contextMenu(x,y,items){
  closeMenu(); hideTip();
  const m=document.createElement("div"); m.className="menu";
  items.forEach(it=>{
    if(it==="-"){ const s=document.createElement("div"); s.className="sep"; m.append(s); return; }
    const d=document.createElement("div"); d.className="mi"; d.textContent=it.label;
    d.onclick=()=>{ closeMenu(); it.fn&&it.fn(); }; m.append(d);
  });
  m.style.left=x+"px"; m.style.top=y+"px"; document.body.append(m); openMenu=m;
  const r=m.getBoundingClientRect();
  if(r.right>innerWidth)  m.style.left=(innerWidth-r.width-4)+"px";
  if(r.bottom>innerHeight)m.style.top=(innerHeight-r.height-4)+"px";
}

/* ===================================================================== *
 *  KNOB — bounded + endless, fine-drag (shift), wheel, dbl-click reset,  *
 *  hover/drag readout, modulation ring, tooltip, right-click menu.       *
 * ===================================================================== */
function makeKnob(host){
  const i=+host.dataset.index, def=+host.dataset.def||0,
        endless=host.dataset.endless==="1",
        min=endless?0:+host.dataset.min, max=endless?1:+host.dataset.max,
        log=host.dataset.log==="1", suffix=host.dataset.suffix||"",
        modDepth=host.dataset.mod!=null?+host.dataset.mod:null;   // demo modulation amount
  const num=host.parentElement.querySelector(".num-host");
  const sz=host.dataset.size?+host.dataset.size:54;
  host.style.width=host.style.height=sz+"px";
  const svg=svgEl("svg",{class:"knob"+(endless?" endless":""),viewBox:"0 0 100 100",width:sz,height:sz});
  if(endless) svg.style.cursor="ns-resize";
  const a0=135,a1=405,R=38;
  const polar=(deg,r)=>[50+r*Math.cos(deg*Math.PI/180),50+r*Math.sin(deg*Math.PI/180)];
  const arcPath=(from,to,r)=>{ const[sx,sy]=polar(from,r),[ex,ey]=polar(to,r);
    return `M ${sx} ${sy} A ${r} ${r} 0 ${to-from>180?1:0} 1 ${ex} ${ey}`; };
  svg.append(svgEl("circle",{class:"face",cx:50,cy:50,r:R-6}));
  svg.append(svgEl("path",{class:"track",d:arcPath(a0,a1,R)}));
  const modArc=svgEl("path",{class:"mod"}); if(modDepth!=null) svg.append(modArc);
  const arc=svgEl("path",{class:"arc"}); const ind=svgEl("line",{class:"ind"});
  svg.append(arc,ind); host.append(svg);

  const toNorm=v=>log?Math.log(v/min)/Math.log(max/min):(v-min)/(max-min);
  const fromNorm=n=>log?min*Math.pow(max/min,n):min+n*(max-min);
  let value=def;
  const readout=()=>endless?"∞":(fmt(value)+suffix);
  function render(){
    const n=clamp(endless?(value%1+1)%1:toNorm(value),0,1), ang=a0+n*(a1-a0);
    arc.setAttribute("d",arcPath(a0,ang,R));
    const[ix,iy]=polar(ang,14),[ox,oy]=polar(ang,R-1);
    ind.setAttribute("x1",ix);ind.setAttribute("y1",iy);ind.setAttribute("x2",ox);ind.setAttribute("y2",oy);
    if(modDepth!=null){ const m=clamp(n+modDepth,0,1), mang=a0+m*(a1-a0);
      modArc.setAttribute("d",arcPath(Math.min(ang,mang),Math.max(ang,mang),R)); }
    if(num) num.textContent=readout();
  }
  function set(v){ value=endless?v:clamp(v,min,max); render(); setParam(i,endless?((value%1+1)%1):value); }
  let drag=null;
  svg.addEventListener("pointerdown",e=>{
    if(e.button!==0) return;
    drag={y:e.clientY,n:endless?value:clamp(toNorm(value),0,1),fine:e.shiftKey};
    svg.setPointerCapture(e.pointerId); showTip(readout(),e.clientX,e.clientY);
  });
  svg.addEventListener("pointermove",e=>{ if(!drag) return;
    const speed=(e.shiftKey?900:200), dn=(drag.y-e.clientY)/speed;
    if(endless) set(drag.n+dn); else set(fromNorm(clamp(drag.n+dn,0,1)));
    showTip(readout(),e.clientX,e.clientY);
  });
  const end=()=>{ if(drag){ drag=null; hideTip(); } };
  svg.addEventListener("pointerup",end); svg.addEventListener("pointercancel",end);
  svg.addEventListener("wheel",e=>{ e.preventDefault();
    if(endless) set(value-Math.sign(e.deltaY)*0.02);
    else set(fromNorm(clamp(toNorm(value)-Math.sign(e.deltaY)*(e.shiftKey?0.005:0.025),0,1)));
  },{passive:false});
  svg.addEventListener("dblclick",()=>set(def));
  bindTip(svg,readout);
  svg.addEventListener("contextmenu",e=>{ e.preventDefault();
    contextMenu(e.clientX,e.clientY,[
      {label:"Reset to default",fn:()=>set(def)},
      {label:"Set to minimum",fn:()=>set(endless?0:min)},
      {label:"Set to maximum",fn:()=>set(endless?1:max)},
      "-",
      {label:"MIDI learn",fn:()=>window.vstai&&window.vstai.midiLearn&&window.vstai.midiLearn(i)},
      {label:"Assign modulation",fn:()=>{}},
    ]);
  });
  onParam((p,v)=>{ if(p===i){ value=endless?+v:clamp(+v,min,max); render(); } });
  set(def);
}

/* ===================================================================== *
 *  FADER — vertical or horizontal (data-orient="v"|"h").                 *
 * ===================================================================== */
function makeFader(host){
  const i=+host.dataset.index,min=+host.dataset.min,max=+host.dataset.max,def=+host.dataset.def,
        horiz=host.dataset.orient==="h", suffix=host.dataset.suffix||"";
  const num=host.parentElement.querySelector(".num-host");
  host.classList.add("fader",horiz?"h":"v");
  const fill=document.createElement("div"); fill.className="fill";
  const cap=document.createElement("div"); cap.className="cap"; host.append(fill,cap);
  let value=def;
  function render(){ const n=clamp((value-min)/(max-min),0,1);
    if(horiz){ fill.style.width=(n*100)+"%"; cap.style.left="calc("+(n*100)+"% - 1px)"; }
    else     { fill.style.height=(n*100)+"%"; cap.style.bottom="calc("+(n*100)+"% - 1px)"; }
    if(num) num.textContent=fmt(value)+suffix; }
  function set(v){ value=clamp(v,min,max); render(); setParam(i,value); }
  let drag=false;
  const fromPt=e=>{ const r=host.getBoundingClientRect();
    return horiz?min+(max-min)*clamp((e.clientX-r.left)/r.width,0,1)
                :min+(max-min)*clamp(1-(e.clientY-r.top)/r.height,0,1); };
  host.addEventListener("pointerdown",e=>{ if(e.button!==0)return; drag=true; host.setPointerCapture(e.pointerId); set(fromPt(e)); });
  host.addEventListener("pointermove",e=>{ if(drag) set(fromPt(e)); });
  host.addEventListener("pointerup",()=>drag=false);
  host.addEventListener("dblclick",()=>set(def));
  bindTip(host,()=>fmt(value)+suffix);
  host.addEventListener("contextmenu",e=>{ e.preventDefault();
    contextMenu(e.clientX,e.clientY,[{label:"Reset to default",fn:()=>set(def)},{label:"MIDI learn",fn:()=>{}}]); });
  onParam((p,v)=>{ if(p===i){ value=clamp(+v,min,max); render(); } });
  set(def);
}

/* ===================================================================== *
 *  TOGGLE (latch 0/1) and MOMENTARY (1 while held).                      *
 * ===================================================================== */
function makeToggle(b){ const i=+b.dataset.index; let on=false;
  const upd=()=>{ b.classList.toggle("on",on); setParam(i,on?1:0); };
  b.addEventListener("click",()=>{ on=!on; upd(); }); upd();
  onParam((p,v)=>{ if(p===i){ on=+v>=0.5; b.classList.toggle("on",on); } });
}
function makeMomentary(b){ const i=+b.dataset.index;
  const dn=()=>{ b.classList.add("on"); setParam(i,1); };
  const up=()=>{ b.classList.remove("on"); setParam(i,0); };
  let pressed=false;
  const press=()=>{ pressed=true; dn(); };
  const release=()=>{ if(!pressed) return; pressed=false; up(); };
  b.addEventListener("pointerdown",press);
  b.addEventListener("pointerup",release); b.addEventListener("pointerleave",release);
  // WKWebView can drop the element's pointerup, so also catch the release on window
  // (mouseup still fires) and on blur — otherwise a momentary button sticks "on".
  addEventListener("pointerup",release,true); addEventListener("mouseup",release,true);
  addEventListener("pointercancel",release,true); addEventListener("blur",release);
}

/* ===================================================================== *
 *  SEGMENTED SELECTOR / RADIO — small fixed option sets.                 *
 * ===================================================================== */
function makeSegmented(host){
  const i=+host.dataset.index, opts=host.dataset.options.split(",");
  host.classList.add("seg");
  let sel=0;
  opts.forEach((o,k)=>{ const b=document.createElement("button"); b.textContent=o;
    b.onclick=()=>{ sel=k; upd(); }; host.append(b); });
  function upd(){ [...host.children].forEach((b,k)=>b.classList.toggle("on",k===sel));
    setParam(i, opts.length>1?sel/(opts.length-1):0); }
  upd();
  onParam((p,v)=>{ if(p===i){ sel=Math.round(+v*(opts.length-1)); upd(); } });
}

/* ===================================================================== *
 *  DROPDOWN / COMBO — longer lists (presets, mod destinations).          *
 * ===================================================================== */
function makeSelect(host){
  const i=+host.dataset.index, opts=host.dataset.options.split(",");
  opts.forEach((o,k)=>{ const op=document.createElement("option"); op.value=k; op.textContent=o; host.append(op); });
  host.onchange=()=>setParam(i, opts.length>1?(+host.value)/(opts.length-1):0);
  setParam(i,0);
  onParam((p,v)=>{ if(p===i) host.value=Math.round(+v*(opts.length-1)); });
}

/* ===================================================================== *
 *  STEPPER — integer steps (octave, voice count, semitone).              *
 * ===================================================================== */
function makeStepper(host){
  const i=+host.dataset.index,min=+host.dataset.min,max=+host.dataset.max,
        def=+host.dataset.def,step=+host.dataset.step||1,suffix=host.dataset.suffix||"";
  host.classList.add("step");
  const dec=document.createElement("button"); dec.textContent="−";
  const val=document.createElement("div"); val.className="v";
  const inc=document.createElement("button"); inc.textContent="+";
  host.append(dec,val,inc);
  let value=def;
  const span=max-min;
  function set(v){ value=clamp(Math.round(v/step)*step,min,max); val.textContent=(value>0?"+":"")+value+suffix;
    setParam(i, span?(value-min)/span:0); }
  dec.onclick=()=>set(value-step); inc.onclick=()=>set(value+step);
  onParam((p,v)=>{ if(p===i){ value=Math.round(min+ +v*span); val.textContent=(value>0?"+":"")+value+suffix; } });
  set(def);
}

/* ===================================================================== *
 *  EDITABLE NUMERIC FIELD — type an exact value into a .num readout.     *
 *  Knobs/faders already write into their sibling .num-host; make those   *
 *  click-to-edit so a typed value feeds back to the control.            *
 * ===================================================================== */
function makeNumEditable(num){
  num.contentEditable="true"; num.spellcheck=false;
  num.addEventListener("focus",()=>getSelection().selectAllChildren(num));
  num.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); num.blur(); } });
  num.addEventListener("blur",()=>{
    const v=parseFloat(num.textContent.replace(/[^0-9.\-]/g,""));
    if(!isNaN(v)&&num._apply) num._apply(v);
  });
}

/* ===================================================================== *
 *  XY PAD — two params, crosshair, draggable point.                      *
 * ===================================================================== */
function makeXY(host){
  const ix=+host.dataset.x, iy=+host.dataset.y;
  host.classList.add("xy");
  const vline=document.createElement("div"); vline.className="ch"; vline.style.cssText+="top:0;bottom:0;width:1px";
  const hline=document.createElement("div"); hline.className="ch"; hline.style.cssText+="left:0;right:0;height:1px";
  const pt=document.createElement("div"); pt.className="pt"; host.append(vline,hline,pt);
  let cx=0.5,cy=0.5,drag=false;
  function render(){ pt.style.left=(cx*100)+"%"; pt.style.top=(cy*100)+"%";
    vline.style.left=(cx*100)+"%"; hline.style.top=(cy*100)+"%"; }
  function set(e){ const r=host.getBoundingClientRect();
    cx=clamp((e.clientX-r.left)/r.width,0,1); cy=clamp((e.clientY-r.top)/r.height,0,1);
    render(); setParam(ix,cx); setParam(iy,1-cy); }
  host.addEventListener("pointerdown",e=>{ if(e.button!==0)return; drag=true; host.setPointerCapture(e.pointerId); set(e); });
  host.addEventListener("pointermove",e=>{ if(drag) set(e); });
  host.addEventListener("pointerup",()=>drag=false);
  onParam((p,v)=>{ if(p===ix){ cx=clamp(+v,0,1); render(); } else if(p===iy){ cy=clamp(1-(+v),0,1); render(); } });
  render();
}

/* ===================================================================== *
 *  HI-DPI CANVAS HELPERS for every display widget.                       *
 * ===================================================================== */
function dispCanvas(host){
  let c=host.querySelector("canvas");
  if(!c){ c=document.createElement("canvas"); host.append(c); }
  const fit=()=>{ const dpr=devicePixelRatio||1, w=host.clientWidth, h=host.clientHeight;
    c.width=Math.round(w*dpr); c.height=Math.round(h*dpr);
    const ctx=c.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); c._w=w; c._h=h; };
  fit(); new ResizeObserver(fit).observe(host);
  return c.getContext("2d");
}
const vcol=(n,f)=>(getComputedStyle(document.body).getPropertyValue(n).trim())||f;
const vfresh=o=>o._t&&(performance.now()-o._t)<250;
function grid(ctx,W,H,cols,rows){ ctx.strokeStyle=vcol("--line","#222"); ctx.lineWidth=1; ctx.beginPath();
  for(let k=1;k<cols;k++){ const x=Math.round(W*k/cols)+.5; ctx.moveTo(x,0); ctx.lineTo(x,H); }
  for(let k=1;k<rows;k++){ const y=Math.round(H*k/rows)+.5; ctx.moveTo(0,y); ctx.lineTo(W,y); } ctx.stroke(); }

/* ---- OSCILLOSCOPE — thin line, no glow ---------------------------------- */
function makeScope(host){
  const ctx=dispCanvas(host); const c=ctx.canvas;
  const N=320; let data=new Float32Array(N),ph=0; const api={push(a){data=a;api._t=performance.now();}}; host.viz=api;
  (function loop(){ const W=c._w,H=c._h;
    if(!vfresh(api)){ ph+=0.04; for(let k=0;k<N;k++){ const t=k/N*Math.PI*6+ph;
      data[k]=(Math.sin(t)*0.6+Math.sin(t*2+ph*1.3)*0.22+Math.sin(t*3)*0.12)*(0.8+0.2*Math.sin(ph)); } }
    ctx.clearRect(0,0,W,H); grid(ctx,W,H,8,4);
    ctx.strokeStyle=vcol("--accent","#c8923a"); ctx.lineWidth=1.25; ctx.beginPath();
    for(let k=0;k<data.length;k++){ const x=k/(data.length-1)*W,y=H/2-data[k]*H*0.42; k?ctx.lineTo(x,y):ctx.moveTo(x,y); }
    ctx.stroke(); requestAnimationFrame(loop); })();
}
/* ---- SPECTRUM — thin bars, peak caps ------------------------------------ */
function makeSpectrum(host){
  const ctx=dispCanvas(host); const c=ctx.canvas;
  const N=48; let mags=new Float32Array(N),peaks=new Float32Array(N),ph=0;
  const api={push(a){mags=a;api._t=performance.now();}}; host.viz=api;
  (function loop(){ const W=c._w,H=c._h;
    if(!vfresh(api)){ ph+=0.03; for(let k=0;k<N;k++){ const f=k/N;
      mags[k]=Math.max(0,Math.pow(1-f,0.7)*(0.45+0.45*Math.sin(ph*2+k*0.5))+0.02*Math.sin(k*12.9)); } }
    ctx.clearRect(0,0,W,H); grid(ctx,W,H,8,4);
    ctx.fillStyle=vcol("--accent","#c8923a"); const bw=W/N;
    for(let k=0;k<N;k++){ const v=Math.min(1,mags[k]),bh=v*(H-4); ctx.fillRect(k*bw+1,H-bh,bw-1.5,bh);
      peaks[k]=Math.max(peaks[k]-0.8,bh); ctx.fillStyle=vcol("--ink-2","#9a9b9e");
      ctx.fillRect(k*bw+1,H-peaks[k]-1,bw-1.5,1); ctx.fillStyle=vcol("--accent","#c8923a"); }
    requestAnimationFrame(loop); })();
}
/* ---- LEVEL METER — DOM, stereo, peak hold ------------------------------- */
function makeMeter(host){
  const stereo=host.dataset.stereo==="1"; host.classList.add("meter");
  const chans=[]; for(let k=0;k<(stereo?2:1);k++){ const ch=document.createElement("div"); ch.className="ch";
    const fl=document.createElement("div"); fl.className="fl"; const pk=document.createElement("div"); pk.className="pk";
    ch.append(fl,pk); host.append(ch); chans.push({fl,pk,peak:0}); }
  let lv=[0,0],ph=0; const api={setLevel(l,r){lv=[l,r==null?l:r];api._t=performance.now();}}; host.viz=api;
  (function loop(){ if(!vfresh(api)){ ph+=0.05; lv=[0.4+0.5*Math.abs(Math.sin(ph)),0.4+0.5*Math.abs(Math.sin(ph*1.1+1))]; }
    chans.forEach((c,k)=>{ const v=clamp(lv[k]||0,0,1); c.fl.style.height=(v*100)+"%";
      c.fl.style.background= v>0.92?vcol("--warn","#c75d52"):v>0.75?vcol("--accent","#c8923a"):vcol("--ok","#5fae7e");
      c.peak=Math.max(c.peak-0.012,v); c.pk.style.bottom=(c.peak*100)+"%"; });
    requestAnimationFrame(loop); })();
}

/* ---- FILTER RESPONSE CURVE — live from cutoff/reso/type params ---------- */
function makeFilterCurve(host){
  const ci=+host.dataset.cutoff, ri=+host.dataset.reso, ti=+host.dataset.type;
  const rd=host.querySelector(".rd"); const ctx=dispCanvas(host); const c=ctx.canvas;
  let cut=0.45,res=0.2,type=0;
  onParam((p,v)=>{ if(p===ci) cut=clamp((Math.log(+v/20)/Math.log(1000))*0.5+0.0,0,1); else if(p===ri) res=clamp(+v,0,1); else if(p===ti) type=Math.round(+v*3); });
  // approximate biquad magnitude so the curve reads as real
  function mag(f){ // f in 0..1 (log freq), fc cutoff in 0..1
    const fc=cut, q=0.5+res*8, d=(f-fc)*6;
    let lp=1/Math.sqrt(1+Math.pow(Math.max(0,d)*2,4));
    let hp=1/Math.sqrt(1+Math.pow(Math.max(0,-d)*2,4));
    const peak=res*1.1/(1+Math.pow(d*q*0.7,2));
    if(type===0) return clamp(lp+peak*0.6,0,1.3);          // LP
    if(type===1) return clamp(hp+peak*0.6,0,1.3);          // HP
    if(type===2) return clamp((1/(1+Math.pow(d*q,2)))+peak*0.3,0,1.3); // BP
    return clamp(1-1/(1+Math.pow(d*q,2))*0.95,0,1.3);      // Notch
  }
  (function loop(){ const W=c._w,H=c._h; ctx.clearRect(0,0,W,H); grid(ctx,W,H,8,4);
    ctx.strokeStyle=vcol("--accent","#c8923a"); ctx.lineWidth=1.5; ctx.beginPath();
    for(let x=0;x<=W;x++){ const m=mag(x/W),y=H-clamp(m/1.3,0,1)*(H-4)-2; x?ctx.lineTo(x,y):ctx.moveTo(x,y); }
    ctx.stroke();
    // soft fill under the curve
    ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
    ctx.fillStyle=vcol("--accent","#c8923a"); ctx.globalAlpha=0.10; ctx.fill(); ctx.globalAlpha=1;
    if(rd){ const fHz=Math.round(20*Math.pow(1000,cut/0.5)); rd.textContent=(fHz>=1000?(fHz/1000).toFixed(1)+"k":fHz)+" Hz"; }
    requestAnimationFrame(loop); })();
}

/* ---- LFO SHAPE DISPLAY — redraws when the shape param changes ----------- */
function makeLFO(host){
  const si=+host.dataset.shape; const ctx=dispCanvas(host); const c=ctx.canvas; let shape=0,ph=0;
  onParam((p,v)=>{ if(p===si) shape=Math.round(+v*4); });
  const wave=(t)=>{ t=(t%1+1)%1; switch(shape){
    case 0:return Math.sin(t*Math.PI*2);
    case 1:return t<0.5?(t*4-1):(3-t*4);                  // tri
    case 2:return t*2-1;                                   // saw
    case 3:return t<0.5?1:-1;                              // sqr
    default:return Math.sin(Math.floor(t*8)/8*Math.PI*2);  // S&H-ish
  }};
  (function loop(){ const W=c._w,H=c._h; ph+=0.01; ctx.clearRect(0,0,W,H); grid(ctx,W,H,4,2);
    ctx.strokeStyle=vcol("--accent-2","#5d83a8"); ctx.lineWidth=1.5; ctx.beginPath();
    for(let x=0;x<=W;x++){ const y=H/2-wave(x/W*2)*H*0.4; x?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.stroke();
    // moving phosphor dot showing the playhead
    const px=((ph%1))*W, py=H/2-wave(ph*2)*H*0.4;
    ctx.fillStyle=vcol("--accent","#c8923a"); ctx.beginPath(); ctx.arc(px,py,2,0,7); ctx.fill();
    requestAnimationFrame(loop); })();
}

/* ---- WAVETABLE — pseudo-3D stack of frames, scrubbed by position param -- */
function makeWavetable(host){
  const pi=+host.dataset.index; const ctx=dispCanvas(host); const c=ctx.canvas; let pos=0.3;
  onParam((p,v)=>{ if(p===pi) pos=clamp(+v,0,1); });
  const frame=(z)=>{ // morph between a few waveshapes across the table
    return (x)=>{ const a=Math.sin(x*Math.PI*2), b=(x*2-1), s=Math.sign(Math.sin(x*Math.PI*2));
      const seg=z*2; return seg<1?a*(1-seg)+b*seg : b*(2-seg)+s*(seg-1); }; };
  (function loop(){ const W=c._w,H=c._h; ctx.clearRect(0,0,W,H);
    const frames=14, dx=W*0.30/frames, dy=H*0.42/frames, x0=W*0.10, y0=H*0.74;
    for(let f=frames-1;f>=0;f--){ const z=f/(frames-1), sel=Math.abs(z-pos)<0.04;
      const fn=frame(z); ctx.beginPath();
      for(let s=0;s<=60;s++){ const x=x0+f*dx+s/60*(W*0.58), y=y0-f*dy-fn(s/60)*H*0.16;
        s?ctx.lineTo(x,y):ctx.moveTo(x,y); }
      ctx.strokeStyle=sel?vcol("--accent","#c8923a"):vcol("--line-2","#333");
      ctx.lineWidth=sel?1.6:1; ctx.globalAlpha=sel?1:0.35+0.4*z; ctx.stroke(); }
    ctx.globalAlpha=1; requestAnimationFrame(loop); })();
}

/* ---- ADSR ENVELOPE EDITOR — draggable A/D/S/R breakpoints --------------- */
function makeADSR(host){
  const ai=+host.dataset.a, di=+host.dataset.d, si=+host.dataset.s, ri=+host.dataset.r;
  const ctx=dispCanvas(host); const c=ctx.canvas;
  let a=0.15,d=0.25,s=0.6,r=0.4;                            // all 0..1
  onParam((p,v)=>{ if(p===ai)a=+v; else if(p===di)d=+v; else if(p===si)s=+v; else if(p===ri)r=+v; });
  setParam(ai,a);setParam(di,d);setParam(si,s);setParam(ri,r);
  const pad=8;
  function pts(W,H){ const w=W-pad*2,h=H-pad*2, segA=0.25,segD=0.25,segS=0.18,segR=0.32;
    const xA=pad+w*segA*a, xD=xA+w*segD*d, xS=xD+w*segS, xR=xS+w*segR*r;
    return [[pad,H-pad],[xA,pad],[xD,H-pad-h*s],[xS,H-pad-h*s],[xR,H-pad]]; }
  let drag=null;
  function nearest(mx,my,W,H){ const P=pts(W,H); let best=-1,bd=1e9;
    [1,2,4].forEach(idx=>{ const dx=P[idx][0]-mx,dy=P[idx][1]-my,dd=dx*dx+dy*dy; if(dd<bd){bd=dd;best=idx;} });
    return bd<400?best:-1; }
  host.style.cursor="pointer";
  host.addEventListener("pointerdown",e=>{ const r0=c.getBoundingClientRect(),W=c._w,H=c._h;
    drag=nearest(e.clientX-r0.left,e.clientY-r0.top,W,H); if(drag>=0) host.setPointerCapture(e.pointerId); });
  host.addEventListener("pointermove",e=>{ if(drag<0||drag==null) return;
    const r0=c.getBoundingClientRect(),W=c._w,H=c._h,w=W-pad*2,h=H-pad*2;
    const mx=clamp(e.clientX-r0.left,pad,W-pad), my=clamp(e.clientY-r0.top,pad,H-pad);
    if(drag===1){ a=clamp((mx-pad)/(w*0.25),0,1); setParam(ai,a); }
    else if(drag===2){ const xA=pad+w*0.25*a; d=clamp((mx-xA)/(w*0.25),0,1); s=clamp((H-pad-my)/h,0,1); setParam(di,d); setParam(si,s); }
    else if(drag===4){ const xS=pad+w*0.25*a+w*0.25*d+w*0.18; r=clamp((mx-xS)/(w*0.32),0,1); setParam(ri,r); } });
  host.addEventListener("pointerup",()=>drag=null);
  (function loop(){ const W=c._w,H=c._h; ctx.clearRect(0,0,W,H); grid(ctx,W,H,8,4);
    const P=pts(W,H);
    ctx.beginPath(); P.forEach((p,k)=>k?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
    ctx.strokeStyle=vcol("--accent","#c8923a"); ctx.lineWidth=1.5; ctx.stroke();
    ctx.lineTo(P[4][0],H-pad); ctx.lineTo(pad,H-pad); ctx.closePath();
    ctx.fillStyle=vcol("--accent","#c8923a"); ctx.globalAlpha=0.10; ctx.fill(); ctx.globalAlpha=1;
    [1,2,4].forEach(k=>{ ctx.beginPath(); ctx.arc(P[k][0],P[k][1],3.2,0,7);
      ctx.fillStyle=vcol("--track","#0d0d0d"); ctx.fill();
      ctx.lineWidth=1.5; ctx.strokeStyle=vcol("--ink","#d7d7d9"); ctx.stroke(); });
    requestAnimationFrame(loop); })();
}

/* ===================================================================== *
 *  MODULATION MATRIX — sources × destinations grid, drag a cell up/down  *
 *  to set bipolar depth. Param index = base + row*nDest + col.           *
 * ===================================================================== */
function makeModMatrix(host){
  const sources=host.dataset.sources.split(","), dests=host.dataset.dests.split(",");
  const base=host.dataset.base?+host.dataset.base:50;
  const tbl=document.createElement("table"); tbl.className="mtx";
  const thead=document.createElement("tr"); thead.append(document.createElement("th"));
  dests.forEach(d=>{ const th=document.createElement("th"); th.textContent=d; thead.append(th); });
  tbl.append(thead);
  sources.forEach((src,r)=>{ const tr=document.createElement("tr");
    const th=document.createElement("th"); th.className="src"; th.textContent=src; tr.append(th);
    dests.forEach((d,col)=>{ const td=document.createElement("td"); const fl=document.createElement("div"); fl.className="fl";
      td.append(fl); let depth=0; const pi=base+r*dests.length+col;
      const render=()=>{ const mag=Math.abs(depth); fl.style.height=(mag*100)+"%";
        td.classList.toggle("neg",depth<0); setParam(pi,(depth+1)/2); };
      let drag=null;
      td.addEventListener("pointerdown",e=>{ drag={y:e.clientY,d:depth}; td.setPointerCapture(e.pointerId); });
      td.addEventListener("pointermove",e=>{ if(!drag)return; depth=clamp(drag.d+(drag.y-e.clientY)/60,-1,1); render(); });
      td.addEventListener("pointerup",()=>drag=null);
      td.addEventListener("dblclick",()=>{ depth=0; render(); });
      bindTip(td,()=>`${src} → ${d}: ${depth>=0?"+":""}${Math.round(depth*100)}%`);
      render(); tr.append(td); });
    tbl.append(tr); });
  host.append(tbl);
}

/* ===================================================================== *
 *  STEP SEQUENCER — drag a step up/down for its value; right-click mutes. *
 *  Param index = base + step. A playhead sweeps for "alive" feedback.    *
 * ===================================================================== */
function makeSequencer(host){
  const base=+host.dataset.base, steps=+host.dataset.steps; host.classList.add("seq");
  const cells=[];
  for(let k=0;k<steps;k++){ const st=document.createElement("div"); st.className="st";
    const fl=document.createElement("div"); fl.className="fl"; st.append(fl);
    let v=0.2+0.6*Math.abs(Math.sin(k*1.3)), on=true; const pi=base+k;
    const render=()=>{ fl.style.height=(on?v*100:6)+"%"; st.classList.toggle("off",!on); setParam(pi,on?v:0); };
    let drag=null;
    st.addEventListener("pointerdown",e=>{ if(e.button!==0)return; const r=st.getBoundingClientRect();
      v=clamp(1-(e.clientY-r.top)/r.height,0,1); on=true; drag=true; st.setPointerCapture(e.pointerId); render(); });
    st.addEventListener("pointermove",e=>{ if(!drag)return; const r=st.getBoundingClientRect();
      v=clamp(1-(e.clientY-r.top)/r.height,0,1); render(); });
    st.addEventListener("pointerup",()=>drag=false);
    st.addEventListener("contextmenu",e=>{ e.preventDefault(); on=!on; render(); });
    render(); host.append(st); cells.push(st); }
  // playhead
  let cur=0; setInterval(()=>{ cells[cur].classList.remove("cur"); cur=(cur+1)%steps; cells[cur].classList.add("cur"); },220);
}

/* ===================================================================== *
 *  PRESET BROWSER — search, categories, favorites, prev/next.            *
 * ===================================================================== */
function makePresetBrowser(){
  const PRESETS=[
    {n:"Init",c:"Basic",f:false},{n:"Warm Pad",c:"Pad",f:true},{n:"Acid Bass",c:"Bass",f:false},
    {n:"Glass Keys",c:"Keys",f:true},{n:"Detuned Saw",c:"Lead",f:false},{n:"Sub Boom",c:"Bass",f:false},
    {n:"Vapor Pluck",c:"Pluck",f:false},{n:"Hoover",c:"Lead",f:false},{n:"Soft Strings",c:"Pad",f:true},
    {n:"FM Bell",c:"Keys",f:false},{n:"Noise Riser",c:"FX",f:false},{n:"Wobble",c:"Bass",f:false},
  ];
  const list=document.getElementById("presetList"), search=document.getElementById("presetSearch");
  let sel=0;
  function paint(){ const q=search.value.toLowerCase(); list.innerHTML="";
    PRESETS.forEach((p,k)=>{ if(q&&!p.n.toLowerCase().includes(q)&&!p.c.toLowerCase().includes(q)) return;
      const it=document.createElement("div"); it.className="it"+(k===sel?" on":"");
      const fav=document.createElement("span"); fav.className="fav"+(p.f?" y":""); fav.textContent=p.f?"★":"☆";
      fav.onclick=e=>{ e.stopPropagation(); p.f=!p.f; paint(); };
      const nm=document.createElement("span"); nm.textContent=p.n;
      const cat=document.createElement("span"); cat.className="cat"; cat.textContent=p.c;
      it.append(fav,nm,cat); it.onclick=()=>{ sel=k; load(k); list.style.display="none"; }; list.append(it); }); }
  function load(k){ sel=k; search.value=PRESETS[k].n;
    if(window.vstai&&window.vstai.loadPreset) window.vstai.loadPreset(PRESETS[k].n); }
  search.addEventListener("focus",()=>{ list.style.display="block"; paint(); });
  search.addEventListener("input",()=>{ list.style.display="block"; paint(); });
  addEventListener("pointerdown",e=>{ if(e.target!==search&&!list.contains(e.target)) list.style.display="none"; });
  document.querySelector(".preset-prev").onclick=()=>{ sel=(sel-1+PRESETS.length)%PRESETS.length; load(sel); };
  document.querySelector(".preset-next").onclick=()=>{ sel=(sel+1)%PRESETS.length; load(sel); };
  load(0);
}

/* ===================================================================== *
 *  PIANO — playable, calls noteOn/noteOff, highlights held keys.         *
 * ===================================================================== */
function makeKeyboard(host){
  const base=48, octaves=3, pattern=[0,2,4,5,7,9,11], blacks={1:0,3:1,6:3,8:4,10:5};
  const whites=[]; for(let o=0;o<octaves;o++) for(const s of pattern) whites.push(base+o*12+s);
  whites.forEach(n=>{ const k=document.createElement("div"); k.className="wk"; k.dataset.note=n; host.append(k); });
  const wpc=100/whites.length;
  for(let o=0;o<octaves;o++) for(const semi in blacks){ const n=base+o*12+ +semi;
    const k=document.createElement("div"); k.className="bk"; k.dataset.note=n;
    k.style.left=((blacks[semi]+o*7+1)*wpc-2.5)+"%"; host.append(k); }
  let down=null;
  const press=n=>{ noteOn(n,100); host.querySelector(`[data-note="${n}"]`)?.classList.add("down"); };
  const release=n=>{ noteOff(n); host.querySelector(`[data-note="${n}"]`)?.classList.remove("down"); };
  host.addEventListener("pointerdown",e=>{ const n=e.target.dataset.note; if(n){ down=+n; press(down); host.setPointerCapture(e.pointerId);} });
  host.addEventListener("pointerup",()=>{ if(down!=null){ release(down); down=null; } });
  host.addEventListener("pointerleave",()=>{ if(down!=null){ release(down); down=null; } });
  onParam(()=>{});  // (real builds may light keys from engine note events)
}

/* ===================================================================== *
 *  CONTAINERS — tabs (pages) + collapsible panels.                       *
 * ===================================================================== */
function setupTabs(){
  const tabs=[...document.querySelectorAll(".tab")];
  tabs.forEach(t=>t.onclick=()=>{ tabs.forEach(x=>x.classList.remove("on")); t.classList.add("on");
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("on"));
    document.getElementById("page-"+t.dataset.page).classList.add("on"); });
}
function setupCollapsibles(){
  document.querySelectorAll(".panel .caret").forEach(car=>{
    car.onclick=()=>car.closest(".panel").classList.toggle("collapsed");
  });
}

/* ===================================================================== *
 *  BOOT                                                                  *
 * ===================================================================== */
whenReady(()=>{
  setupTabs(); setupCollapsibles();
  document.querySelectorAll(".knob-host").forEach(makeKnob);
  document.querySelectorAll(".fader-host").forEach(makeFader);
  document.querySelectorAll(".toggle-host").forEach(makeToggle);
  document.querySelectorAll(".momentary-host").forEach(makeMomentary);
  document.querySelectorAll(".seg-host").forEach(makeSegmented);
  document.querySelectorAll(".sel-host").forEach(makeSelect);
  document.querySelectorAll(".step-host").forEach(makeStepper);
  document.querySelectorAll(".xy-host").forEach(makeXY);
  document.querySelectorAll(".scope-host").forEach(makeScope);
  document.querySelectorAll(".spectrum-host").forEach(makeSpectrum);
  document.querySelectorAll(".meter-host").forEach(makeMeter);
  document.querySelectorAll(".curve-host").forEach(makeFilterCurve);
  document.querySelectorAll(".lfo-host").forEach(makeLFO);
  document.querySelectorAll(".wavetable-host").forEach(makeWavetable);
  document.querySelectorAll(".adsr-host").forEach(makeADSR);
  document.querySelectorAll(".mtx-host").forEach(makeModMatrix);
  document.querySelectorAll(".seq-host").forEach(makeSequencer);
  makePresetBrowser();
  makeKeyboard(document.getElementById("kbd"));   // remove for an effect with no keyboard

  // numeric readouts under knobs/faders are click-to-edit; wire them to their control
  document.querySelectorAll(".num-host").forEach(num=>{ makeNumEditable(num); });

  // header LED demo: blink to look alive; real builds drive from signal state
  const led=document.getElementById("sigLed"); let lp=0;
  setInterval(()=>{ lp+=0.1; led.classList.toggle("on",Math.sin(lp)>-0.3); },120);
  document.getElementById("themeBtn").onclick=()=>document.body.classList.toggle("light");
  const ab=document.getElementById("abBtn"); ab.onclick=()=>ab.textContent=ab.textContent==="A"?"B":"A";
});
</script>
</body>
</html>
)HTML";
    }

    // The house-style kit served three ways (starter preview, prompt reference,
    // seed of the editable "Standard UI" tab). Source of truth is the on-disk
    // ui/standard.html; the baked copy above is the fallback. Read once and cached
    // (this is called per generation to build the prompt, so avoid re-reading disk).
    inline juce::String defaultStandardUiHtml()
    {
        static const juce::String html = []
        {
            auto fromFile = vstai::webassets::readText ("standard.html");
            return fromFile.isNotEmpty() ? fromFile : juce::String (bakedStandardUiHtml());
        }();
        return html;
    }
}
