export default {
 "name": "StdTremolo",
 "isInstrument": false,
 "subtitle": "Tempo-syncable tremolo",
 "category": "Modulation",
 "explanation": "A tremolo: the level of the signal is modulated by an LFO. Rate runs free from 0.1 to 20 Hz, or Sync locks it to the host tempo (quarter, eighth, sixteenth or thirty-second notes) and phase-locks it to the song position while the transport plays. Depth sets how far the level dips, Shape chooses sine, triangle, a soft square for a choppy gate-like pulse, or a falling saw, and Stereo shifts the right channel's LFO against the left, up to opposite phase, for a swirling auto-pan feel.",
 "theme": {
  "accent": "#c58bff",
  "accent2": "#ebd6ff",
  "bg1": "#2c1650",
  "bg2": "#0d0618",
  "panel": "#1d0f36",
  "ink": "#f0e6fb",
  "dim": "#9a85b8"
 },
 "params": [
  [
   "Rate",
   0,
   1,
   0.5,
   0,
   {
    "exp": [
     0.1,
     20
    ],
    "unit": " Hz"
   }
  ],
  [
   "Sync",
   0,
   4,
   0,
   1,
   [
    "Free",
    "1/4",
    "1/8",
    "1/16",
    "1/32"
   ]
  ],
  [
   "Depth",
   0,
   1,
   0.6
  ],
  [
   "Shape",
   0,
   3,
   0,
   1,
   [
    "Sine",
    "Triangle",
    "Square",
    "Saw"
   ]
  ],
  [
   "Stereo",
   0,
   1,
   0
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
   "title": "LFO",
   "items": [
    {
     "k": "seg",
     "i": 3,
     "label": "SHAPE",
     "opts": [
      "SINE",
      "TRI",
      "SQUARE",
      "SAW"
     ]
    },
    {
     "k": "seg",
     "i": 1,
     "label": "SYNC",
     "opts": [
      "FREE",
      "1/4",
      "1/8",
      "1/16",
      "1/32"
     ]
    },
    {
     "k": "knob",
     "i": [
      0,
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
      5
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "LEVEL MODULATION",
 "vizCode": "frame(cx,r);\nvar kd=Math.round(V[3]),dep=V[2],rate=0.1*Math.pow(200,V[0]),sy=Math.round(V[1]),cyc=sy?[0,1,2,4,8][sy]:Math.max(1,Math.min(8,rate)),ph=t*(sy?0.0004:rate/1000);\nfunction lf(p){p=p-Math.floor(p);if(kd===0)return .5+.5*Math.sin(p*Math.PI*2);if(kd===1)return p<.5?2*p:2-2*p;if(kd===2)return .5+.5*Math.tanh(Math.sin(p*Math.PI*2)*8);return 1-p}\nplot(cx,r,function(x){return 1-dep*(1-lf(x*cyc*0.5+ph*0.35))},0,1,0,1.05,false);",
 "testParams": {}
};
