export default {
 "name": "StdHighPass",
 "isInstrument": false,
 "subtitle": "High-pass, 12 or 24 dB/oct",
 "category": "Filters",
 "explanation": "A clean high-pass filter with a switchable 12 or 24 dB per octave slope. 12 dB is a single Butterworth biquad; 24 dB cascades two biquads with the Butterworth Q pair (0.54 and 1.31) for a maximally flat passband and a steep skirt. Resonance raises the Q of the final section for a peak at the cutoff, which is handy for tightening low end or building risers. A live frequency-response curve shows exactly what the filter is doing.",
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
   0.2,
   0,
   {
    "hz": [
     20,
     8000
    ]
   }
  ],
  [
   "Slope",
   0,
   1,
   1,
   1,
   [
    "12 dB",
    "24 dB"
   ]
  ],
  [
   "Resonance",
   0,
   1,
   0
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
     "i": 1,
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
      3,
      4
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "HIGHPASS RESPONSE",
 "vizCode": "frame(cx,r);\nvar fc=20*Math.pow(400,V[0]),q=V[2]*8;\nplot(cx,r,function(f){if(V[1]>0.5)return bqMag(1,fc,0.5412,0,f)+bqMag(1,fc,1.3065+q,0,f);return bqMag(1,fc,0.7071+q,0,f)},20,20000,-60,24,true);",
 "testParams": {
  "2": 0.4
 }
};
