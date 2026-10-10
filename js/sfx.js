// Tiny synthesized sound effects (no audio files needed).
let ctx = null;
let on = true;

export function unlock() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}
export function toggle() { on = !on; return on; }

function tone(freq, start, dur, type = 'sine', vol = 0.18, slide = 0) {
  if (!ctx || !on) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

export const blip = () => { tone(660, 0, 0.12, 'triangle', 0.12, 1.5); };
export const beep = (f = 440) => tone(f, 0, 0.35, 'square', 0.12);
export const whoosh = () => tone(200, 0, 0.4, 'sawtooth', 0.06, 4);
export function found() {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.1, 0.25, 'triangle', 0.16));
}
export function go() {
  tone(880, 0, 0.6, 'square', 0.14);
  tone(90, 0.1, 1.6, 'sawtooth', 0.12, 3.5);
}
