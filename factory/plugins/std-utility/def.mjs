export default {
 "name": "StdUtility",
 "isInstrument": false,
 "subtitle": "Gain, pan, polarity and mono utility",
 "category": "Creative",
 "explanation": "The everyday utility plugin: Gain from -60 to +24 dB with click-free smoothing, an equal-power Pan control (centre is unity gain), polarity inversion for each channel (for fixing out-of-phase mic pairs), Swap to exchange left and right, Mono to sum to the centre, and an optional DC Filter to remove any offset. The meters show the output level of each channel.",
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
   "Gain",
   -60,
   24,
   0,
   0,
   "db"
  ],
  [
   "Pan",
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
   "Phase L",
   0,
   1,
   0,
   1,
   [
    "Normal",
    "Invert"
   ]
  ],
  [
   "Phase R",
   0,
   1,
   0,
   1,
   [
    "Normal",
    "Invert"
   ]
  ],
  [
   "Swap",
   0,
   1,
   0,
   1,
   [
    "Off",
    "On"
   ]
  ],
  [
   "Mono",
   0,
   1,
   0,
   1,
   [
    "Off",
    "On"
   ]
  ],
  [
   "DC Filter",
   0,
   1,
   0,
   1,
   [
    "Off",
    "On"
   ]
  ]
 ],
 "groups": [
  {
   "title": "LEVEL",
   "items": [
    {
     "k": "knob",
     "i": [
      0,
      1
     ]
    }
   ]
  },
  {
   "title": "POLARITY / ROUTING",
   "items": [
    {
     "k": "tog",
     "i": 2,
     "label": "PHASE L",
     "text": "INVERT L"
    },
    {
     "k": "tog",
     "i": 3,
     "label": "PHASE R",
     "text": "INVERT R"
    },
    {
     "k": "tog",
     "i": 4,
     "label": "SWAP",
     "text": "SWAP L/R"
    },
    {
     "k": "tog",
     "i": 5,
     "label": "MONO",
     "text": "MONO"
    },
    {
     "k": "tog",
     "i": 6,
     "label": "DC FILTER",
     "text": "DC FILTER"
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "OUTPUT LEVEL",
 "vizCode": "frame(cx,r);\nvar L=Math.min(1,disp[2]||0),R=Math.min(1,disp[3]||0),bw=r[2]*0.12,x0=r[0]+r[2]/2-bw*1.2,h=r[3]-14;\ncx.fillStyle=\"rgba(255,255,255,.12)\";cx.fillRect(x0,r[1]+7,bw,h);cx.fillRect(x0+bw*1.4,r[1]+7,bw,h);\ncx.fillStyle=\"#fff\";cx.fillRect(x0,r[1]+7+h*(1-L),bw,h*L);cx.fillRect(x0+bw*1.4,r[1]+7+h*(1-R),bw,h*R);\ncx.font=\"9px sans-serif\";cx.fillText(\"L\",x0+bw/2-3,r[1]+r[3]);cx.fillText(\"R\",x0+bw*1.4+bw/2-3,r[1]+r[3]);\nvar pn=V[1],px=r[0]+r[2]/2+pn*r[2]*0.4;cx.fillText(\"PAN\",r[0]+8,r[1]+14);cx.fillRect(r[0]+r[2]*0.1,r[1]+22,r[2]*0.8,1);cx.fillRect(r[0]+r[2]/2+pn*r[2]*0.4-2,r[1]+17,4,11);\ncx.fillText(V[0].toFixed(1)+\" dB\",r[0]+r[2]-70,r[1]+14);",
 "testParams": {
  "0": -6,
  "1": 0.5,
  "2": 1
 }
};
