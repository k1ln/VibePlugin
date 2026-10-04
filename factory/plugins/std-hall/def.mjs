export default {
 "name": "StdHall",
 "isInstrument": false,
 "subtitle": "Large concert hall",
 "category": "Reverb",
 "explanation": "A big, smooth concert-hall reverb. Eight long delay lines (roughly 30 to 80 ms) are coupled by a Householder feedback matrix, giving a dense, slowly blooming tail that can run from a couple of seconds to a cathedral-length 20. Damping darkens the tail as it decays, Diffusion sets how quickly the echoes smear into a wash, Mod adds gentle delay-time movement for a lush, non-metallic sound, and Pre-Delay keeps the dry source clear in front of the tail.",
 "theme": {
  "accent": "#7aa8ff",
  "accent2": "#d4e2ff",
  "bg1": "#14264a",
  "bg2": "#060b18",
  "panel": "#0e1a32",
  "ink": "#e6eefc",
  "dim": "#8a9cc0"
 },
 "params": [
  [
   "Decay",
   0,
   1,
   0.55,
   0,
   {
    "exp": [
     0.2,
     20
    ],
    "unit": " s"
   }
  ],
  [
   "Size",
   0,
   1,
   0.5,
   0,
   {
    "exp": [
     0.5,
     2
    ],
    "unit": "x"
   }
  ],
  [
   "Pre-Delay",
   0,
   1,
   0.1,
   0,
   {
    "ms": [
     0,
     250
    ]
   }
  ],
  [
   "Damping",
   0,
   1,
   0.5
  ],
  [
   "Diffusion",
   0,
   1,
   0.75
  ],
  [
   "Mod",
   0,
   1,
   0.35
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
     800
    ]
   }
  ],
  [
   "High Cut",
   0,
   1,
   0.9,
   0,
   {
    "hz": [
     1000,
     20000
    ]
   }
  ],
  [
   "Width",
   0,
   1,
   1
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
   "title": "SPACE",
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
   "title": "CHARACTER",
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
   "title": "TONE",
   "items": [
    {
     "k": "knob",
     "i": [
      6,
      7,
      8
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
      9,
      10
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "HALL TAIL",
 "vizCode": "frame(cx,r);\nvar rt=0.2*Math.pow(100,V[0]),pre=V[2]*0.25,span=Math.max(1.2,rt*1.3+pre),w=r[2],h=r[3],seed=11,live=disp[0]||0;\nfunction rn(){seed=(seed*16807)%2147483647;return seed/2147483647}\ncx.fillStyle=\"rgba(255,255,255,.7)\";cx.fillRect(r[0],r[1]+6,2,h-12);\nvar nd=(0.3+V[4]*0.7);\nfor(var x=4;x<w;x+=2){var tt=x/w*span,e=tt<pre?0:Math.max(0,1-(tt-pre)/rt),ramp=Math.min(1,(tt-pre)/0.06);\nvar a=e*ramp*(0.25+0.75*rn())*(0.7+0.3*nd)*(0.9+0.1*Math.sin(t/400+x*.05));\nif(a>0.004){cx.fillStyle=\"rgba(255,255,255,\"+(0.25+0.6*a)+\")\";var bh=a*(h-14);cx.fillRect(r[0]+x,r[1]+h/2-bh/2,1.6,bh)}}\nvar xm=r[0]+Math.min(w-2,(rt+pre)/span*w);cx.strokeStyle=\"rgba(255,255,255,.35)\";cx.setLineDash([3,3]);cx.beginPath();cx.moveTo(xm,r[1]);cx.lineTo(xm,r[1]+h);cx.stroke();cx.setLineDash([]);\ncx.fillStyle=\"rgba(255,255,255,.7)\";cx.font=\"9px sans-serif\";cx.fillText(\"RT60 \"+rt.toFixed(2)+\" s\",Math.min(xm+4,r[0]+w-70),r[1]+12);",
 "testParams": {}
};
