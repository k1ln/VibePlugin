export default {
 "name": "StdOverdrive",
 "isInstrument": false,
 "subtitle": "Mid-focused tube-style overdrive",
 "category": "Distortion & Saturation",
 "explanation": "A mid-focused overdrive in the tradition of the classic green-pedal circuit. Instead of clipping everything equally, the gain stage amplifies only the frequencies above the Focus point, so bass stays clean and tight while the mids and upper harmonics are driven into smooth, symmetrical soft clipping. That keeps chords articulate and the low end from turning to mush even at high gain. Tone rolls off the top of the result, Level sets the volume, and Mix blends the dry signal back in for a more dynamic, pick-sensitive sound. The clipping runs at twice the sample rate to reduce aliasing.",
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
   "Drive",
   0,
   1,
   0.45
  ],
  [
   "Focus",
   0,
   1,
   0.4,
   0,
   {
    "hz": [
     250,
     2000
    ]
   }
  ],
  [
   "Tone",
   0,
   1,
   0.6,
   0,
   {
    "hz": [
     1000,
     12000
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
   -3,
   0,
   "db"
  ]
 ],
 "groups": [
  {
   "title": "DRIVE",
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
 "vizLabel": "GAIN VS FREQUENCY (BASS STAYS CLEAN)",
 "vizCode": "frame(cx,r);\nvar G=1+V[0]*V[0]*90,fc=250*Math.pow(8,V[1]),lp=1000*Math.pow(12,V[2]);\nplot(cx,r,function(f){var x=f/fc,g=Math.sqrt((1+G*G*x*x)/(1+x*x)),l=1/Math.sqrt(1+Math.pow(f/lp,2));return 20*Math.log10(g*l)},20,20000,-10,50,true);",
 "testParams": {}
};
