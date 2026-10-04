export default {
 "name": "StdMultiFilter",
 "isInstrument": false,
 "subtitle": "Multimode state-variable filter",
 "category": "Filters",
 "explanation": "A 12 dB per octave multimode state-variable filter (zero-delay-feedback topology) with low-pass, high-pass, band-pass and notch outputs, a resonance control that runs from gentle to near self-oscillation, and an input drive that saturates the signal before it enters the filter. The cutoff stays stable and well behaved when swept quickly. A live response curve shows the selected mode.",
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
   "Cutoff",
   0,
   1,
   0.55,
   0,
   {
    "hz": [
     20,
     18000
    ]
   }
  ],
  [
   "Resonance",
   0,
   1,
   0.3
  ],
  [
   "Drive",
   0,
   1,
   0.1
  ],
  [
   "Mode",
   0,
   3,
   0,
   1,
   [
    "Low-pass",
    "High-pass",
    "Band-pass",
    "Notch"
   ]
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
   "title": "FILTER",
   "items": [
    {
     "k": "seg",
     "i": 3,
     "label": "MODE",
     "opts": [
      "LOW-PASS",
      "HIGH-PASS",
      "BAND-PASS",
      "NOTCH"
     ]
    },
    {
     "k": "knob",
     "i": [
      0,
      1,
      2
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
      4,
      5
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "SVF RESPONSE",
 "vizCode": "frame(cx,r);\nvar fc=20*Math.pow(900,V[0]),q=0.5+V[1]*V[1]*20,md=Math.round(V[3]);\nplot(cx,r,function(f){return bqMag(md,fc,q,0,f)},20,20000,-60,30,true);",
 "testParams": {
  "1": 0.5
 }
};
