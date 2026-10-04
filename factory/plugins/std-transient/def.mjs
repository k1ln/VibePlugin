export default {
 "name": "StdTransient",
 "isInstrument": false,
 "subtitle": "Attack and sustain shaper",
 "category": "Dynamics",
 "explanation": "A transient shaper that changes the punch of a sound without any threshold to set. Two envelope followers, one fast and one slow, track the signal, and the difference between them separates the attack of each note from its sustained tail: when the fast follower is above the slow one a transient is happening, and when it falls below, the note is decaying. Attack boosts or cuts the transients by up to 12 dB and Sustain boosts or cuts the tails, so you can add snap to a dull snare, tighten a boomy kick, or dry out a roomy drum loop. Speed sets how fine the detection is.",
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
   "Attack",
   -12,
   12,
   4,
   0,
   "db"
  ],
  [
   "Sustain",
   -12,
   12,
   0,
   0,
   "db"
  ],
  [
   "Speed",
   0,
   1,
   0.5
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
   "title": "SHAPE",
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
      3
     ]
    }
   ]
  }
 ],
 "viz": "custom",
 "vizLabel": "ENVELOPE: ORIGINAL (DIM) VS SHAPED",
 "vizCode": "frame(cx,r);\nvar at=Math.pow(10,V[0]/20),su=Math.pow(10,V[1]/20);\nfunction sp(x){return x<0.04?x/0.04:Math.exp(-(x-0.04)*16)}\nfunction tl(x){return x<0.04?x/0.04:Math.exp(-(x-0.04)*1.4)}\ncx.globalAlpha=.3;plot(cx,r,function(x){return 0.65*sp(x)+0.35*tl(x)},0,1,0,2.2,false);cx.globalAlpha=1;\nplot(cx,r,function(x){return at*0.65*sp(x)+su*0.35*tl(x)},0,1,0,2.2,false);",
 "testParams": {}
};
