export default {
 "name": "StdTapeEcho",
 "isInstrument": false,
 "subtitle": "Tape echo with wow and flutter",
 "category": "Delay & Echo",
 "explanation": "A tape-style echo. The repeats pass through a saturating tape stage, a gentle low-pass and a bass-trimming high-pass inside the feedback loop, so each generation gets warmer, darker and more compressed, and the feedback can be pushed to self-oscillation without blowing up. Wow adds slow speed drift and Flutter adds fast jitter to the delay time, giving the repeats their characteristic pitch wobble. Time glides when changed, with the pitch bending like a real tape machine being re-speeded.",
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
   0.6,
   0,
   {
    "exp": [
     30,
     1000
    ],
    "unit": " ms"
   }
  ],
  [
   "Feedback",
   0,
   1,
   0.45
  ],
  [
   "Tone",
   0,
   1,
   0.5,
   0,
   {
    "hz": [
     800,
     9000
    ]
   }
  ],
  [
   "Wow",
   0,
   1,
   0.25
  ],
  [
   "Flutter",
   0,
   1,
   0.2
  ],
  [
   "Drive",
   0,
   1,
   0.3
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
   "title": "ECHO",
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
   "title": "TAPE",
   "items": [
    {
     "k": "knob",
     "i": [
      3,
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
 "vizLabel": "TAPE LOOP",
 "vizCode": "frame(cx,r);\nvar ms=30*Math.pow(33.33,V[0]),fb=Math.min(1,V[1])*0.97,w=r[2],h=r[3],mid=r[1]+h/2,n=fb<.05?1:Math.min(14,Math.ceil(Math.log(.03)/Math.log(fb))+1),span=ms*(n+.6),wob=(V[3]*3+V[4]*1.5);\ncx.fillStyle=\"rgba(255,255,255,.75)\";cx.fillRect(r[0],r[1]+4,2,h-8);\nfor(var i=1;i<=n;i++){var a=Math.pow(fb,i-1)*Math.pow(.93,i),x=r[0]+i*ms/span*w+Math.sin(t/500+i)*wob*i*.5,bh=a*(h-16);cx.globalAlpha=.25+.75*a;cx.fillStyle=\"#fff\";cx.fillRect(x,mid-bh/2,3,bh);}\ncx.globalAlpha=1;cx.fillStyle=\"rgba(255,255,255,.7)\";cx.font=\"9px sans-serif\";cx.fillText(Math.round(ms)+\" ms\",r[0]+6,r[1]+h-6);",
 "testParams": {}
};
