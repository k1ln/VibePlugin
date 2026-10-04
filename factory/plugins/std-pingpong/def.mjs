export default {
 "name": "StdPingPong",
 "isInstrument": false,
 "subtitle": "Ping-pong stereo delay",
 "category": "Delay & Echo",
 "explanation": "A ping-pong delay: each echo bounces to the opposite side, left, right, left, right, with the feedback crossed between the two channels. The input is summed to mono and starts on the left; Spread feeds some of it straight into the right line as well for a wider, less strictly alternating pattern. Time can run free (10 ms to 2 s) or lock to the host tempo, and Tone and Low Cut shape each repeat inside the feedback loop so the bounces fade into the distance.",
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
   0.64,
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
   0.5
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
   "Spread",
   0,
   1,
   0
  ],
  [
   "Mix",
   0,
   1,
   0.35
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
 "vizLabel": "PING-PONG  (left up, right down)",
 "vizCode": "frame(cx,r);\nvar sy=Math.round(V[1]),mult=[0,1,.5,.75,.25,1/3][sy],ms=sy?500*mult:10*Math.pow(200,V[0]),fb=Math.min(.97,V[2]);\nvar n=fb<.05?1:Math.min(14,Math.ceil(Math.log(.03)/Math.log(fb))+1),span=ms*(n+.6),w=r[2],h=r[3],mid=r[1]+h/2;\ncx.fillStyle=\"rgba(255,255,255,.75)\";cx.fillRect(r[0],r[1]+4,2,h-8);\nfor(var i=1;i<=n;i++){var a=Math.pow(fb,i-1),x=r[0]+i*ms/span*w,bh=a*(h/2-8),up=(i%2===1);\ncx.globalAlpha=.3+.7*a;cx.fillStyle=\"#fff\";cx.fillRect(x,up?mid-bh:mid,3,bh);cx.globalAlpha=.35*a;cx.fillRect(x,up?mid:mid-bh,3,bh*V[5]);cx.globalAlpha=1}\ncx.fillStyle=\"rgba(255,255,255,.7)\";cx.font=\"9px sans-serif\";cx.fillText(Math.round(ms)+\" ms\",r[0]+6,r[1]+h-6);",
 "testParams": {}
};
