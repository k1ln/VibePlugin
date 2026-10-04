export default {
 "name": "StdPhaser",
 "isInstrument": false,
 "subtitle": "2 to 12 stage phaser",
 "category": "Modulation",
 "explanation": "A phaser: the signal passes through a cascade of first-order allpass filters whose corner frequency is swept by an LFO, and the result is mixed with the dry signal. Every pair of allpass stages adds one notch to the response, so 2 stages is a single gentle swoosh and 12 is a deep, complex sweep. Center sets where the sweep sits, Depth how many octaves it moves, Feedback (positive or negative) turns the notches into resonant peaks, and Spread offsets the right channel's LFO from the left. The picture shows the live notch pattern.",
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
   "Stages",
   0,
   5,
   1,
   1,
   [
    "2",
    "4",
    "6",
    "8",
    "10",
    "12"
   ]
  ],
  [
   "Rate",
   0,
   1,
   0.4,
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
   "Center",
   0,
   1,
   0.5,
   0,
   {
    "hz": [
     100,
     5000
    ]
   }
  ],
  [
   "Feedback",
   -0.9,
   0.9,
   0.4
  ],
  [
   "Spread",
   0,
   1,
   0.4
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
     "k": "seg",
     "i": 0,
     "label": "STAGES",
     "opts": [
      "2",
      "4",
      "6",
      "8",
      "10",
      "12"
     ]
    },
    {
     "k": "knob",
     "i": [
      1,
      2,
      3
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
      6,
      7
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "NOTCH PATTERN (LIVE SWEEP)",
 "vizCode": "frame(cx,r);\nvar n=2*(Math.round(V[0])+1),rate=0.02*Math.pow(500,V[1]),cen=100*Math.pow(50,V[3]),fc=cen*Math.pow(2,V[2]*2*Math.sin(t*rate/1000*Math.PI*2)),fb=V[4];\nvar a=(Math.tan(Math.PI*Math.min(fc,21000)/48000)-1)/(Math.tan(Math.PI*Math.min(fc,21000)/48000)+1);\nplot(cx,r,function(f){var w=2*Math.PI*f/48000,c1=Math.cos(w),s1=-Math.sin(w);\nvar nr=a+c1,ni=s1,dr=1+a*c1,di=a*s1,m=dr*dr+di*di,hr=(nr*dr+ni*di)/m,hi=(ni*dr-nr*di)/m;var Ar=1,Ai=0;for(var i=0;i<n;i++){var tr=Ar*hr-Ai*hi;Ai=Ar*hi+Ai*hr;Ar=tr}\nvar lr=1-fb*(Ar*c1-Ai*s1),li=-fb*(Ar*s1+Ai*c1),lm=lr*lr+li*li||1e-9,wr=(Ar*lr+Ai*li)/lm,wi=(Ai*lr-Ar*li)/lm;return 10*Math.log10((1+wr)*(1+wr)+wi*wi+1e-9)},20,20000,-36,15,true);",
 "testParams": {}
};
