export default {
 "name": "StdCompressor",
 "isInstrument": false,
 "subtitle": "Feed-forward compressor with soft knee",
 "category": "Dynamics",
 "explanation": "A clean, transparent feed-forward compressor. A stereo-linked detector (peak or RMS) watches the signal after a sidechain high-pass filter, which stops big bass notes from pumping the whole mix, and the gain computer turns down everything above the Threshold by the Ratio, with a soft Knee that eases in gently instead of snapping. Attack and Release shape how quickly the gain reduction clamps down and lets go, Makeup restores the lost level, and Mix blends the dry signal back for parallel (New York) compression. The picture shows the transfer curve with a live gain-reduction readout.",
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
   -60,
   0,
   -18,
   0,
   {
    "unit": " dB",
    "scale": [
     -60,
     0
    ]
   }
  ],
  [
   "Ratio",
   1,
   20,
   4,
   0,
   {
    "unit": ":1",
    "scale": [
     1,
     20
    ]
   }
  ],
  [
   "Attack",
   0,
   1,
   0.45,
   0,
   {
    "exp": [
     0.1,
     100
    ],
    "unit": " ms"
   }
  ],
  [
   "Release",
   0,
   1,
   0.4,
   0,
   {
    "exp": [
     10,
     1000
    ],
    "unit": " ms"
   }
  ],
  [
   "Knee",
   0,
   24,
   6,
   0,
   {
    "unit": " dB",
    "scale": [
     0,
     24
    ]
   }
  ],
  [
   "Makeup",
   0,
   24,
   0,
   0,
   {
    "unit": " dB",
    "scale": [
     0,
     24
    ]
   }
  ],
  [
   "Detector",
   0,
   1,
   0,
   1,
   [
    "Peak",
    "RMS"
   ]
  ],
  [
   "SC Hi-Pass",
   0,
   1,
   0.2,
   0,
   {
    "exp": [
     20,
     500
    ],
    "unit": " Hz"
   }
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
   "title": "COMPRESSION",
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
   "title": "TIMING",
   "items": [
    {
     "k": "seg",
     "i": 6,
     "label": "DETECTOR",
     "opts": [
      "PEAK",
      "RMS"
     ]
    },
    {
     "k": "knob",
     "i": [
      2,
      3,
      7
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
      5,
      8,
      9
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "TRANSFER CURVE (input dB to output dB)",
 "vizCode": "frame(cx,r);\nvar thr=V[0],R=Math.max(1,V[1]),kn=V[4],mk=V[5];\nfunction tf(x){var o=x-thr,g;if(2*o<-kn)g=0;else if(kn>0.01&&2*Math.abs(o)<=kn)g=(1/R-1)*Math.pow(o+kn/2,2)/(2*kn);else g=(1/R-1)*o;return x+g+mk}\ncx.globalAlpha=.25;cx.strokeStyle=\"#fff\";cx.beginPath();cx.moveTo(r[0],r[1]+r[3]);cx.lineTo(r[0]+r[2],r[1]);cx.stroke();cx.globalAlpha=1;\nplot(cx,r,tf,-60,0,-60,12,false);\nvar tx=r[0]+(thr+60)/60*r[2];cx.setLineDash([3,3]);cx.strokeStyle=\"rgba(255,255,255,.4)\";cx.beginPath();cx.moveTo(tx,r[1]);cx.lineTo(tx,r[1]+r[3]);cx.stroke();cx.setLineDash([]);\nvar lv=disp[3]||0,li=-60+lv*60,px=r[0]+lv*r[2],py=r[1]+r[3]-(tf(li)+60)/72*r[3];cx.fillStyle=\"#fff\";cx.beginPath();cx.arc(px,Math.max(r[1]+3,Math.min(r[1]+r[3]-3,py)),4,0,7);cx.fill();\ncx.font=\"9px sans-serif\";cx.fillText(\"GR \"+((disp[2]||0)*24).toFixed(1)+\" dB\",r[0]+6,r[1]+r[3]-6);",
 "testParams": {
  "0": -30
 }
};
