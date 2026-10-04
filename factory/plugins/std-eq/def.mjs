export default {
 "name": "StdEQ",
 "isInstrument": false,
 "subtitle": "4-band parametric equaliser",
 "category": "EQ & Tone",
 "explanation": "A four-band parametric equaliser with a high-pass filter. The outer bands are shelving filters (Low and High) and the two middle bands are peaking bells (LoMid and HiMid) with adjustable Q from a broad, gentle 0.3 to a narrow 8. Each band has its own frequency and up to 15 dB of boost or cut, and the Low Cut is a second-order high-pass for clearing rumble. The curve in the display is the actual combined response of all five filters, redrawn as you turn the knobs.",
 "theme": {
  "accent": "#f2e06b",
  "accent2": "#fbf4c4",
  "bg1": "#3a3410",
  "bg2": "#131004",
  "panel": "#252008",
  "ink": "#fbf8e0",
  "dim": "#b5ad78"
 },
 "params": [
  [
   "Low Cut",
   0,
   1,
   0,
   0,
   {
    "exp": [
     20,
     400
    ],
    "unit": " Hz"
   }
  ],
  [
   "Low Freq",
   0,
   1,
   0.4,
   0,
   {
    "hz": [
     30,
     400
    ]
   }
  ],
  [
   "Low Gain",
   -15,
   15,
   0,
   0,
   "db"
  ],
  [
   "LoMid Freq",
   0,
   1,
   0.45,
   0,
   {
    "hz": [
     100,
     2000
    ]
   }
  ],
  [
   "LoMid Gain",
   -15,
   15,
   0,
   0,
   "db"
  ],
  [
   "LoMid Q",
   0,
   1,
   0.5,
   0,
   {
    "exp": [
     0.3,
     8
    ],
    "unit": " Q"
   }
  ],
  [
   "HiMid Freq",
   0,
   1,
   0.5,
   0,
   {
    "hz": [
     500,
     8000
    ]
   }
  ],
  [
   "HiMid Gain",
   -15,
   15,
   0,
   0,
   "db"
  ],
  [
   "HiMid Q",
   0,
   1,
   0.5,
   0,
   {
    "exp": [
     0.3,
     8
    ],
    "unit": " Q"
   }
  ],
  [
   "High Freq",
   0,
   1,
   0.5,
   0,
   {
    "hz": [
     2000,
     16000
    ]
   }
  ],
  [
   "High Gain",
   -15,
   15,
   0,
   0,
   "db"
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
   "title": "LOW",
   "items": [
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
   "title": "LOW MID",
   "items": [
    {
     "k": "knob",
     "i": [
      3,
      4,
      5
     ]
    }
   ]
  },
  {
   "title": "HIGH MID",
   "items": [
    {
     "k": "knob",
     "i": [
      6,
      7,
      8
     ]
    }
   ]
  },
  {
   "title": "HIGH / OUTPUT",
   "items": [
    {
     "k": "knob",
     "i": [
      9,
      10,
      11
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "EQ CURVE (dB)",
 "vizCode": "frame(cx,r);\nvar hp=20*Math.pow(20,V[0]),lf=30*Math.pow(13.333,V[1]),mf=100*Math.pow(20,V[3]),mq=0.3*Math.pow(26.667,V[5]),hf=500*Math.pow(16,V[6]),hq=0.3*Math.pow(26.667,V[8]),sf=2000*Math.pow(8,V[9]);\nplot(cx,r,function(f){return bqMag(1,hp,0.7071,0,f)+bqMag(5,lf,0.7071,V[2],f)+bqMag(4,mf,mq,V[4],f)+bqMag(4,hf,hq,V[7],f)+bqMag(6,sf,0.7071,V[10],f)},20,20000,-18,18,true);",
 "testParams": {
  "2": 9,
  "4": 9,
  "7": 9,
  "10": 9
 }
};
