export default {
 "name": "StdBitcrusher",
 "isInstrument": false,
 "subtitle": "Bit depth and sample-rate reduction",
 "category": "Distortion & Saturation",
 "explanation": "A digital degrader. Bits quantises the signal to between 1 and 16 bits (the fewer, the grittier and more noise-like), Rate resamples it at anything from 200 Hz up to the full sample rate with no anti-aliasing (the reflections are the point), and Dither adds a touch of noise before quantising to soften the stair-steps or, at high settings, to give lo-fi hiss. Tone smooths the result with a low-pass and Mix blends it with the clean signal for parallel crushing. A live picture shows the staircase the signal is being forced onto.",
 "theme": {
  "accent": "#ff6a4d",
  "accent2": "#ffc7b8",
  "bg1": "#411610",
  "bg2": "#150704",
  "panel": "#2a0e09",
  "ink": "#fbe6e0",
  "dim": "#b88a80"
 },
 "params": [
  [
   "Bits",
   1,
   16,
   8,
   1,
   "int"
  ],
  [
   "Rate",
   0,
   1,
   0.7,
   0,
   {
    "hz": [
     200,
     48000
    ]
   }
  ],
  [
   "Dither",
   0,
   1,
   0.2
  ],
  [
   "Tone",
   0,
   1,
   1,
   0,
   {
    "hz": [
     500,
     20000
    ]
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
   "title": "CRUSH",
   "items": [
    {
     "k": "knob",
     "i": [
      0,
      1,
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
      4,
      5
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "QUANTISED SIGNAL (1 kHz SINE)",
 "vizCode": "frame(cx,r);\nvar bits=Math.round(V[0]),lv=Math.pow(2,bits)/2,rate=200*Math.pow(240,V[1]),hold=Math.max(1,48000/rate),hp=hold*r[2]/192,ph=t/900;\nfunction sg(i){return Math.sin(i/r[2]*Math.PI*8+ph)}\ncx.beginPath();cx.strokeStyle=\"rgba(255,255,255,.25)\";\nfor(var i=0;i<=r[2];i+=2){var py=r[1]+r[3]/2-sg(i)*(r[3]/2-8);i?cx.lineTo(r[0]+i,py):cx.moveTo(r[0]+i,py)}cx.stroke();\ncx.beginPath();cx.strokeStyle=\"#fff\";cx.lineWidth=2;var held=0,lastX=-1e9;\nfor(var j=0;j<=r[2];j++){if(j-lastX>=hp){lastX=j;held=Math.round(sg(j)*lv)/lv}var py2=r[1]+r[3]/2-held*(r[3]/2-8);j?cx.lineTo(r[0]+j,py2):cx.moveTo(r[0]+j,py2)}cx.stroke();cx.lineWidth=1;",
 "testParams": {}
};
