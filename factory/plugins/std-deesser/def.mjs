export default {
 "name": "StdDeEsser",
 "isInstrument": false,
 "subtitle": "Split-band sibilance reducer",
 "category": "Dynamics",
 "explanation": "A de-esser that tames harsh 's' and 't' sounds in vocals. A band-pass detector tuned to the Frequency watches for sibilance; when it rises above the Threshold the gain is reduced (up to the Range) in just that band (Split mode, which leaves the rest of the voice untouched) or across the whole signal (Wide mode). Release controls how quickly the reduction lets go, and Listen solos the sibilance band so you can tune the Frequency by ear. The picture shows the response with the live reduction applied.",
 "theme": {
  "accent": "#8fe388",
  "accent2": "#d6f7d2",
  "bg1": "#163a16",
  "bg2": "#061406",
  "panel": "#0e260e",
  "ink": "#e6f8e4",
  "dim": "#85b082"
 },
 "params": [
  [
   "Frequency",
   0,
   1,
   0.5,
   0,
   {
    "exp": [
     2000,
     12000
    ],
    "unit": " Hz"
   }
  ],
  [
   "Threshold",
   -50,
   0,
   -28,
   0,
   {
    "unit": " dB",
    "scale": [
     -50,
     0
    ]
   }
  ],
  [
   "Range",
   0,
   24,
   10,
   0,
   {
    "unit": " dB",
    "scale": [
     0,
     24
    ]
   }
  ],
  [
   "Mode",
   0,
   1,
   0,
   1,
   [
    "Split",
    "Wide"
   ]
  ],
  [
   "Release",
   0,
   1,
   0.4,
   0,
   {
    "exp": [
     5,
     200
    ],
    "unit": " ms"
   }
  ],
  [
   "Listen",
   0,
   1,
   0,
   1,
   [
    "Off",
    "On"
   ]
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
   "title": "DETECTION",
   "items": [
    {
     "k": "seg",
     "i": 3,
     "label": "MODE",
     "opts": [
      "SPLIT",
      "WIDE"
     ]
    },
    {
     "k": "tog",
     "i": 5,
     "label": "LISTEN",
     "text": "LISTEN"
    },
    {
     "k": "knob",
     "i": [
      0,
      1,
      2,
      4
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
      6
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "SIBILANCE BAND (LIVE REDUCTION)",
 "vizCode": "frame(cx,r);\nvar fc=2000*Math.pow(6,V[0]),red=(disp[2]||0)*24,g=Math.pow(10,-red/20),wide=Math.round(V[3])===1;\nplot(cx,r,function(f){var b=Math.pow(10,bqMag(2,fc,1.0,0,f)/20);var gg=wide?g:(1-(1-g)*b);return 20*Math.log10(gg+1e-6)},20,20000,-24,6,true);\ncx.font=\"9px sans-serif\";cx.fillStyle=\"#fff\";cx.fillText(Math.round(fc)+\" Hz   reduction \"+red.toFixed(1)+\" dB\",r[0]+6,r[1]+r[3]-6);",
 "testParams": {
  "1": -35
 }
};
