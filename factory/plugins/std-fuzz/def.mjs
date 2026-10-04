export default {
 "name": "StdFuzz",
 "isInstrument": false,
 "subtitle": "Asymmetric fuzz with gate",
 "category": "Distortion & Saturation",
 "explanation": "A two-transistor-style fuzz: enormous gain into an asymmetric clipper that turns the signal into a thick, buzzy, almost square wave. Fuzz sets the gain (up to 60 dB), Bias moves the operating point of the clipper so the positive and negative halves clip differently, which is the difference between a smooth sustaining sound and a ragged, starved one, and Gate adds the spitting, sputtering cutoff of a dying battery by killing the quiet parts of the waveform. Tone filters the top end and the clipping runs at twice the sample rate.",
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
   "Fuzz",
   0,
   1,
   0.7
  ],
  [
   "Bias",
   0,
   1,
   0.3
  ],
  [
   "Gate",
   0,
   1,
   0.1
  ],
  [
   "Tone",
   0,
   1,
   0.6,
   0,
   {
    "hz": [
     400,
     8000
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
   "title": "FUZZ",
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
   "title": "TONE",
   "items": [
    {
     "k": "knob",
     "i": [
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
 "vizCode": "frame(cx,r);\nfunction shp(x){var D=Math.pow(10,(V[0]*40+10)/20),b=V[1]*0.8,v=x*D+b,y=v>=0?Math.tanh(v*1.6):0.8*Math.tanh(v*0.8),g=V[2]*0.25,a=Math.abs(y);a=Math.max(0,a-g)/(1-g);return y<0?-a:a}\nplot(cx,r,function(x){return shp(x)},-0.2,0.2,-1.15,1.15,false);",
 "testParams": {}
};
