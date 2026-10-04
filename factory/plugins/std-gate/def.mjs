export default {
 "name": "StdGate",
 "isInstrument": false,
 "subtitle": "Noise gate with hold and hysteresis",
 "category": "Dynamics",
 "explanation": "A noise gate that closes the gate on everything below the Threshold. A stereo-linked detector with an adjustable sidechain high-pass listens for the signal, the gate opens when the level rises above the Threshold and stays open for at least the Hold time, then closes only once the level has fallen Hysteresis dB below the threshold, which stops it chattering on a decaying note. Attack and Release shape how fast it opens and closes, and Range sets how much the signal is turned down when closed: all the way to silence, or just a few dB for a gentle expander-like clean-up.",
 "theme": {
  "accent": "#8fe388",
  "accent2": "#d6f7d2",
  "bg1": "#163a16",
  "bg2": "#061406",
  "panel": "#0e260e",
  "ink": "#e6f8e4",
  "dim": "#85b082"
 },
 "params": [
  [
   "Threshold",
   -80,
   0,
   -40,
   0,
   {
    "unit": " dB",
    "scale": [
     -80,
     0
    ]
   }
  ],
  [
   "Range",
   -80,
   0,
   -60,
   0,
   {
    "unit": " dB",
    "scale": [
     -80,
     0
    ]
   }
  ],
  [
   "Attack",
   0,
   1,
   0.3,
   0,
   {
    "exp": [
     0.05,
     50
    ],
    "unit": " ms"
   }
  ],
  [
   "Hold",
   0,
   1,
   0.1,
   0,
   {
    "ms": [
     0,
     500
    ]
   }
  ],
  [
   "Release",
   0,
   1,
   0.45,
   0,
   {
    "exp": [
     5,
     2000
    ],
    "unit": " ms"
   }
  ],
  [
   "Hysteresis",
   0,
   12,
   3,
   0,
   {
    "unit": " dB",
    "scale": [
     0,
     12
    ]
   }
  ],
  [
   "SC Hi-Pass",
   0,
   1,
   0,
   0,
   {
    "exp": [
     20,
     2000
    ],
    "unit": " Hz"
   }
  ]
 ],
 "groups": [
  {
   "title": "GATE",
   "items": [
    {
     "k": "knob",
     "i": [
      0,
      1,
      5
     ]
    }
   ]
  },
  {
   "title": "TIMING",
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
   "title": "SIDECHAIN",
   "items": [
    {
     "k": "knob",
     "i": [
      6
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "GATE TRANSFER (input dB to output dB)",
 "vizCode": "frame(cx,r);\nvar thr=V[0],rg=V[1],hy=V[5];\ncx.globalAlpha=.25;cx.strokeStyle=\"#fff\";cx.beginPath();cx.moveTo(r[0],r[1]+r[3]);cx.lineTo(r[0]+r[2],r[1]);cx.stroke();cx.globalAlpha=1;\nplot(cx,r,function(x){return x<thr?Math.max(-80,x+rg):x},-80,0,-80,0,false);\nvar tx=r[0]+(thr+80)/80*r[2],hx=r[0]+(thr-hy+80)/80*r[2];cx.setLineDash([3,3]);cx.strokeStyle=\"rgba(255,255,255,.4)\";cx.beginPath();cx.moveTo(tx,r[1]);cx.lineTo(tx,r[1]+r[3]);cx.moveTo(hx,r[1]);cx.lineTo(hx,r[1]+r[3]);cx.stroke();cx.setLineDash([]);\nvar lv=disp[3]||0,open=disp[2]||0;cx.fillStyle=open>.5?\"#fff\":\"rgba(255,255,255,.25)\";cx.beginPath();cx.arc(r[0]+lv*r[2],r[1]+r[3]-lv*r[3]*(open>.5?1:0.5),4,0,7);cx.fill();\ncx.font=\"9px sans-serif\";cx.fillText(open>.5?\"OPEN\":\"CLOSED\",r[0]+6,r[1]+r[3]-6);",
 "testParams": {
  "0": -35
 },
 "reactInput": "bursts",
 "reactMin": 0.0003
};
