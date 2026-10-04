export default {
 "name": "StdGraphicEQ",
 "isInstrument": false,
 "subtitle": "10-band octave graphic equaliser",
 "category": "EQ & Tone",
 "explanation": "A ten-band graphic equaliser with one band per octave from 31 Hz to 16 kHz, each a peaking filter of octave bandwidth with up to 12 dB of boost or cut. Bands that are set flat are bypassed completely, so an untouched EQ costs nothing and cannot colour the sound. Output trims the overall level. The curve shows the combined response of all ten bands.",
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
   "31 Hz",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "62 Hz",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "125 Hz",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "250 Hz",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "500 Hz",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "1 kHz",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "2 kHz",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "4 kHz",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "8 kHz",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "16 kHz",
   -12,
   12,
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
   "title": "BANDS",
   "items": [
    {
     "k": "knob",
     "i": [
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9
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
      10
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "EQ CURVE (dB)",
 "vizCode": "frame(cx,r);\nvar F=[31.25,62.5,125,250,500,1000,2000,4000,8000,16000];\nplot(cx,r,function(f){var s=0;for(var b=0;b<10;b++)s+=bqMag(4,F[b],1.41,V[b],f);return s},20,20000,-15,15,true);",
 "testParams": {
  "1": 8,
  "5": -8,
  "8": 8
 }
};
