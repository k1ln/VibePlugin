export default {
 "name": "StdWidener",
 "isInstrument": false,
 "subtitle": "Mid/side stereo width control",
 "category": "Creative",
 "explanation": "A mid/side stereo widener. The signal is split into its centre (mid, what both channels share) and sides (what differs), and the sides are scaled by Width: 0% collapses to mono, 100% leaves the image untouched, 200% doubles the side content for a very wide mix. Bass Mono removes the stereo information below the chosen frequency so the low end stays solid and centred (important for vinyl, club systems and mono compatibility), and Mid Level and Side Level trim the two components independently. Balance shifts the whole image left or right. The picture is a goniometer-style view of how the image is being reshaped.",
 "theme": {
  "accent": "#9fb4cc",
  "accent2": "#dbe5f0",
  "bg1": "#222c3a",
  "bg2": "#0a0d12",
  "panel": "#161d27",
  "ink": "#e8eef5",
  "dim": "#8795a6"
 },
 "params": [
  [
   "Width",
   0,
   2,
   1,
   0,
   {
    "unit": " %",
    "scale": [
     0,
     200
    ]
   }
  ],
  [
   "Bass Mono",
   0,
   1,
   0,
   0,
   {
    "exp": [
     20,
     400
    ],
    "unit": " Hz"
   }
  ],
  [
   "Mid Level",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "Side Level",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "Balance",
   -1,
   1,
   0,
   0,
   {
    "unit": " %",
    "scale": [
     -100,
     100
    ]
   }
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
   "title": "STEREO FIELD",
   "items": [
    {
     "k": "knob",
     "i": [
      0,
      1,
      4
     ]
    }
   ]
  },
  {
   "title": "MID / SIDE",
   "items": [
    {
     "k": "knob",
     "i": [
      2,
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
      5
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "STEREO IMAGE (side across, mid up)",
 "vizCode": "frame(cx,r);\nvar wd=V[0],mg=Math.pow(10,V[2]/20),sg=Math.pow(10,V[3]/20)*wd,cxm=r[0]+r[2]/2,cym=r[1]+r[3]/2,sx=r[2]*0.3,sy=r[3]*0.42;\nfunction ell(ms,ss,st,al){cx.beginPath();for(var k=0;k<=64;k++){var a=k/64*Math.PI*2,m=Math.cos(a)*ms,s=Math.sin(a)*0.45*ss;var px=cxm+s*sx*2,py=cym-m*sy;k?cx.lineTo(px,py):cx.moveTo(px,py)}cx.closePath();cx.strokeStyle=st;cx.lineWidth=2;cx.globalAlpha=al;cx.stroke();cx.globalAlpha=1}\nell(1,1,\"#fff\",.25);ell(mg,sg,\"#fff\",.95);cx.lineWidth=1;\ncx.fillStyle=\"rgba(255,255,255,.7)\";cx.font=\"9px sans-serif\";cx.fillText(\"width \"+Math.round(wd*100)+\"%\",r[0]+6,r[1]+r[3]-6);",
 "testParams": {}
};
