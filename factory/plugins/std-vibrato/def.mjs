export default {
 "name": "StdVibrato",
 "isInstrument": false,
 "subtitle": "Pitch vibrato",
 "category": "Modulation",
 "explanation": "A pure vibrato: the signal runs through a short delay whose time is swept by an LFO, which bends the pitch up and down in time with the sweep. Rate sets the vibrato speed, Depth the width of the pitch wobble (the picture shows the resulting pitch deviation in cents), Shape chooses a sine or a triangle LFO, and Stereo offsets the right channel's LFO against the left for a wide, slightly seasick image. Mix blends the dry signal back in, which turns vibrato into chorus.",
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
     0.5,
     12
    ],
    "unit": " Hz"
   }
  ],
  [
   "Depth",
   0,
   1,
   0.4
  ],
  [
   "Shape",
   0,
   1,
   0,
   1,
   [
    "Sine",
    "Triangle"
   ]
  ],
  [
   "Stereo",
   0,
   1,
   0.3
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
   "title": "VIBRATO",
   "items": [
    {
     "k": "seg",
     "i": 2,
     "label": "SHAPE",
     "opts": [
      "SINE",
      "TRIANGLE"
     ]
    },
    {
     "k": "knob",
     "i": [
      0,
      1,
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
      4,
      5
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "PITCH DEVIATION",
 "vizCode": "frame(cx,r);\nvar rate=0.5*Math.pow(24,V[0]),md=V[1]*2.5,tri=Math.round(V[2])===1,peak=Math.min(1200,1200*Math.log2(1+2*Math.PI*rate*md*0.001)),ph=t*rate/1000;\nplot(cx,r,function(x){var p=x*3+ph;p=p-Math.floor(p);var l=tri?(p<.5?4*p-1:3-4*p):Math.sin(p*Math.PI*2);return l*peak},0,1,-Math.max(peak*1.3,10),Math.max(peak*1.3,10),false);\ncx.fillStyle=\"rgba(255,255,255,.7)\";cx.font=\"9px sans-serif\";cx.fillText(\"+/-\"+Math.round(peak)+\" cents\",r[0]+6,r[1]+r[3]-6);",
 "testParams": {}
};
