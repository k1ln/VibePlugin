export default {
 "name": "StdChorus",
 "isInstrument": false,
 "subtitle": "Multi-voice stereo chorus",
 "category": "Modulation",
 "explanation": "A classic chorus: one to four short, slowly modulated delay lines are mixed with the dry signal, so the pitch of each voice drifts a few cents sharp and flat and the sound thickens into a small ensemble. Rate sets the speed of the modulation, Depth how far each voice wanders, Delay the centre delay time, Voices how many copies are stacked (their LFOs are spread evenly around the cycle), and Spread offsets the right channel's LFO against the left for a wide, swirling image. Tone smooths the wet signal's top end.",
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
   0.45,
   0,
   {
    "exp": [
     0.05,
     5
    ],
    "unit": " Hz"
   }
  ],
  [
   "Depth",
   0,
   1,
   0.5
  ],
  [
   "Delay",
   0,
   1,
   0.4,
   0,
   {
    "ms": [
     5,
     30
    ]
   }
  ],
  [
   "Voices",
   1,
   4,
   3,
   1,
   "int"
  ],
  [
   "Spread",
   0,
   1,
   0.8
  ],
  [
   "Tone",
   0,
   1,
   0.85,
   0,
   {
    "hz": [
     1000,
     16000
    ]
   }
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
   "title": "MOTION",
   "items": [
    {
     "k": "seg",
     "i": 3,
     "label": "VOICES",
     "opts": [
      "1",
      "2",
      "3",
      "4"
     ]
    },
    {
     "k": "knob",
     "i": [
      0,
      1,
      2,
      4
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
 "vizLabel": "VOICE DELAY TIMES (ms)",
 "vizCode": "frame(cx,r);\nvar nV=Math.round(V[3]),base=5+V[2]*25,md=V[1]*0.45*base,rate=0.05*Math.pow(100,V[0]),ph=t*rate/1000;\nfor(var v=0;v<nV;v++){cx.beginPath();cx.strokeStyle=\"rgba(255,255,255,\"+(0.45+0.5*(1-v/nV))+\")\";cx.lineWidth=2;\nfor(var i=0;i<=r[2];i+=2){var d=base+md*Math.sin((i/r[2]*2+ph+v/nV)*Math.PI*2),py=r[1]+r[3]-(d/45)*r[3];i?cx.lineTo(r[0]+i,py):cx.moveTo(r[0]+i,py)}cx.stroke()}\ncx.lineWidth=1;cx.fillStyle=\"rgba(255,255,255,.7)\";cx.font=\"9px sans-serif\";cx.fillText(base.toFixed(1)+\" ms centre, +/-\"+md.toFixed(1)+\" ms\",r[0]+6,r[1]+r[3]-6);",
 "testParams": {}
};
