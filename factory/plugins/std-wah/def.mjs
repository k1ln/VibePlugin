export default {
 "name": "StdWah",
 "isInstrument": false,
 "subtitle": "Wah pedal: manual, auto or LFO",
 "category": "Filters",
 "explanation": "A wah-wah filter built on a resonant band-pass. In Manual mode the Pedal knob is the foot position (automate it or map it to a controller); in Auto mode an envelope follower sweeps the filter with your playing dynamics (Sensitivity sets how far, Decay how quickly it falls back); in LFO mode a sine sweeps it at a fixed rate. Low and High set the bottom and top of the sweep and Resonance sets how vocal the peak is.",
 "theme": {
  "accent": "#ffb347",
  "accent2": "#ffe2b0",
  "bg1": "#3a2410",
  "bg2": "#120a04",
  "panel": "#241608",
  "ink": "#fbeedd",
  "dim": "#b79a78"
 },
 "params": [
  [
   "Mode",
   0,
   2,
   0,
   1,
   [
    "Manual",
    "Auto",
    "LFO"
   ]
  ],
  [
   "Pedal",
   0,
   1,
   0.5
  ],
  [
   "Low",
   0,
   1,
   0.3,
   0,
   {
    "hz": [
     200,
     900
    ]
   }
  ],
  [
   "High",
   0,
   1,
   0.55,
   0,
   {
    "hz": [
     900,
     4500
    ]
   }
  ],
  [
   "Resonance",
   0,
   1,
   0.55
  ],
  [
   "Sensitivity",
   0,
   1,
   0.6
  ],
  [
   "Decay",
   0,
   1,
   0.4
  ],
  [
   "Rate",
   0,
   1,
   0.4,
   0,
   {
    "exp": [
     0.2,
     8
    ],
    "unit": " Hz"
   }
  ],
  [
   "Mix",
   0,
   1,
   1
  ],
  [
   "Output",
   -24,
   12,
   0,
   0,
   "db"
  ]
 ],
 "groups": [
  {
   "title": "SWEEP",
   "items": [
    {
     "k": "seg",
     "i": 0,
     "label": "MODE",
     "opts": [
      "MANUAL",
      "AUTO",
      "LFO"
     ]
    },
    {
     "k": "knob",
     "i": [
      1,
      2,
      3,
      4
     ]
    }
   ]
  },
  {
   "title": "AUTO / LFO",
   "items": [
    {
     "k": "knob",
     "i": [
      5,
      6,
      7
     ]
    }
   ]
  },
  {
   "title": "OUTPUT",
   "items": [
    {
     "k": "knob",
     "i": [
      8,
      9
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "WAH POSITION",
 "vizCode": "frame(cx,r);\nvar lo=200*Math.pow(4.5,V[2]),hi=900*Math.pow(5,V[3]),q=1+V[4]*9,pos=Math.round(V[0])===0?V[1]:Math.min(1,Math.max(0,disp[2]));\nvar fc=lo*Math.pow(hi/lo,pos);\nplot(cx,r,function(f){return bqMag(2,fc,q,0,f)+6},20,20000,-50,24,true);\ncx.fillStyle=\"#fff\";cx.globalAlpha=.5;cx.fillRect(r[0]+r[2]*Math.log(fc/20)/Math.log(1000)-1,r[1],2,r[3]);cx.globalAlpha=1;",
 "testParams": {
  "0": 1,
  "1": 0.5
 },
 "reactPatches": [
  {
   "0": 0
  },
  {
   "0": 2
  }
 ],
 "reactInput": "bursts"
};
