export default {
  name: "Choirloft", isInstrument: true, subtitle: "Vocal choir · up to 100 singers", category: "Strings",
  explanation: "A vocal choir and formant synthesiser that can sing with up to 100 voices. Every singer is an individual: its own tuning, vibrato rate/depth/onset, slow pitch drift, entry time, attack and release, loudness and stage position. Singers are summed into stage groups that each have a slightly different vocal-tract length and bandwidth (Diversity), then run through five resonators tuned from vowel tables for bass, tenor, alto and soprano that morph across A-E-I-O-U (the mod wheel pushes the vowel on, Formant Shift changes apparent size). Voice type Auto is a real SATB choir: each note is split across neighbouring sections by pitch, so low notes are sung by basses and tenors and high notes by altos and sopranos. Effort and velocity shape the voice's brightness, Breath adds pitch-less aspiration, Scoop swells up into each note, CC11 and aftertouch shape expression, and Presence adds the singer's-formant peak. The stage is spread in stereo with arrival-time differences, and an eight-line modulated hall (pre-delay, early reflections, damping, up to 9 seconds) finishes it. Eight notes of polyphony.",
  theme: { accent: "#c9a8ff", accent2: "#f0e6ff", bg1: "#2b1f4a", bg2: "#0d0917", panel: "#1a1230", ink: "#efe9fa", dim: "#9686b8" },
  params: [
    ["Voice Type", 0, 4, 4, 1, ["Bass", "Tenor", "Alto", "Soprano", "Auto SATB"]], ["Vowel", 0, 1, 0], ["Formant Shift", 0, 1, 0.5], ["Choir Size", 1, 100, 24, 1],
    ["Ensemble", 0, 1, 0.5], ["Vibrato", 0, 1, 0.4], ["Vibrato Rate", 0, 1, 0.45], ["Human", 0, 1, 0.5], ["Attack", 0, 1, 0.45], ["Release", 0, 1, 0.5],
    ["Breath", 0, 1, 0.15], ["Effort", 0, 1, 0.55], ["Scoop", 0, 1, 0.25], ["Width", 0, 1, 0.7], ["Space", 0, 1, 0.4], ["Hall Size", 0, 1, 0.62],
    ["Bend Range", 0, 1, 0.1667], ["Level", 0, 1, 0.7], ["Velocity Sens", 0, 1, 0.3],
    ["Diversity", 0, 1, 0.5], ["Presence", 0, 1, 0.45], ["Pre-Delay", 0, 1, 0.25], ["Damping", 0, 1, 0.5], ["Early Refl", 0, 1, 0.5],
  ],
  groups: [
    { title: "VOICE", items: [{ k: "seg", i: 0, label: "SECTION", opts: ["BASS", "TENOR", "ALTO", "SOPRANO", "AUTO"] }, { k: "seg", i: -1, label: "VOWEL", opts: ["AH", "EH", "EE", "OH", "OO"], presets: [{ 1: 0 }, { 1: 0.25 }, { 1: 0.5 }, { 1: 0.75 }, { 1: 1 }] }, { k: "knob", i: [1, 2, 11, 10, 20] }] },
    { title: "CHOIR", items: [{ k: "seg", i: -1, label: "SINGERS", opts: ["1", "8", "24", "50", "100"], presets: [{ 3: 1 }, { 3: 8 }, { 3: 24 }, { 3: 50 }, { 3: 100 }] }, { k: "knob", i: [3, 4, 19, 7, 13] }] },
    { title: "EXPRESSION", items: [{ k: "knob", i: [5, 6, 12, 8, 9, 18] }] },
    { title: "HALL & OUT", items: [{ k: "knob", i: [14, 15, 21, 22, 23, 16, 17] }] },
  ],
  viz: "custom", vizLabel: "CHOIR LOFT",
  vizCode: `
var N=Math.max(1,Math.round(V[3])),lv=hasDisp?Math.min(1,disp[0]):.25+.2*Math.sin(t/900);
var rows=Math.max(1,Math.ceil(Math.sqrt(N/6))),cxm=W/2,by=H-12,Rw=Math.min(W*.46,(H-40)*2.4),Rh=H-34,idx=0,tot=0,wt=[],j;
for(j=0;j<rows;j++){wt[j]=(j+1);tot+=wt[j]}
for(j=0;j<rows;j++){var cnt=j===rows-1?N-idx:Math.max(1,Math.round(N*wt[j]/tot));if(idx+cnt>N)cnt=N-idx;var rr=(j+1)/rows;
for(var i2=0;i2<cnt;i2++){var a=Math.PI*(.07+.86*(cnt===1?.5:i2/(cnt-1))),x=cxm+Math.cos(a)*rr*Rw,y=by-Math.sin(a)*rr*Rh*.82;
var tw=.5+.5*Math.sin(t/(380+(idx*37)%300)+idx*1.7),al=.3+.45*lv*tw+.18*tw;
cx.fillStyle="rgba(240,230,255,"+al.toFixed(3)+")";cx.beginPath();cx.arc(x,y,N>60?1.7:N>16?2.3:3.2,0,6.2832);cx.fill();idx++}}
var pts=[],n2=15;for(var b=0;b<n2;b++){var v=hasDisp?disp[1+b]:.4+.3*Math.sin(b*.7+t/800);pts.push([10+(W-30)*b/(n2-1),H-10-v*(H-34)*(.55+.45*Math.min(1,lv*2.2+.25))])}
cx.beginPath();cx.moveTo(pts[0][0],H-10);cx.lineTo(pts[0][0],pts[0][1]);
for(var q2=1;q2<pts.length;q2++){var mx=(pts[q2-1][0]+pts[q2][0])/2,my=(pts[q2-1][1]+pts[q2][1])/2;cx.quadraticCurveTo(pts[q2-1][0],pts[q2-1][1],mx,my)}
cx.lineTo(pts[n2-1][0],pts[n2-1][1]);cx.lineTo(pts[n2-1][0],H-10);cx.closePath();
var gr=cx.createLinearGradient(0,H-10,0,18);gr.addColorStop(0,"rgba(201,168,255,.05)");gr.addColorStop(1,"rgba(201,168,255,.38)");cx.fillStyle=gr;cx.fill();
cx.beginPath();cx.moveTo(pts[0][0],pts[0][1]);for(q2=1;q2<pts.length;q2++){mx=(pts[q2-1][0]+pts[q2][0])/2;my=(pts[q2-1][1]+pts[q2][1])/2;cx.quadraticCurveTo(pts[q2-1][0],pts[q2-1][1],mx,my)}
cx.lineTo(pts[n2-1][0],pts[n2-1][1]);cx.strokeStyle="#f0e6ff";cx.lineWidth=1.6;cx.stroke();
cx.fillStyle="rgba(240,230,255,.5)";cx.font="9px sans-serif";cx.fillText(N+(N===1?" SINGER":" SINGERS"),W-84,12);`,
  kb: { base: 36, n: 49 },
  testParams: {},
};
