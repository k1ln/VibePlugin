export default {
 "name": "StdTone",
 "isInstrument": false,
 "subtitle": "Bass / mid / treble tone control",
 "category": "EQ & Tone",
 "explanation": "The simple tone stack everyone understands: Bass and Treble are shelving filters at adjustable corner frequencies, Mid is a broad bell at an adjustable centre, and each gives up to 12 dB of boost or cut. Meant for quick, musical broad strokes rather than surgical work: warm up a dull bass, lift a vocal's presence, tame a harsh top end. The curve shows the combined response.",
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
   "Bass",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "Mid",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "Treble",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "Bass Freq",
   0,
   1,
   0.4,
   0,
   {
    "hz": [
     60,
     300
    ]
   }
  ],
  [
   "Mid Freq",
   0,
   1,
   0.5,
   0,
   {
    "hz": [
     300,
     3000
    ]
   }
  ],
  [
   "Treble Freq",
   0,
   1,
   0.5,
   0,
   {
    "hz": [
     2000,
     10000
    ]
   }
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
   "title": "TONE",
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
   "title": "FREQUENCIES",
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
 "vizLabel": "TONE CURVE (dB)",
 "vizCode": "frame(cx,r);\nvar bf=60*Math.pow(5,V[3]),mf=300*Math.pow(10,V[4]),tf=2000*Math.pow(5,V[5]);\nplot(cx,r,function(f){return bqMag(5,bf,0.7071,V[0],f)+bqMag(4,mf,0.6,V[1],f)+bqMag(6,tf,0.7071,V[2],f)},20,20000,-15,15,true);",
 "testParams": {
  "0": 8,
  "1": 8,
  "2": 8
 }
};
