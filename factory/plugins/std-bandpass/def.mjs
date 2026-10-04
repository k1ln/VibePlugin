export default {
 "name": "StdBandPass",
 "isInstrument": false,
 "subtitle": "Band-pass with adjustable width",
 "category": "Filters",
 "explanation": "A band-pass filter with a free centre frequency and a bandwidth control from a wide, gentle bell to a narrow resonant whistle. The 12 dB setting is one constant-peak biquad band-pass; the 24 dB setting cascades two of them, which narrows and steepens the passband. Use it to isolate a region (telephone and radio voices, resonant sweeps) or blend it back with the dry signal using Mix. A live frequency-response curve shows the centre and the width.",
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
   "Center",
   0,
   1,
   0.55,
   0,
   {
    "hz": [
     60,
     12000
    ]
   }
  ],
  [
   "Width",
   0,
   1,
   0.45
  ],
  [
   "Slope",
   0,
   1,
   0,
   1,
   [
    "12 dB",
    "24 dB"
   ]
  ],
  [
   "Gain",
   0,
   1,
   0.3
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
   "title": "BAND",
   "items": [
    {
     "k": "seg",
     "i": 2,
     "label": "SLOPE",
     "opts": [
      "12 dB",
      "24 dB"
     ]
    },
    {
     "k": "knob",
     "i": [
      0,
      1,
      3
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
 "vizLabel": "BAND-PASS RESPONSE",
 "vizCode": "frame(cx,r);\nvar fc=60*Math.pow(200,V[0]),q=expq(V[1]);\nfunction expq(w){return 0.3*Math.pow(40,1-w)}\nplot(cx,r,function(f){var m=bqMag(2,fc,q,0,f);if(V[2]>0.5)m+=bqMag(2,fc,q,0,f);return m+V[3]*24},20,20000,-60,30,true);",
 "testParams": {}
};
