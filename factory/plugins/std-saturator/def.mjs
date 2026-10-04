export default {
 "name": "StdSaturator",
 "isInstrument": false,
 "subtitle": "Tape / tube / soft saturation",
 "category": "Distortion & Saturation",
 "explanation": "A gentle, level-compensated saturator for warming up and gluing sounds rather than wrecking them. Tape is symmetrical tanh saturation (odd harmonics, rounded peaks), Tube is asymmetric (adds even harmonics, a thick fat low end) and Soft is a very mild x/(1+|x|) curve for a barely-there glue. Drive pushes the signal into the curve while the output is renormalised so more drive sounds richer rather than just louder; Warmth adds a low-shelf bump around 150 Hz after saturation and Tone rolls the highs off like tape does. Runs at twice the sample rate.",
 "theme": {
  "accent": "#ff6a4d",
  "accent2": "#ffc7b8",
  "bg1": "#411610",
  "bg2": "#150704",
  "panel": "#2a0e09",
  "ink": "#fbe6e0",
  "dim": "#b88a80"
 },
 "params": [
  [
   "Drive",
   0,
   1,
   0.4
  ],
  [
   "Type",
   0,
   2,
   0,
   1,
   [
    "Tape",
    "Tube",
    "Soft"
   ]
  ],
  [
   "Warmth",
   0,
   1,
   0.3
  ],
  [
   "Tone",
   0,
   1,
   0.9,
   0,
   {
    "hz": [
     2000,
     20000
    ]
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
   "title": "SATURATION",
   "items": [
    {
     "k": "seg",
     "i": 1,
     "label": "TYPE",
     "opts": [
      "TAPE",
      "TUBE",
      "SOFT"
     ]
    },
    {
     "k": "knob",
     "i": [
      0,
      2,
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
 "vizLabel": "TRANSFER CURVE",
 "vizCode": "frame(cx,r);\nfunction shp(x){var D=1+V[0]*7,t=Math.round(V[1]),v=x*D,y;if(t===0)y=Math.tanh(v)*0.25/Math.tanh(0.25*D);else if(t===1){y=(v>=0?Math.tanh(v):0.85*Math.tanh(v*1.2))*0.25/Math.tanh(0.25*D)}else y=(v/(1+Math.abs(v)))*0.25/(0.25*D/(1+0.25*D));return y}\nplot(cx,r,function(x){return shp(x)},-1,1,-1.15,1.15,false);",
 "testParams": {}
};
