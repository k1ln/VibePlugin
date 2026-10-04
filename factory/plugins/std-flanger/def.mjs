export default {
 "name": "StdFlanger",
 "isInstrument": false,
 "subtitle": "Jet-sweep flanger",
 "category": "Modulation",
 "explanation": "A flanger: the signal is mixed with a very short, swept copy of itself, which carves a comb of notches into the spectrum that sweeps up and down for the classic jet-engine whoosh. Manual sets the centre delay (short is bright and nasal, long is hollow), Depth how far the sweep travels (it moves exponentially, so it sounds even), and Rate its speed. Feedback, positive or negative, sharpens the notches into resonant peaks; negative feedback gives the hollow, metallic through-zero-ish flavour. Spread offsets the right channel's sweep from the left. The picture shows the live comb response.",
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
   0.35,
   0,
   {
    "exp": [
     0.02,
     10
    ],
    "unit": " Hz"
   }
  ],
  [
   "Depth",
   0,
   1,
   0.7
  ],
  [
   "Manual",
   0,
   1,
   0.45,
   0,
   {
    "exp": [
     0.1,
     5
    ],
    "unit": " ms"
   }
  ],
  [
   "Feedback",
   -0.95,
   0.95,
   0.5
  ],
  [
   "Spread",
   0,
   1,
   0.5
  ],
  [
   "Mix",
   0,
   1,
   0.5
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
   "title": "SWEEP",
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
   "title": "RESONANCE",
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
 "vizLabel": "COMB RESPONSE (LIVE SWEEP)",
 "vizCode": "function comb(f,d,fb){var w=2*Math.PI*f/48000,ca=Math.cos(w*d),sa=-Math.sin(w*d),dr=1-fb*ca,di=-fb*sa,m=(dr*dr+di*di)||1e-9;var wr=(ca*dr+sa*di)/m,wi=(sa*dr-ca*di)/m;var re=1+wr,im=wi;return 10*Math.log10(re*re+im*im+1e-9)}\nframe(cx,r);\nvar rate=0.02*Math.pow(500,V[0]),man=0.1*Math.pow(50,V[2]),dep=V[1],d=man*Math.pow(2,dep*3*Math.sin(t*rate/1000*Math.PI*2))*0.001*48000,fb=V[3];\nplot(cx,r,function(f){return comb(f,d,fb)},20,20000,-30,18,true);",
 "testParams": {}
};
