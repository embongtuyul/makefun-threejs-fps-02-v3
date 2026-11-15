// SANDLINE — audio.js: every sound is synthesized with WebAudio.
// No audio files are shipped (the game loads nothing over the network and
// keeps its dossier small). The context is created on the first user gesture.

let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch (_e) { ctx = null; }
}

// Short filtered noise burst: the body of a gunshot.
function noiseBurst(dur, filterFreq, gain, type = 'lowpass', when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const len = Math.max(1, (dur * ctx.sampleRate) | 0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter); filter.connect(g); g.connect(master);
  src.start(t);
}

function tone(freq, dur, gain, type = 'sine', slideTo = null, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

// Volume by distance: 1 at the listener, fading to 0 at maxDist.
function volFor(dist, maxDist) {
  return Math.max(0, 1 - dist / maxDist);
}

export const sfx = {
  shoot(kind, dist = 0) {
    const v = 0.25 + 0.75 * volFor(dist, 60);
    if (kind === 'sniper') { noiseBurst(0.28, 900, 0.9 * v); tone(70, 0.25, 0.7 * v, 'sine', 40); }
    else if (kind === 'shotgun') { noiseBurst(0.22, 1100, 0.85 * v); tone(90, 0.18, 0.5 * v, 'sine', 50); }
    else if (kind === 'smg') { noiseBurst(0.09, 1800, 0.5 * v); tone(220, 0.06, 0.25 * v, 'square', 120); }
    else if (kind === 'pistol') { noiseBurst(0.12, 1500, 0.6 * v); tone(180, 0.08, 0.3 * v, 'square', 90); }
    else { noiseBurst(0.11, 1400, 0.65 * v); tone(160, 0.08, 0.35 * v, 'square', 80); }
  },
  reload() { tone(1200, 0.05, 0.2, 'square'); tone(800, 0.05, 0.2, 'square', null, 0.18); },
  dryFire() { tone(1400, 0.04, 0.25, 'square'); },
  hit(headshot) { tone(headshot ? 2200 : 1500, 0.06, 0.3, 'sine'); },
  kill() { tone(880, 0.09, 0.3, 'sine'); tone(1320, 0.12, 0.3, 'sine', null, 0.09); },
  hurt() { noiseBurst(0.1, 500, 0.4); },
  step(dist = 0) { noiseBurst(0.05, 700, 0.12 * volFor(dist, 18)); },
  plantBeep() { tone(1800, 0.12, 0.35, 'square'); },
  bombTick() { tone(1200, 0.05, 0.25, 'square'); },
  explosion(dist = 0) {
    const v = 0.3 + 0.7 * volFor(dist, 80);
    noiseBurst(0.9, 300, 1.0 * v);
    tone(55, 0.8, 0.9 * v, 'sine', 28);
  },
  defuse() { tone(900, 0.1, 0.3, 'sine'); tone(1200, 0.1, 0.3, 'sine', null, 0.12); },
  roundWin() { tone(523, 0.15, 0.3, 'sine'); tone(659, 0.15, 0.3, 'sine', null, 0.15); tone(784, 0.25, 0.3, 'sine', null, 0.3); },
  roundLose() { tone(392, 0.2, 0.3, 'sine'); tone(311, 0.3, 0.3, 'sine', null, 0.2); },
  buy() { tone(1568, 0.08, 0.25, 'sine'); tone(2093, 0.1, 0.25, 'sine', null, 0.08); },
  grenadePin() { tone(2000, 0.04, 0.2, 'square'); },
  bounce() { tone(300, 0.05, 0.2, 'sine', 150); },
  smoke() { noiseBurst(0.5, 400, 0.4); }, // soft gas hiss as the cloud blooms
  flash() { noiseBurst(0.15, 4000, 0.8, 'highpass'); tone(2400, 0.3, 0.15, 'sine', 900); },
  knife() { noiseBurst(0.08, 3000, 0.3, 'bandpass'); },
  radio() { tone(1400, 0.03, 0.12, 'square'); tone(1100, 0.03, 0.12, 'square', null, 0.06); },
};
