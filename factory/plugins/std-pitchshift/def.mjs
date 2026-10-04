export default {
 "name": "StdPitchShift",
 "isInstrument": false,
 "subtitle": "Two-tap crossfading pitch shifter",
 "category": "Modulation",
 "explanation": "A simple, low-latency pitch shifter: two read heads sweep through a delay line at a speed set by the pitch ratio and are crossfaded with complementary windows so one is always at full strength as the other wraps around. Semitones shifts the pitch up or down by up to an octave, Fine adds up to a semitone either way (small amounts with Mix at 50% make a classic detune thickener), and Window sets the grain size: short windows track fast but sound grainy and chorused, long windows sound smoother but smear transients. The picture shows the two crossfading windows.",
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
   "Semitones",
   -12,
   12,
   0,
   1,
   "semi"
  ],
  [
   "Fine",
   -100,
   100,
   0,
   0,
   "cents"
  ],
  [
   "Window",
   0,
   1,
   0.45,
   0,
   {
    "exp": [
     20,
     120
    ],
    "unit": " ms"
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
   "title": "PITCH",
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
 "vizLabel": "CROSSFADED READ HEADS",
 "vizCode": "frame(cx,r);\nvar st=V[0]+V[1]/100,ratio=Math.pow(2,st/12),sp=(1-ratio);\nfunction w1(p){var s=Math.sin(Math.PI*p);return s*s}\nplot(cx,r,function(p){return w1(p)},0,1,0,1.1,false);\nplot(cx,r,function(p){var s=Math.cos(Math.PI*p);return s*s},0,1,0,1.1,false);\nvar ph=((t/2000)*(-sp*2+0.0001))%1;if(ph<0)ph+=1;cx.fillStyle=\"#fff\";cx.fillRect(r[0]+ph*r[2]-1,r[1],2,r[3]);\ncx.font=\"9px sans-serif\";cx.fillText(\"x\"+ratio.toFixed(3)+\"  (\"+(st>=0?\"+\":\"\")+st.toFixed(2)+\" st)\",r[0]+6,r[1]+r[3]-6);",
 "testParams": {
  "0": 5
 }
};
