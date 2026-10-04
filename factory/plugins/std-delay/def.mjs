export default {
 "name": "StdDelay",
 "isInstrument": false,
 "subtitle": "Stereo delay with tempo sync",
 "category": "Delay & Echo",
 "explanation": "A straightforward stereo delay. Time runs from 10 ms to 2 seconds, or locks to the host tempo as a quarter, eighth, dotted eighth, sixteenth or eighth triplet. Feedback repeats the echo, with a low-pass Tone control and a Low Cut filter inside the feedback loop so every repeat gets progressively darker and thinner instead of piling up mud. Stereo offsets the right channel's delay time against the left for a wide, loosely bouncing echo. Time changes glide smoothly, like turning the knob on an analogue delay, instead of clicking.",
 "theme": {
  "accent": "#4fd6c4",
  "accent2": "#c4f5ee",
  "bg1": "#0f3a38",
  "bg2": "#041514",
  "panel": "#0a2624",
  "ink": "#e2f8f5",
  "dim": "#7fb0aa"
 },
 "params": [
  [
   "Time",
   0,
   1,
   0.67,
   0,
   {
    "exp": [
     10,
     2000
    ],
    "unit": " ms"
   }
  ],
  [
   "Sync",
   0,
   5,
   0,
   1,
   [
    "Free",
    "1/4",
    "1/8",
    "1/8 dotted",
    "1/16",
    "1/8 triplet"
   ]
  ],
  [
   "Feedback",
   0,
   0.95,
   0.4
  ],
  [
   "Tone",
   0,
   1,
   0.7,
   0,
   {
    "hz": [
     500,
     16000
    ]
   }
  ],
  [
   "Low Cut",
   0,
   1,
   0.1,
   0,
   {
    "hz": [
     20,
     1000
    ]
   }
  ],
  [
   "Stereo",
   0,
   1,
   0.2
  ],
  [
   "Mix",
   0,
   1,
   0.3
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
   "title": "TIME",
   "items": [
    {
     "k": "seg",
     "i": 1,
     "label": "SYNC",
     "opts": [
      "FREE",
      "1/4",
      "1/8",
      "1/8 D",
      "1/16",
      "1/8 T"
     ]
    },
    {
     "k": "knob",
     "i": [
      0,
      5
     ]
    }
   ]
  },
  {
   "title": "FEEDBACK",
   "items": [
    {
     "k": "knob",
     "i": [
      2,
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
      6,
      7
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "ECHO TAPS  (left up, right down)",
 "vizCode": "frame(cx,r);\nvar sy=Math.round(V[1]),mult=[0,1,.5,.75,.25,1/3][sy],ms=sy?500*mult:10*Math.pow(200,V[0]),fb=Math.min(.97,V[2]),st=V[5]*0.5;\nvar n=fb<.05?1:Math.min(14,Math.ceil(Math.log(.03)/Math.log(fb))+1),span=ms*(n+.6)*(1+st),w=r[2],h=r[3],mid=r[1]+h/2;\ncx.fillStyle=\"rgba(255,255,255,.75)\";cx.fillRect(r[0],r[1]+4,2,h-8);\nfor(var i=1;i<=n;i++){var a=Math.pow(fb,i-1),xl=r[0]+i*ms/span*w,xr=r[0]+i*ms*(1+st)/span*w,bh=a*(h/2-8);\ncx.fillStyle=\"rgba(255,255,255,\"+(0.2+0.7*a)+\")\";cx.fillRect(xl,mid-bh,3,bh);cx.fillStyle=\"#fff\";cx.globalAlpha=.55*(0.3+0.7*a);cx.fillRect(xr,mid,3,bh);cx.globalAlpha=1}\ncx.fillStyle=\"rgba(255,255,255,.7)\";cx.font=\"9px sans-serif\";cx.fillText((sy?[\"\",\"1/4\",\"1/8\",\"1/8.\",\"1/16\",\"1/8T\"][sy]+\" @120 bpm = \":\"\")+Math.round(ms)+\" ms\",r[0]+6,r[1]+h-6);",
 "testParams": {}
};
