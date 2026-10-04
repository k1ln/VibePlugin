export default {
 "name": "StdLimiter",
 "isInstrument": false,
 "subtitle": "Look-ahead brickwall limiter",
 "category": "Dynamics",
 "explanation": "A look-ahead brickwall limiter for the end of a chain. The audio is delayed by the Lookahead time while a sliding-window minimum finds the gain reduction each upcoming peak needs, and the gain is eased down before the peak arrives (so there is no overshoot or crackle) and released smoothly afterwards at the Release rate. Gain drives the signal into the limiter, Ceiling is the level nothing will ever exceed, and Soft Clip rounds the peaks with a tanh stage before limiting for a louder, warmer result with less gain reduction. Left and right are linked so the stereo image does not shift.",
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
   "Gain",
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
   "Ceiling",
   -12,
   0,
   -0.3,
   0,
   {
    "unit": " dB",
    "scale": [
     -12,
     0
    ]
   }
  ],
  [
   "Release",
   0,
   1,
   0.5,
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
   "Lookahead",
   0,
   1,
   0.22,
   0,
   {
    "ms": [
     0.5,
     5
    ]
   }
  ],
  [
   "Soft Clip",
   0,
   1,
   0
  ]
 ],
 "groups": [
  {
   "title": "LIMITER",
   "items": [
    {
     "k": "knob",
     "i": [
      0,
      1,
      2,
      3,
      4
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "LIMITING (input dB to output dB)",
 "vizCode": "frame(cx,r);\nvar gn=V[0],ce=V[1],sc=V[4];\ncx.globalAlpha=.25;cx.strokeStyle=\"#fff\";cx.beginPath();cx.moveTo(r[0],r[1]+r[3]);cx.lineTo(r[0]+r[2],r[1]);cx.stroke();cx.globalAlpha=1;\nfunction tf(x){var v=x+gn;if(sc>0.01){var a=Math.pow(10,v/20),t=(1-sc)*a+sc*Math.tanh(a);v=20*Math.log10(Math.max(1e-6,t))}return Math.min(v,ce)}\nplot(cx,r,tf,-36,0,-36,6,false);\nvar cy=r[1]+r[3]-(ce+36)/42*r[3];cx.setLineDash([3,3]);cx.strokeStyle=\"rgba(255,255,255,.4)\";cx.beginPath();cx.moveTo(r[0],cy);cx.lineTo(r[0]+r[2],cy);cx.stroke();cx.setLineDash([]);\ncx.font=\"9px sans-serif\";cx.fillStyle=\"#fff\";cx.fillText(\"GR \"+((disp[2]||0)*18).toFixed(1)+\" dB\",r[0]+6,r[1]+r[3]-6);",
 "testParams": {
  "0": 12
 }
};
