export default {
 "name": "StdRingMod",
 "isInstrument": false,
 "subtitle": "Ring modulator / amplitude modulator",
 "category": "Modulation",
 "explanation": "A ring modulator: the input is multiplied by an internal carrier oscillator, which replaces every input frequency with its sum and difference against the carrier. The result is the clangorous, inharmonic metallic tone of old sci-fi robot voices and bell-like synth sounds. Frequency sets the carrier (5 Hz to 5 kHz), Shape chooses a sine, triangle, square or saw carrier, and AM blends from true ring modulation (carrier and input both suppressed) toward ordinary amplitude modulation (input kept, carrier adds a tremolo-like sideband). Mix blends back with the dry signal.",
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
   "Frequency",
   0,
   1,
   0.5,
   0,
   {
    "exp": [
     5,
     5000
    ],
    "unit": " Hz"
   }
  ],
  [
   "Shape",
   0,
   3,
   0,
   1,
   [
    "Sine",
    "Triangle",
    "Square",
    "Saw"
   ]
  ],
  [
   "AM",
   0,
   1,
   0
  ],
  [
   "Mix",
   0,
   1,
   0.7
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
   "title": "CARRIER",
   "items": [
    {
     "k": "seg",
     "i": 1,
     "label": "SHAPE",
     "opts": [
      "SINE",
      "TRI",
      "SQUARE",
      "SAW"
     ]
    },
    {
     "k": "knob",
     "i": [
      0,
      2
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
      3,
      4
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "CARRIER x INPUT",
 "vizCode": "frame(cx,r);\nvar kd=Math.round(V[1]),am=V[2],ph=t/900;\nfunction car(p){p=p-Math.floor(p);if(kd===0)return Math.sin(p*Math.PI*2);if(kd===1)return p<.5?4*p-1:3-4*p;if(kd===2)return p<.5?1:-1;return 2*p-1}\ncx.beginPath();cx.strokeStyle=\"rgba(255,255,255,.25)\";for(var i=0;i<=r[2];i+=2){var py=r[1]+r[3]/2-Math.sin(i/r[2]*Math.PI*14+ph*3)*(r[3]/2-10);i?cx.lineTo(r[0]+i,py):cx.moveTo(r[0]+i,py)}cx.stroke();\nplot(cx,r,function(x){var s=Math.sin(x*Math.PI*14+ph*3),c=car(x*3.5+ph*0.4);return s*((1-am)*c+am*(0.5+0.5*c))},0,1,-1.05,1.05,false);",
 "testParams": {}
};
