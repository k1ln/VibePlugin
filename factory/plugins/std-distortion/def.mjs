export default {
 "name": "StdDistortion",
 "isInstrument": false,
 "subtitle": "Hard / soft / diode / fold distortion",
 "category": "Distortion & Saturation",
 "explanation": "A general-purpose distortion with four clipping curves: Hard (flat-topped digital-style clipping), Soft (tanh, smooth tube-like saturation), Diode (asymmetric, with the even harmonics that give a warm, crunchy edge) and Fold (the signal folds back on itself instead of clipping, for bright, metallic overtones). Drive pushes the signal into the curve by up to 40 dB, Asymmetry offsets it for extra even harmonics, Low Cut tightens the bass before the clipper so the low end stays defined, and Tone rolls off the top afterwards. The shaping runs at twice the sample rate to keep aliasing down, and a DC blocker follows. A live transfer curve shows what the clipper is doing.",
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
   0.5
  ],
  [
   "Type",
   0,
   3,
   1,
   1,
   [
    "Hard",
    "Soft",
    "Diode",
    "Fold"
   ]
  ],
  [
   "Asymmetry",
   0,
   1,
   0
  ],
  [
   "Low Cut",
   0,
   1,
   0.15,
   0,
   {
    "hz": [
     20,
     800
    ]
   }
  ],
  [
   "Tone",
   0,
   1,
   0.75,
   0,
   {
    "hz": [
     500,
     16000
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
   -6,
   0,
   "db"
  ]
 ],
 "groups": [
  {
   "title": "DRIVE",
   "items": [
    {
     "k": "seg",
     "i": 1,
     "label": "TYPE",
     "opts": [
      "HARD",
      "SOFT",
      "DIODE",
      "FOLD"
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
   "title": "TONE",
   "items": [
    {
     "k": "knob",
     "i": [
      3,
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
      5,
      6
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "TRANSFER CURVE",
 "vizCode": "frame(cx,r);\nfunction shp(x){var D=Math.pow(10,V[0]*2),t=Math.round(V[1]),b=V[2]*0.5,v=x*D+b;\nif(t===0)return Math.max(-1,Math.min(1,v));if(t===1)return Math.tanh(v);\nif(t===2)return v>=0?1-Math.exp(-v):-0.9*(1-Math.exp(v*0.55));return Math.sin(v*1.5708)}\nplot(cx,r,function(x){return shp(x)},-1,1,-1.15,1.15,false);",
 "testParams": {}
};
