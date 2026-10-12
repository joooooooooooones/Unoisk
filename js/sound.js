// Lydeffekter, lavet med Web Audio – ingen lydfiler, så de virker også uden net.
// Kan slås fra; valget huskes på telefonen.

const KEY = 'unoisk.sound';
let enabled = true;
try {
  enabled = localStorage.getItem(KEY) !== 'off';
} catch {
  // Privat browsing e.l. – lyden er bare slået til.
}

let ctx = null;
let master = null;
let noiseBuf = null;

// Browsere tillader først lyd efter et tryk, så lyden startes ved første berøring.
function unlock() {
  if (!ctx) {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
for (const type of ['pointerdown', 'keydown']) addEventListener(type, unlock, { capture: true, passive: true });

function envelope(t, dur, peak, attack = 0.004) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(master);
  return g;
}

// Kort støjstød gennem et filter – lyden af pap mod pap.
function burst(t, { dur, type, freq, q = 0.8, gain, attack }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f).connect(envelope(t, dur, gain, attack));
  src.start(t);
  src.stop(t + dur + 0.02);
}

function tone(t, { freq, to = freq, dur, type = 'triangle', gain }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  osc.connect(envelope(t, dur, gain));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const notes = (t, freqs, step, dur, gain) =>
  freqs.forEach((freq, i) => tone(t + i * step, { freq, dur: i === freqs.length - 1 ? dur * 2.5 : dur, gain }));

const SOUNDS = {
  // Et kort smækkes på bunken
  play(t) {
    burst(t, { dur: 0.07, type: 'bandpass', freq: 2200, gain: 0.5 });
    tone(t, { freq: 180, to: 70, dur: 0.08, type: 'sine', gain: 0.35 });
  },
  // Et kort glider af bunken
  draw(t) {
    burst(t, { dur: 0.1, type: 'highpass', freq: 2500, gain: 0.16, attack: 0.03 });
  },
  // Din tur
  turn(t) {
    tone(t, { freq: 660, dur: 0.12, gain: 0.14 });
    tone(t + 0.1, { freq: 990, dur: 0.2, gain: 0.14 });
  },
  uno(t) {
    notes(t, [523, 659, 784, 1047], 0.07, 0.1, 0.16);
  },
  win(t) {
    notes(t, [523, 659, 784, 1047], 0.12, 0.14, 0.2);
  },
  lose(t) {
    notes(t, [392, 330, 262], 0.16, 0.16, 0.12);
  },
};

export function play(name) {
  if (!enabled || !ctx || document.hidden) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  SOUNDS[name]?.(ctx.currentTime + 0.01);
}

export const isOn = () => enabled;

export function setOn(on) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // ikke kritisk
  }
  if (on) {
    unlock();
    play('play');
  }
}
