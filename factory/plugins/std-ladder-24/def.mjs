export default {
 "name": "StdLadder24",
 "isInstrument": false,
 "subtitle": "24 dB/oct ladder low-pass",
 "category": "Filters",
 "explanation": "A resonant 24 dB per octave low-pass ladder filter in the style of the classic transistor-ladder design: four cascaded one-pole stages in a zero-delay-feedback topology with the resonance loop closed around all four poles, tapped after the fourth pole for the full 24 dB slope. Drive saturates the input stage, an envelope follower can open the cutoff with the playing dynamics (amount in octaves, speed from fast to slow), and the resonance goes all the way to self-oscillation. A live frequency-response curve shows the cutoff and resonant peak.",
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
   0.62,
   0,
   {
    "hz": [
     20,
     18000
    ]
   }
  ],
  [
   "Resonance",
   0,
   1,
   0.3
  ],
  [
   "Drive",
   0,
   1,
   0.15
  ],
  [
   "Env Amount",
   0,
   1,
   0
  ],
  [
   "Env Speed",
   0,
   1,
   0.4
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
   "title": "ENVELOPE FOLLOWER",
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
 "vizLabel": "LADDER 24 dB/oct",
 "vizCode": "frame(cx,r);\nvar fc=20*Math.pow(900,V[0]),k=V[1]*4;\nfunction cm(a,b){return[a[0]*b[0]-a[1]*b[1],a[0]*b[1]+a[1]*b[0]]}\nplot(cx,r,function(f){var x=f/fc,d=1+x*x,h1=[1/d,-x/d],h2=cm(h1,h1),h4=cm(h2,h2),n=h4,dn=[1+k*h4[0],k*h4[1]],m=(n[0]*n[0]+n[1]*n[1])/(dn[0]*dn[0]+dn[1]*dn[1]);return 10*Math.log10(m+1e-12)},20,20000,-60,24,true);",
 "testParams": {
  "1": 0.5,
  "3": 0.5
 }
};
