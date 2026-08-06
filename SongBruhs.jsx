import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import * as Tone from 'tone';
import {
  Play, Volume2, VolumeX, Shuffle, Trash2, X, Check, Sparkles,
  Music, Wand2, Headphones, Users, Ban,
} from 'lucide-react';

/* ==========================================================================
   SONGBRUHS — a loop mixer + character creator.
   All art is inline SVG, all audio is synthesised at runtime. No assets.
   ========================================================================== */

const BPM = 110;
const BEAT_SEC = 60 / BPM;          // 0.5454
const BAR_SEC = BEAT_SEC * 4;       // 2.1818
const BOB_SEC = BEAT_SEC * 2;       // 1.0909  <- character bob period
const STEPS = 32;                   // 16th notes across 2 bars

const OUTLINE = '#111111';
const SW = 6;

const FAM = {
  beats:  { key: 'beats',  label: 'BEATS',  hex: '#ef4444', dot: 'bg-red-500',    text: 'text-red-400',    ring: 'ring-red-400',    border: 'border-red-500' },
  bass:   { key: 'bass',   label: 'BASS',   hex: '#3b82f6', dot: 'bg-blue-500',   text: 'text-blue-400',   ring: 'ring-blue-400',   border: 'border-blue-500' },
  melody: { key: 'melody', label: 'MELODY', hex: '#22c55e', dot: 'bg-green-500',  text: 'text-green-400',  ring: 'ring-green-400',  border: 'border-green-500' },
  voice:  { key: 'voice',  label: 'VOICE',  hex: '#eab308', dot: 'bg-yellow-500', text: 'text-yellow-400', ring: 'ring-yellow-400', border: 'border-yellow-500' },
  fx:     { key: 'fx',     label: 'FX',     hex: '#a855f7', dot: 'bg-purple-500', text: 'text-purple-400', ring: 'ring-purple-400', border: 'border-purple-500' },
};
const FAM_ORDER = ['beats', 'bass', 'melody', 'voice', 'fx'];

/* --- Tone version shims (v14 globals vs v15 getters) --------------------- */
const getTransport = () => (typeof Tone.getTransport === 'function' ? Tone.getTransport() : Tone.Transport);
const getDest = () => (typeof Tone.getDestination === 'function' ? Tone.getDestination() : Tone.Destination);

/* --- pattern helpers ----------------------------------------------------- */
const ZEROS = '.'.repeat(STEPS);
function pat(s) {
  const out = new Array(STEPS).fill(0);
  for (let i = 0; i < STEPS; i++) {
    const c = (s || ZEROS)[i] || '.';
    out[i] = c === 'X' ? 1 : c === 'x' ? 0.78 : c === 'o' ? 0.5 : c === '-' ? 0.28 : 0;
  }
  return out;
}
const IDX32 = Array.from({ length: STEPS }, (_, i) => i);

/* --- shared builder utilities -------------------------------------------- */
function loopPart(cb, events) {
  const p = new Tone.Part(cb, events);
  p.loop = true;
  p.loopStart = 0;
  p.loopEnd = '2m';
  return p;
}
function noteCb(synth) {
  return (time, e) => synth.triggerAttackRelease(e.note, e.dur, time, e.vel == null ? 0.9 : e.vel);
}
function chordCb(synth) {
  return (time, e) => synth.triggerAttackRelease(e.notes, e.dur, time, e.vel == null ? 0.8 : e.vel);
}

/* ==========================================================================
   BEATS — MembraneSynth kick, NoiseSynth snare/clap, MetalSynth hats
   ========================================================================== */
function buildDrums(bus, cfg) {
  const kickP = pat(cfg.kick);
  const snareP = pat(cfg.snare);
  const clapP = pat(cfg.clap);
  const hatP = pat(cfg.hat);
  const swing = cfg.hatSwing || 0;

  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.036,
    octaves: 5,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.34, sustain: 0.004, release: 0.14 },
  }).connect(bus);
  kick.volume.value = -4;

  const snareFilter = new Tone.Filter({ type: 'bandpass', frequency: 1850, Q: 1.1 }).connect(bus);
  const snare = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.13, sustain: 0 },
  }).connect(snareFilter);
  snare.volume.value = -13;

  const clapFilter = new Tone.Filter({ type: 'bandpass', frequency: 1150, Q: 0.85 }).connect(bus);
  const clap = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.002, decay: 0.2, sustain: 0 },
  }).connect(clapFilter);
  clap.volume.value = -17;

  const hatFilter = new Tone.Filter({ type: 'highpass', frequency: 7200 }).connect(bus);
  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: cfg.hatDecay || 0.045, release: 0.012 },
    harmonicity: 5.1,
    modulationIndex: 30,
    resonance: 5200,
    octaves: 1.2,
  }).connect(hatFilter);
  hat.volume.value = -31;

  const seq = new Tone.Sequence((time, i) => {
    if (kickP[i]) kick.triggerAttackRelease(cfg.kickNote || 'A1', '8n', time, kickP[i]);
    if (snareP[i]) snare.triggerAttackRelease('16n', time, snareP[i]);
    if (clapP[i]) clap.triggerAttackRelease('16n', time + 0.011, clapP[i] * 0.9);
    if (hatP[i]) hat.triggerAttackRelease('32n', time + (i % 2 ? swing : 0), hatP[i]);
  }, IDX32, '16n');
  seq.loop = true;

  return { nodes: [kick, snare, snareFilter, clap, clapFilter, hat, hatFilter], parts: [seq] };
}

/* ==========================================================================
   BASS — MonoSynth / FMSynth, low-passed
   ========================================================================== */
function buildBass(bus, cfg) {
  const nodes = [];
  const filt = new Tone.Filter({ type: 'lowpass', frequency: cfg.cutoff || 430, Q: 0.9 }).connect(bus);
  nodes.push(filt);

  let synth;
  if (cfg.fm) {
    synth = new Tone.FMSynth({
      harmonicity: 1,
      modulationIndex: 1.4,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.95, release: 0.5 },
      modulationEnvelope: { attack: 0.4, decay: 0.2, sustain: 0.4, release: 0.4 },
    }).connect(filt);
    synth.volume.value = -6;
  } else {
    synth = new Tone.MonoSynth({
      oscillator: { type: cfg.osc || 'sawtooth' },
      envelope: { attack: 0.006, decay: cfg.decay || 0.2, sustain: cfg.sustain == null ? 0.5 : cfg.sustain, release: 0.14 },
      filterEnvelope: {
        attack: 0.004, decay: 0.11, sustain: 0.28, release: 0.2,
        baseFrequency: cfg.base || 110, octaves: cfg.octaves || 2.3,
      },
    }).connect(filt);
    synth.volume.value = -9;
  }
  nodes.push(synth);
  return { nodes, parts: [loopPart(noteCb(synth), cfg.events)] };
}

/* ==========================================================================
   MELODY — PolySynth through PingPongDelay
   ========================================================================== */
function buildMelody(bus, cfg) {
  const delay = new Tone.PingPongDelay({ delayTime: cfg.delayTime || '8n', feedback: cfg.fb == null ? 0.26 : cfg.fb, wet: cfg.wet == null ? 0.3 : cfg.wet }).connect(bus);
  const poly = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: cfg.osc || 'triangle' },
    envelope: cfg.env || { attack: 0.006, decay: 0.22, sustain: 0.12, release: 0.4 },
  }).connect(delay);
  poly.volume.value = cfg.vol == null ? -16 : cfg.vol;
  poly.maxPolyphony = 12;
  return { nodes: [poly, delay], parts: [loopPart(chordCb(poly), cfg.events)] };
}

/* ==========================================================================
   VOICE — AM/FM synth through a two-band formant filter + chorus
   ========================================================================== */
function formantBank(bus, f1, f2, directAmt) {
  const out = new Tone.Gain(1).connect(bus);
  const b1 = new Tone.Filter({ type: 'bandpass', frequency: f1, Q: 5.5 }).connect(out);
  const b2 = new Tone.Filter({ type: 'bandpass', frequency: f2, Q: 8 }).connect(out);
  const direct = new Tone.Gain(directAmt == null ? 0.22 : directAmt).connect(out);
  const input = new Tone.Gain(1);
  input.connect(b1);
  input.connect(b2);
  input.connect(direct);
  return { input, nodes: [out, b1, b2, direct, input] };
}

function buildVoice(bus, cfg) {
  const chorus = new Tone.Chorus(cfg.chorusRate || 3.2, 2.6, 0.4).connect(bus);
  chorus.start();
  const bank = formantBank(chorus, cfg.f1, cfg.f2, cfg.direct);
  const nodes = [chorus, ...bank.nodes];

  let synth;
  let cb;
  if (cfg.poly) {
    synth = new Tone.PolySynth(Tone.AMSynth, {
      harmonicity: cfg.harm || 2,
      oscillator: { type: 'sine' },
      modulation: { type: 'square' },
      envelope: cfg.env || { attack: 0.35, decay: 0.4, sustain: 0.8, release: 0.9 },
      modulationEnvelope: { attack: 0.5, decay: 0.2, sustain: 0.6, release: 0.6 },
    }).connect(bank.input);
    synth.maxPolyphony = 8;
    cb = chordCb(synth);
  } else if (cfg.fm) {
    synth = new Tone.FMSynth({
      harmonicity: cfg.harm || 2.02,
      modulationIndex: cfg.mi || 6,
      oscillator: { type: 'sine' },
      modulation: { type: 'triangle' },
      envelope: cfg.env || { attack: 0.008, decay: 0.16, sustain: 0.05, release: 0.14 },
      modulationEnvelope: { attack: 0.006, decay: 0.12, sustain: 0.1, release: 0.12 },
    }).connect(bank.input);
    cb = noteCb(synth);
  } else {
    synth = new Tone.AMSynth({
      harmonicity: cfg.harm || 1.5,
      oscillator: { type: 'sine' },
      modulation: { type: 'sine' },
      envelope: cfg.env || { attack: 0.12, decay: 0.3, sustain: 0.7, release: 0.5 },
    }).connect(bank.input);
    cb = noteCb(synth);
  }
  synth.volume.value = cfg.vol == null ? -12 : cfg.vol;
  nodes.push(synth);
  return { nodes, parts: [loopPart(cb, cfg.events)] };
}

/* ==========================================================================
   FX — filtered noise, sweeps, reverb. Noise sources run continuously and are
   gated by the loop's own gain node, so nothing can leak before the downbeat.
   ========================================================================== */
function buildRiser(bus) {
  const amp = new Tone.Gain(0).connect(bus);
  const filt = new Tone.Filter({ type: 'bandpass', frequency: 300, Q: 2.6 }).connect(amp);
  const noise = new Tone.Noise('white').connect(filt);
  noise.volume.value = -6;
  noise.start();
  const len = BAR_SEC * 2;
  const part = loopPart((time) => {
    filt.frequency.cancelScheduledValues(time);
    filt.frequency.setValueAtTime(260, time);
    filt.frequency.exponentialRampToValueAtTime(5400, time + len * 0.9);
    amp.gain.cancelScheduledValues(time);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(0.42, time + len * 0.86);
    amp.gain.linearRampToValueAtTime(0.0001, time + len * 0.97);
  }, [{ time: '0:0:0' }]);
  return { nodes: [noise, filt, amp], parts: [part] };
}

function buildVinyl(bus) {
  const bed = new Tone.Gain(0.09).connect(bus);
  const lp = new Tone.Filter({ type: 'lowpass', frequency: 5200 }).connect(bed);
  const hp = new Tone.Filter({ type: 'highpass', frequency: 550 }).connect(lp);
  const noise = new Tone.Noise('pink').connect(hp);
  noise.start();

  const wob = new Tone.AutoFilter({ frequency: 0.46, depth: 0.55, baseFrequency: 900, octaves: 2 }).connect(bus);
  wob.start();
  const crackFilter = new Tone.Filter({ type: 'highpass', frequency: 2400 }).connect(wob);
  const crack = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.0005, decay: 0.018, sustain: 0 } }).connect(crackFilter);
  crack.volume.value = -24;

  const cp = pat('x..-..o...-..x..-...o..x...-..o.');
  const seq = new Tone.Sequence((time, i) => {
    if (cp[i]) crack.triggerAttackRelease('64n', time + Math.random() * 0.02, cp[i] * (0.5 + Math.random() * 0.5));
  }, IDX32, '16n');
  seq.loop = true;

  return { nodes: [noise, hp, lp, bed, crack, crackFilter, wob], parts: [seq] };
}

function buildStutter(bus) {
  const amp = new Tone.Gain(0).connect(bus);
  const filt = new Tone.Filter({ type: 'lowpass', frequency: 2200, Q: 1.4 }).connect(amp);
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.004, decay: 0.2, sustain: 0.85, release: 0.2 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.2, baseFrequency: 240, octaves: 3 },
  }).connect(filt);
  synth.volume.value = -14;

  const S16 = BEAT_SEC / 4;
  const part = loopPart((time, e) => {
    if (e.a === 'hit') {
      synth.detune.cancelScheduledValues(time);
      synth.detune.setValueAtTime(0, time);
      synth.triggerAttackRelease('A2', '2n', time, 0.85);
      amp.gain.cancelScheduledValues(time);
      amp.gain.setValueAtTime(0.7, time);
      // gate it into eighth-note chops
      for (let k = 1; k <= 8; k++) {
        amp.gain.setValueAtTime(k % 2 ? 0.12 : 0.7, time + k * S16 * 2);
      }
    } else {
      // tape stop: pitch and level fall away over the last two beats
      const fall = BEAT_SEC * 1.7;
      synth.detune.cancelScheduledValues(time);
      synth.detune.setValueAtTime(0, time);
      synth.detune.linearRampToValueAtTime(-2400, time + fall);
      amp.gain.cancelScheduledValues(time);
      amp.gain.setValueAtTime(0.7, time);
      for (let k = 1; k <= 7; k++) {
        amp.gain.setValueAtTime(k % 2 ? 0.08 : 0.7 - k * 0.07, time + k * S16 * (1 + k * 0.16));
      }
      amp.gain.linearRampToValueAtTime(0.0001, time + fall);
      synth.triggerRelease(time + fall);
    }
  }, [
    { time: '0:0:0', a: 'hit' },
    { time: '1:0:0', a: 'hit' },
    { time: '1:2:0', a: 'stop' },
  ]);
  return { nodes: [synth, filt, amp], parts: [part] };
}

function buildSwell(bus) {
  const rev = new Tone.Reverb({ decay: 4.5, preDelay: 0.012, wet: 0.85 }).connect(bus);
  const amp = new Tone.Gain(0).connect(rev);
  const filt = new Tone.Filter({ type: 'bandpass', frequency: 900, Q: 1.3 }).connect(amp);
  const noise = new Tone.Noise('brown').connect(filt);
  noise.volume.value = 0;
  noise.start();
  const tone = new Tone.AMSynth({
    harmonicity: 2.5,
    oscillator: { type: 'sine' },
    envelope: { attack: 1.6, decay: 0.2, sustain: 0.9, release: 0.3 },
  }).connect(amp);
  tone.volume.value = -20;

  const part = loopPart((time) => {
    const rise = BAR_SEC * 0.92;
    filt.frequency.cancelScheduledValues(time);
    filt.frequency.setValueAtTime(500, time);
    filt.frequency.linearRampToValueAtTime(2600, time + rise);
    amp.gain.cancelScheduledValues(time);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(0.5, time + rise);
    amp.gain.linearRampToValueAtTime(0.0001, time + rise + 0.06);
    tone.triggerAttackRelease('A4', rise, time, 0.7);
  }, [{ time: '1:0:0' }]);

  return { nodes: [noise, filt, amp, tone, rev], parts: [part] };
}

/* --- combo bonus layers --------------------------------------------------- */
function buildToms(bus) {
  const tom = new Tone.MembraneSynth({
    pitchDecay: 0.09, octaves: 3,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.002, decay: 0.28, sustain: 0.002, release: 0.2 },
  }).connect(bus);
  tom.volume.value = -12;
  const p = pat('....o.......x.....o...x.....o.x.');
  const notes = ['A2', 'C3', 'D3', 'G2'];
  const seq = new Tone.Sequence((time, i) => {
    if (p[i]) tom.triggerAttackRelease(notes[i % notes.length], '8n', time, p[i]);
  }, IDX32, '16n');
  seq.loop = true;
  return { nodes: [tom], parts: [seq] };
}

function buildShaker(bus) {
  const f = new Tone.Filter({ type: 'highpass', frequency: 5200 }).connect(bus);
  const sh = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.035, sustain: 0 } }).connect(f);
  sh.volume.value = -26;
  const p = pat('x.o.x.o.x.o.x.o.x.o.x.o.x.o.xoo.');
  const seq = new Tone.Sequence((time, i) => {
    if (p[i]) sh.triggerAttackRelease('32n', time, p[i]);
  }, IDX32, '16n');
  seq.loop = true;
  return { nodes: [sh, f], parts: [seq] };
}

/* ==========================================================================
   SOUND LIBRARY — 20 loops, 5 families, all in A minor (A C D E G only)
   ========================================================================== */
function bassLine(pairs) {
  return pairs.map(([time, note, dur, vel]) => ({ time, note, dur: dur || '16n', vel: vel == null ? 0.9 : vel }));
}
const ARP1 = ['A4', 'C5', 'E5', 'G5', 'A5', 'G5', 'E5', 'C5'];
const ARP2 = ['A4', 'D5', 'E5', 'G5', 'A5', 'G5', 'D5', 'C5'];
function arpEvents() {
  const out = [];
  for (let b = 0; b < 2; b++) {
    const row = b === 0 ? ARP1 : ARP2;
    for (let i = 0; i < 8; i++) {
      out.push({ time: `${b}:${Math.floor(i / 2)}:${(i % 2) * 2}`, notes: [row[i]], dur: '8n', vel: i % 2 ? 0.55 : 0.8 });
    }
  }
  return out;
}
function pulseEvents(note) {
  const out = [];
  for (let b = 0; b < 2; b++) {
    for (let q = 0; q < 4; q++) {
      out.push({ time: `${b}:${q}:0`, note, dur: '8n', vel: 0.95 });
      out.push({ time: `${b}:${q}:2`, note, dur: '8n', vel: 0.55 });
    }
  }
  return out;
}
function octaveEvents(lo, hi) {
  const out = [];
  for (let b = 0; b < 2; b++) {
    for (let q = 0; q < 4; q++) {
      out.push({ time: `${b}:${q}:0`, note: lo, dur: '8n', vel: 0.95 });
      out.push({ time: `${b}:${q}:2`, note: q === 3 && b === 1 ? 'G2' : hi, dur: '8n', vel: 0.62 });
    }
  }
  return out;
}

const SOUNDS = [
  /* ---- BEATS ---- */
  { id: 'b_four', family: 'beats', name: 'Steady Stomp', glyph: 'dots4', level: 0.95,
    build: (bus) => buildDrums(bus, { kick: 'X...'.repeat(8), snare: '....X...'.repeat(4), clap: '....o...'.repeat(4), hat: '..x.'.repeat(8) }) },
  { id: 'b_half', family: 'beats', name: 'Slow Lean', glyph: 'halfbar', level: 0.95,
    build: (bus) => buildDrums(bus, { kick: 'X.........X.....'.repeat(2), snare: '........X.......'.repeat(2), hat: '..o.'.repeat(8), hatDecay: 0.07 }) },
  { id: 'b_broken', family: 'beats', name: 'Broken Shuffle', glyph: 'broken', level: 0.95,
    build: (bus) => buildDrums(bus, { kick: 'X.......' + '..X..X..' + 'X.......' + '..X.....', snare: '....X...'.repeat(4), clap: '..............o.'.repeat(2), hat: 'x.ox.oxo'.repeat(4), hatSwing: 0.019 }) },
  { id: 'b_hats', family: 'beats', name: 'Tick Storm', glyph: 'ticks', level: 0.9,
    build: (bus) => buildDrums(bus, { kick: 'X...............'.repeat(2), clap: '........o.......'.repeat(2), hat: 'Xoxoxoxo'.repeat(4), hatSwing: 0.012, hatDecay: 0.032 }) },

  /* ---- BASS ---- */
  { id: 's_root', family: 'bass', name: 'Root Pulse', glyph: 'pulse', level: 0.9,
    build: (bus) => buildBass(bus, { events: pulseEvents('A1'), cutoff: 400 }) },
  { id: 's_oct', family: 'bass', name: 'Octave Bounce', glyph: 'octave', level: 0.85,
    build: (bus) => buildBass(bus, { events: octaveEvents('A1', 'A2'), cutoff: 620, decay: 0.14, sustain: 0.3 }) },
  { id: 's_sub', family: 'bass', name: 'Sub Drone', glyph: 'wave', level: 0.9,
    build: (bus) => buildBass(bus, { fm: true, cutoff: 210, events: [
      { time: '0:0:0', note: 'A1', dur: '1:1:0', vel: 0.9 },
      { time: '1:2:0', note: 'G1', dur: '0:1:2', vel: 0.8 },
    ] }) },
  { id: 's_pluck', family: 'bass', name: 'Sync Pluck', glyph: 'zig', level: 0.85,
    build: (bus) => buildBass(bus, { osc: 'square', cutoff: 700, decay: 0.1, sustain: 0.1, octaves: 3, events: bassLine([
      ['0:0:0', 'A1', '16n', 1], ['0:1:2', 'A1', '16n', 0.7], ['0:2:2', 'C2', '16n', 0.85], ['0:3:2', 'A1', '16n', 0.6],
      ['1:0:0', 'A1', '16n', 1], ['1:1:2', 'E2', '16n', 0.8], ['1:2:2', 'G2', '16n', 0.85], ['1:3:0', 'E2', '8n', 0.7],
    ]) }) },

  /* ---- MELODY ---- */
  { id: 'm_arp', family: 'melody', name: 'Ladder Arp', glyph: 'stairs', level: 0.75,
    build: (bus) => buildMelody(bus, { events: arpEvents(), osc: 'triangle', wet: 0.32 }) },
  { id: 'm_stab', family: 'melody', name: 'Chord Stabs', glyph: 'bars', level: 0.7,
    build: (bus) => buildMelody(bus, { osc: 'sawtooth', vol: -22, wet: 0.22, env: { attack: 0.004, decay: 0.16, sustain: 0.05, release: 0.3 }, events: [
      { time: '0:0:0', notes: ['A3', 'C4', 'E4'], dur: '8n' },
      { time: '0:1:2', notes: ['A3', 'C4', 'E4'], dur: '16n', vel: 0.6 },
      { time: '0:3:0', notes: ['C4', 'E4', 'G4'], dur: '8n' },
      { time: '1:0:0', notes: ['D4', 'G4', 'A4'], dur: '8n' },
      { time: '1:2:0', notes: ['G3', 'C4', 'E4'], dur: '8n' },
      { time: '1:3:2', notes: ['A3', 'C4', 'E4'], dur: '16n', vel: 0.6 },
    ] }) },
  { id: 'm_bell', family: 'melody', name: 'Bell Motif', glyph: 'bell', level: 0.7,
    build: (bus) => buildMelody(bus, { osc: 'sine', vol: -13, wet: 0.42, fb: 0.36, delayTime: '4n.', env: { attack: 0.002, decay: 1.2, sustain: 0, release: 1.1 }, events: [
      { time: '0:0:0', notes: ['E5'], dur: '4n' },
      { time: '0:2:2', notes: ['A5'], dur: '4n', vel: 0.7 },
      { time: '1:1:0', notes: ['G5'], dur: '4n', vel: 0.8 },
      { time: '1:3:0', notes: ['D5'], dur: '4n', vel: 0.65 },
    ] }) },
  { id: 'm_riff', family: 'melody', name: 'Plucked Riff', glyph: 'pluck', level: 0.7,
    build: (bus) => buildMelody(bus, { osc: 'triangle', vol: -18, wet: 0.2, env: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.16 }, events: [
      { time: '0:0:0', notes: ['A4'], dur: '16n' }, { time: '0:0:2', notes: ['C5'], dur: '16n', vel: 0.6 },
      { time: '0:1:0', notes: ['D5'], dur: '16n' }, { time: '0:1:2', notes: ['E5'], dur: '16n', vel: 0.6 },
      { time: '0:2:0', notes: ['D5'], dur: '16n' }, { time: '0:2:2', notes: ['C5'], dur: '16n', vel: 0.6 },
      { time: '0:3:0', notes: ['A4'], dur: '16n' }, { time: '0:3:2', notes: ['G4'], dur: '16n', vel: 0.6 },
      { time: '1:0:0', notes: ['A4'], dur: '16n' }, { time: '1:0:2', notes: ['C5'], dur: '16n', vel: 0.6 },
      { time: '1:1:0', notes: ['E5'], dur: '16n' }, { time: '1:1:2', notes: ['G5'], dur: '16n', vel: 0.6 },
      { time: '1:2:0', notes: ['E5'], dur: '16n' }, { time: '1:2:2', notes: ['D5'], dur: '16n', vel: 0.6 },
      { time: '1:3:0', notes: ['C5'], dur: '16n' }, { time: '1:3:2', notes: ['A4'], dur: '16n', vel: 0.6 },
    ] }) },

  /* ---- VOICE ---- */
  { id: 'v_oh', family: 'voice', name: '"Ohh" Pad', glyph: 'ring', level: 0.72,
    build: (bus) => buildVoice(bus, { poly: true, f1: 520, f2: 1020, direct: 0.3, vol: -14, events: [
      { time: '0:0:0', notes: ['A3', 'E4'], dur: '1:2:0', vel: 0.8 },
      { time: '1:2:0', notes: ['C4', 'G4'], dur: '0:2:0', vel: 0.75 },
    ] }) },
  { id: 'v_chant', family: 'voice', name: 'Chant Line', glyph: 'squares', level: 0.72,
    build: (bus) => buildVoice(bus, { fm: true, f1: 800, f2: 1180, direct: 0.18, vol: -10, chorusRate: 4.4, events: bassLine([
      ['0:0:0', 'A3', '16n', 1], ['0:0:2', 'A3', '16n', 0.6], ['0:1:2', 'C4', '16n', 0.85], ['0:2:0', 'A3', '16n', 0.7], ['0:3:2', 'A3', '16n', 0.75],
      ['1:0:0', 'A3', '16n', 1], ['1:1:0', 'G3', '16n', 0.8], ['1:1:2', 'A3', '16n', 0.6], ['1:2:2', 'C4', '16n', 0.85], ['1:3:0', 'A3', '8n', 0.7],
    ]) }) },
  { id: 'v_hum', family: 'voice', name: 'Hum Line', glyph: 'humwave', level: 0.7,
    build: (bus) => buildVoice(bus, { f1: 340, f2: 900, direct: 0.35, vol: -11, harm: 1.01, events: bassLine([
      ['0:0:0', 'A3', '2n', 0.8], ['0:2:0', 'C4', '2n', 0.75],
      ['1:0:0', 'G3', '2n', 0.78], ['1:2:0', 'A3', '2n', 0.72],
    ]) }) },
  { id: 'v_blip', family: 'voice', name: 'Blip Choir', glyph: 'blips', level: 0.65,
    build: (bus) => buildVoice(bus, { fm: true, mi: 9, f1: 1300, f2: 2400, direct: 0.15, vol: -16, env: { attack: 0.004, decay: 0.07, sustain: 0, release: 0.06 }, events: bassLine([
      ['0:0:2', 'E5', '32n', 0.9], ['0:1:2', 'A5', '32n', 0.75], ['0:3:0', 'E5', '32n', 0.8],
      ['1:0:2', 'G5', '32n', 0.85], ['1:2:0', 'A5', '32n', 0.8], ['1:2:2', 'E5', '32n', 0.6], ['1:3:2', 'D5', '32n', 0.7],
    ]) }) },

  /* ---- FX ---- */
  { id: 'f_riser', family: 'fx', name: 'Riser Sweep', glyph: 'riser', level: 0.5, build: buildRiser },
  { id: 'f_vinyl', family: 'fx', name: 'Vinyl Dust', glyph: 'rings', level: 0.65, build: buildVinyl },
  { id: 'f_stutter', family: 'fx', name: 'Tape Stop', glyph: 'stutter', level: 0.6, build: buildStutter },
  { id: 'f_swell', family: 'fx', name: 'Reverse Swell', glyph: 'swell', level: 0.55, build: buildSwell },
];

const BONUS = [
  { id: 'x_garage', family: 'beats', level: 0.6, fade: 1.1, build: buildToms },
  { id: 'x_choir', family: 'voice', level: 0.5, fade: 1.6,
    build: (bus) => buildVoice(bus, { poly: true, f1: 700, f2: 1500, direct: 0.25, vol: -18, events: [
      { time: '0:0:0', notes: ['A4', 'C5', 'E5'], dur: '1:2:0', vel: 0.6 },
      { time: '1:2:0', notes: ['G4', 'C5', 'E5'], dur: '0:2:0', vel: 0.55 },
    ] }) },
  { id: 'x_tape', family: 'fx', level: 0.7, fade: 1.0, build: buildShaker },
  { id: 'x_drive', family: 'melody', level: 0.45, fade: 1.3,
    build: (bus) => buildMelody(bus, { osc: 'sine', vol: -20, wet: 0.45, fb: 0.33, env: { attack: 0.002, decay: 0.1, sustain: 0, release: 0.2 }, events: ARP1.map((n, i) => ({
      time: `${i < 4 ? 0 : 1}:${(i % 4)}:2`, notes: [n.replace(/(\d)$/, (m) => String(Number(m) + 1))], dur: '16n', vel: 0.6,
    })) }) },
];

const ALL_DEFS = {};
SOUNDS.forEach((s) => { ALL_DEFS[s.id] = s; });
BONUS.forEach((s) => { ALL_DEFS[s.id] = s; });
const SOUND_BY_ID = {};
SOUNDS.forEach((s) => { SOUND_BY_ID[s.id] = s; });

const COMBOS = [
  { id: 'garage', name: 'BASEMENT GARAGE', ids: ['b_broken', 's_sub', 'v_chant'], bonus: 'x_garage', blurb: 'Tom shuffle joins in' },
  { id: 'choir', name: 'NEON CHOIR', ids: ['v_oh', 'm_bell', 'f_swell'], bonus: 'x_choir', blurb: 'High harmony opens up' },
  { id: 'tape', name: 'TAPE ROOM', ids: ['b_hats', 'm_riff', 'f_vinyl'], bonus: 'x_tape', blurb: 'Shaker locks the groove' },
  { id: 'drive', name: 'MIDNIGHT DRIVE', ids: ['b_four', 's_oct', 'm_arp'], bonus: 'x_drive', blurb: 'Counter-arp an octave up' },
];

/* ==========================================================================
   ENGINE
   ========================================================================== */
function createEngine() {
  const transport = getTransport();
  transport.bpm.value = BPM;
  transport.timeSignature = 4;
  transport.swing = 0;

  const limiter = new Tone.Limiter(-1.2).connect(getDest());
  const comp = new Tone.Compressor({ threshold: -20, ratio: 3.2, attack: 0.006, release: 0.18, knee: 12 }).connect(limiter);
  const master = new Tone.Gain(0.78).connect(comp);

  const loops = new Map();
  let dead = false;

  function acquire(id) {
    if (loops.has(id)) return loops.get(id);
    const def = ALL_DEFS[id];
    if (!def) return null;
    const gate = new Tone.Gain(0).connect(master);
    const built = def.build(gate);
    const h = {
      id, gate, parts: built.parts,
      nodes: [gate].concat(built.nodes),
      level: def.level == null ? 0.8 : def.level,
      fadeIn: def.fade == null ? 0.025 : def.fade,
      fadeOut: def.fade == null ? 0.09 : Math.min(def.fade, 0.7),
      on: false, mul: 1,
    };
    loops.set(id, h);
    return h;
  }

  /** Absolute next bar downbeat, in transport time. Every entry lands here. */
  function nextBar() {
    const bar = parseInt(String(transport.position).split(':')[0], 10) || 0;
    return `${bar + 1}:0:0`;
  }

  function sync(desired) {
    if (dead) return;
    loops.forEach((h) => {
      if (h.on && !desired.has(h.id)) {
        h.on = false;
        h.parts.forEach((p) => { p.cancel(0); p.stop(0); });
        const now = Tone.now();
        h.gate.gain.cancelScheduledValues(now);
        h.gate.gain.rampTo(0, h.fadeOut);
      }
    });
    desired.forEach((mul, id) => {
      const h = acquire(id);
      if (!h) return;
      if (!h.on) {
        h.on = true;
        h.mul = mul;
        const at = nextBar();
        h.parts.forEach((p) => { p.cancel(0); p.start(at); });
        transport.scheduleOnce((t) => {
          if (dead || !h.on) return;
          h.gate.gain.cancelScheduledValues(t);
          h.gate.gain.setValueAtTime(0.0001, t);
          h.gate.gain.linearRampToValueAtTime(Math.max(0.0001, h.level * h.mul), t + h.fadeIn);
        }, at);
      } else if (h.mul !== mul) {
        h.mul = mul;
        h.gate.gain.cancelScheduledValues(Tone.now());
        h.gate.gain.rampTo(h.level * mul, 0.07);
      }
    });
  }

  return {
    transport,
    start() {
      if (transport.state !== 'started') {
        transport.position = 0;
        transport.start('+0.08');
      }
    },
    sync,
    setMasterMuted(m) { master.gain.rampTo(m ? 0 : 0.78, 0.06); },
    dispose() {
      if (dead) return;
      dead = true;
      try { transport.stop(); transport.cancel(0); } catch (e) { /* noop */ }
      loops.forEach((h) => {
        h.parts.forEach((p) => { try { p.cancel(0); p.stop(0); p.dispose(); } catch (e) { /* noop */ } });
        h.nodes.forEach((n) => { try { n.dispose(); } catch (e) { /* noop */ } });
      });
      loops.clear();
      [master, comp, limiter].forEach((n) => { try { n.dispose(); } catch (e) { /* noop */ } });
    },
  };
}

const PAL_PRIMARY = ['#ef6461', '#f4a259', '#f6d365', '#8ac926', '#3ec9a7', '#4ea8de', '#9d7bea', '#ef7fae'];
const PAL_ACCENT = ['#ffd166', '#ff8fab', '#7ae582', '#5fd0e8', '#c58cf5', '#ff9f68', '#fdfdfb', '#4c4a55'];
const PAL_DETAIL = ['#fdfdfb', '#ffe9c9', '#2b2b33', '#ffd166', '#c1f0e0', '#bcd7ff', '#e8d7ff', '#ffd0e0'];
const BODY_KINDS = ['round', 'tall', 'blob', 'hex', 'bell', 'spike'];
const EYE_KINDS = ['two', 'cyclops', 'three', 'sleepy', 'square', 'star'];
const MOUTH_KINDS = ['grin', 'oh', 'zig', 'smile', 'tongue', 'fangs'];
const HEAD_KINDS = ['none', 'horns', 'antenna', 'mohawk', 'cap', 'halo'];
const ACC_KINDS = ['none', 'scarf', 'phones', 'badge', 'wings', 'tail'];
const LAYER_LABELS = {
  body: 'Body', eyes: 'Eyes', mouth: 'Mouth', head: 'Headgear', acc: 'Accessory',
};
const LAYER_OPTIONS = {
  body: BODY_KINDS, eyes: EYE_KINDS, mouth: MOUTH_KINDS, head: HEAD_KINDS, acc: ACC_KINDS,
};

/* ==========================================================================
   CHARACTER ART — geometric construction in a 200x320 space.

   Every part shares one coordinate space and is emitted as its own <g> so the
   five slots stay independently swappable. Layer order, back to front:
     feet -> body -> shoulder cap -> head -> ears -> eyes -> mouth
          -> headgear -> accessory
   ========================================================================== */
const VB_W = 200;
const VB_H = 320;
const CX = 100;

/* Body is a straight-sided trapezium. The flare is fixed: the bottom edge is
   always 1.47x the top edge (132/90 in the canonical path), so a variant only
   ever moves the top width and the height — never the silhouette. */
const FLARE = 132 / 90;
const TOP_Y = 110;      // top edge, always tucked behind the head
const CORNER = 8;       // bottom corner radius

const HEAD = { cx: CX, cy: 78, r: 58 };
const EAR = { r: 20, inner: 11, y: 36, dx: 48 };
const FOOT = { rx: 17, ry: 11, dx: 26, drop: 4 };

const n = (v) => Math.round(v * 100) / 100;

/* --- colour: one bodyColour drives body, cap, head, ears and eyelids ------ */
function rgbOf(hex) {
  const h = String(hex).replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function mixTo(hex, target, amt) {
  const [r, g, b] = rgbOf(hex);
  const f = (c) => Math.round(c + (target - c) * amt);
  return `#${[f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
const lighten = (hex, amt) => mixTo(hex, 255, amt);
const darken = (hex, amt) => mixTo(hex, 0, amt);

/* --- geometry ------------------------------------------------------------- */
const BODY_SHAPES = {
  /* topW is bounded above by 96: the head half-width at y=110 is 48.37, and any
     wider top edge would poke out from behind the head. */
  round: { topW: 90, botY: 296 },   // canonical
  tall: { topW: 80, botY: 312 },
  blob: { topW: 96, botY: 286 },
  hex: { topW: 86, botY: 300 },
  bell: { topW: 94, botY: 290 },
  spike: { topW: 78, botY: 306 },
};

function bodyPath(topW, botY) {
  const botW = topW * FLARE;
  const x1 = n(CX - topW / 2);
  const x2 = n(CX + topW / 2);
  const b1 = n(CX - botW / 2);
  const b2 = n(CX + botW / 2);
  const r = CORNER;
  return `M ${x1} ${TOP_Y} L ${x2} ${TOP_Y} L ${b2} ${botY - r} Q ${b2} ${botY} ${n(b2 - r)} ${botY} `
    + `L ${n(b1 + r)} ${botY} Q ${b1} ${botY} ${b1} ${botY - r} Z`;
}

function capPath(topW) {
  const x1 = n(CX - topW / 2);
  const x2 = n(CX + topW / 2);
  return `M ${x1} ${TOP_Y} L ${x2} ${TOP_Y} L ${n(x2 + 2)} 136 Q ${CX} 158 ${n(x1 - 2)} 136 Z`;
}

/* Droopy half-lid: a cap over the top of the eye ellipse with its flat edge
   just below centre. Endpoints sit exactly on the ellipse — the x offset is
   solved from the ellipse equation, never eyeballed. */
function lidGeom(cx, cy, rx, ry, lidY) {
  const dy = lidY - cy;
  const dx = rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2));
  return { x1: n(cx - dx), x2: n(cx + dx), large: dy >= 0 ? 1 : 0 };
}
function lidPath(cx, cy, rx, ry, lidY) {
  const { x1, x2, large } = lidGeom(cx, cy, rx, ry, lidY);
  return `M ${x1} ${lidY} A ${rx} ${ry} 0 ${large} 1 ${x2} ${lidY} Z`;
}

/* Every eye variant keeps the half-lid construction; only the count, the size,
   the lid height and the pupil shape change. */
const EYE_SETS = {
  two: { lidY: 84, pupil: 'round', eyes: [{ cx: 78, cy: 80, rx: 21, ry: 23 }, { cx: 122, cy: 80, rx: 21, ry: 23 }] },
  cyclops: { lidY: 86, pupil: 'round', eyes: [{ cx: 100, cy: 80, rx: 30, ry: 32 }] },
  three: { lidY: 83, pupil: 'round', eyes: [{ cx: 64, cy: 80, rx: 15, ry: 17 }, { cx: 100, cy: 80, rx: 15, ry: 17 }, { cx: 136, cy: 80, rx: 15, ry: 17 }] },
  sleepy: { lidY: 93, pupil: 'round', eyes: [{ cx: 78, cy: 80, rx: 21, ry: 23 }, { cx: 122, cy: 80, rx: 21, ry: 23 }] },
  square: { lidY: 84, pupil: 'square', eyes: [{ cx: 78, cy: 80, rx: 21, ry: 23 }, { cx: 122, cy: 80, rx: 21, ry: 23 }] },
  star: { lidY: 80, pupil: 'star', eyes: [{ cx: 78, cy: 80, rx: 21, ry: 23 }, { cx: 122, cy: 80, rx: 21, ry: 23 }] },
};

const ST = { stroke: OUTLINE, strokeWidth: SW, strokeLinejoin: 'round', strokeLinecap: 'round' };
const EYE_WHITE = '#fbfbf7';
const MOUTH_DARK = '#141118';

/* --- parts ---------------------------------------------------------------- */
function Feet({ botY, accent }) {
  const cy = botY + FOOT.drop;
  return (
    <g data-part="feet">
      <ellipse cx={CX - FOOT.dx} cy={cy} rx={FOOT.rx} ry={FOOT.ry} fill={accent} {...ST} />
      <ellipse cx={CX + FOOT.dx} cy={cy} rx={FOOT.rx} ry={FOOT.ry} fill={accent} {...ST} />
    </g>
  );
}

function Body({ topW, botY, body }) {
  return (
    <g data-part="body">
      <path d={bodyPath(topW, botY)} fill={body} {...ST} />
    </g>
  );
}

function ShoulderCap({ topW, body }) {
  return (
    <g data-part="shoulder">
      <path d={capPath(topW)} fill={lighten(body, 0.18)} stroke="none" />
    </g>
  );
}

function Head({ body }) {
  return (
    <g data-part="head">
      <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} fill={body} {...ST} />
    </g>
  );
}

function Ears({ body }) {
  const light = lighten(body, 0.18);
  return (
    <g data-part="ears">
      {[CX - EAR.dx, CX + EAR.dx].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={EAR.y} r={EAR.r} fill={body} {...ST} />
          <circle cx={cx} cy={EAR.y} r={EAR.inner} fill={light} stroke="none" />
        </g>
      ))}
    </g>
  );
}

function Pupil({ kind, cx, cy, scale, detail }) {
  const r = 10 * scale;
  if (kind === 'square') {
    const s = 13 * scale;
    return (
      <g>
        <rect x={n(cx - s / 2)} y={n(cy - s / 2)} width={n(s)} height={n(s)} rx={n(2 * scale)} fill={detail} stroke="none" />
        <rect x={n(cx - s / 3.4)} y={n(cy - s / 3.4)} width={n(s / 1.7)} height={n(s / 1.7)} fill={OUTLINE} stroke="none" />
      </g>
    );
  }
  if (kind === 'star') {
    const a = 12 * scale;
    const b = 4.4 * scale;
    const pts = [
      [cx, cy - a], [cx + b, cy - b], [cx + a, cy], [cx + b, cy + b],
      [cx, cy + a], [cx - b, cy + b], [cx - a, cy], [cx - b, cy - b],
    ].map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
    return <polygon points={pts} fill={detail} stroke={OUTLINE} strokeWidth={2.4 * scale} strokeLinejoin="round" />;
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={n(r)} fill={detail} stroke="none" />
      <circle cx={cx} cy={cy} r={n(r * 0.56)} fill={OUTLINE} stroke="none" />
      <circle cx={n(cx - r * 0.42)} cy={n(cy - r * 0.5)} r={n(r * 0.26)} fill={EYE_WHITE} stroke="none" />
    </g>
  );
}

function Eyes({ kind, body, detail }) {
  const set = EYE_SETS[kind] || EYE_SETS.two;
  const { lidY, pupil } = set;
  return (
    <g data-part="eyes">
      {/* clip ids are keyed on the eye geometry, so duplicates across characters
          resolve to an identical shape and can safely collide */}
      <defs>
        {set.eyes.map((e, i) => (
          <clipPath key={`c${i}`} id={`sb-eye-${kind}-${i}`}>
            <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} />
          </clipPath>
        ))}
      </defs>
      {/* whites */}
      {set.eyes.map((e, i) => (
        <ellipse key={`w${i}`} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill={EYE_WHITE} stroke="none" />
      ))}
      {/* pupils sit under the lid so it clips them */}
      {set.eyes.map((e, i) => (
        <g key={`p${i}`} clipPath={`url(#sb-eye-${kind}-${i})`}>
          <Pupil kind={pupil} cx={e.cx} cy={lidY + (e.ry - (lidY - e.cy)) * 0.44} scale={e.rx / 21} detail={detail} />
        </g>
      ))}
      {/* lid, filled in the body colour */}
      {set.eyes.map((e, i) => (
        <path key={`l${i}`} d={lidPath(e.cx, e.cy, e.rx, e.ry, lidY)} fill={body} stroke="none" />
      ))}
      {/* outline redrawn on top so the lid edge reads as a hard line */}
      {set.eyes.map((e, i) => {
        const g = lidGeom(e.cx, e.cy, e.rx, e.ry, lidY);
        return (
          <g key={`o${i}`}>
            <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill="none" {...ST} />
            <path d={`M ${g.x1} ${lidY} L ${g.x2} ${lidY}`} fill="none" {...ST} />
          </g>
        );
      })}
    </g>
  );
}

function SingMouth({ accent }) {
  return (
    <g data-part="mouth" style={{ transformOrigin: '100px 107px', animation: `sb-sing ${BEAT_SEC}s ease-in-out infinite` }}>
      <ellipse cx={CX} cy="119" rx="16" ry="12" fill={MOUTH_DARK} {...ST} />
      <rect x="86" y="108" width="28" height="6" rx="2" fill={EYE_WHITE} stroke="none" />
      <ellipse cx={CX} cy="127" rx="8" ry="4" fill={accent} stroke="none" />
    </g>
  );
}

function Mouth({ kind, accent }) {
  const open = { fill: MOUTH_DARK, ...ST };
  const line = { fill: 'none', ...ST };
  let inner;
  switch (kind) {
    case 'oh':
      inner = (
        <>
          <ellipse cx={CX} cy="120" rx="14" ry="14" {...open} />
          <ellipse cx={CX} cy="128" rx="7" ry="4" fill={accent} stroke="none" />
        </>
      );
      break;
    case 'zig':
      inner = <polyline points="68,112 80,128 92,112 104,128 116,112 128,128" {...line} />;
      break;
    case 'smile':
      inner = <path d="M 76 116 Q 100 134 124 116" {...line} />;
      break;
    case 'tongue':
      inner = (
        <>
          <path d="M 68 110 Q 100 148 132 110 Z" {...open} />
          <path d="M 86 124 Q 100 140 114 124 Z" fill={accent} stroke={OUTLINE} strokeWidth={4} strokeLinejoin="round" />
        </>
      );
      break;
    case 'fangs':
      inner = (
        <>
          <path d="M 68 118 H 132" {...line} />
          <polygon points="84,118 96,118 90,134" fill={EYE_WHITE} stroke={OUTLINE} strokeWidth={4} strokeLinejoin="round" />
          <polygon points="110,118 122,118 116,134" fill={EYE_WHITE} stroke={OUTLINE} strokeWidth={4} strokeLinejoin="round" />
        </>
      );
      break;
    default: // grin
      inner = (
        <>
          <path d="M 66 110 Q 100 148 134 110 Z" {...open} />
          <rect x="74" y="110" width="52" height="9" rx="3" fill={EYE_WHITE} stroke="none" />
        </>
      );
  }
  return <g data-part="mouth">{inner}</g>;
}

function Headgear({ kind, accent }) {
  const f = { fill: accent, ...ST };
  let inner = null;
  switch (kind) {
    case 'horns':
      inner = (
        <>
          <path d="M 78 32 L 66 3 L 98 24 Z" {...f} />
          <path d="M 122 32 L 134 3 L 102 24 Z" {...f} />
        </>
      );
      break;
    case 'antenna':
      inner = (
        <>
          <path d="M 100 26 L 100 14" fill="none" {...ST} />
          <circle cx={CX} cy="12" r="8" {...f} />
        </>
      );
      break;
    case 'mohawk':
      inner = <polygon points="74,38 82,7 92,26 100,4 108,26 118,7 126,38" {...f} />;
      break;
    case 'cap':
      inner = (
        <>
          <path d="M 58 44 A 46 46 0 0 1 142 44 Z" {...f} />
          <rect x="46" y="40" width="108" height="12" rx="6" {...f} />
        </>
      );
      break;
    case 'halo':
      inner = <ellipse cx={CX} cy="14" rx="36" ry="9" fill="none" stroke={accent} strokeWidth="9" />;
      break;
    default:
      return null;
  }
  return <g data-part="headgear">{inner}</g>;
}

function Accessory({ kind, accent, detail, topW }) {
  const f = { fill: accent, ...ST };
  let inner = null;
  switch (kind) {
    case 'scarf':
      inner = (
        <>
          <rect x={n(CX - topW / 2 - 4)} y="140" width={n(topW + 8)} height="22" rx="11" {...f} />
          <path d="M 128 160 L 150 206 L 126 199 Z" {...f} />
        </>
      );
      break;
    case 'phones':
      inner = (
        <>
          <path d="M 46 74 A 56 60 0 0 1 154 74" fill="none" stroke={OUTLINE} strokeWidth="14" strokeLinecap="round" />
          <path d="M 46 74 A 56 60 0 0 1 154 74" fill="none" stroke={accent} strokeWidth="7" strokeLinecap="round" />
          <rect x="28" y="58" width="32" height="44" rx="14" {...f} />
          <rect x="140" y="58" width="32" height="44" rx="14" {...f} />
        </>
      );
      break;
    case 'badge':
      inner = (
        <>
          <circle cx={CX} cy="204" r="20" {...f} />
          <polygon
            points="100,192 104.7,201.5 115.2,203 107.6,210.4 109.4,220.9 100,216 90.6,220.9 92.4,210.4 84.8,203 95.3,201.5"
            fill={detail}
            stroke="none"
          />
        </>
      );
      break;
    case 'wings':
      inner = (
        <>
          <path d="M 54 152 C 12 142 10 214 52 208 Z" {...f} />
          <path d="M 146 152 C 188 142 190 214 148 208 Z" {...f} />
        </>
      );
      break;
    case 'tail':
      inner = <path d="M 156 276 C 188 270 188 220 172 206" fill="none" stroke={accent} strokeWidth="15" strokeLinecap="round" />;
      break;
    default:
      return null;
  }
  return <g data-part="accessory">{inner}</g>;
}

function Character({ char, size = 96, singing = false }) {
  const shape = BODY_SHAPES[char.body] || BODY_SHAPES.round;
  const body = char.primary;
  return (
    <div style={{ width: size, height: Math.round((size * VB_H) / VB_W) }}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <Feet botY={shape.botY} accent={char.accent} />
        <Body topW={shape.topW} botY={shape.botY} body={body} />
        <ShoulderCap topW={shape.topW} body={body} />
        <Head body={body} />
        <Ears body={body} />
        <Eyes kind={char.eyes} body={body} detail={char.detail} />
        {singing ? <SingMouth accent={char.accent} /> : <Mouth kind={char.mouth} accent={char.accent} />}
        <Headgear kind={char.head} accent={char.accent} />
        <Accessory kind={char.acc} accent={char.accent} detail={char.detail} topW={shape.topW} />
      </svg>
    </div>
  );
}

const DEFAULT_CHARS = [
  { id: 'c1', name: 'Bopper', body: 'round', eyes: 'two', mouth: 'grin', head: 'antenna', acc: 'scarf', primary: PAL_PRIMARY[0], accent: PAL_ACCENT[0], detail: PAL_DETAIL[0] },
  { id: 'c2', name: 'Thump', body: 'bell', eyes: 'square', mouth: 'fangs', head: 'horns', acc: 'badge', primary: PAL_PRIMARY[5], accent: PAL_ACCENT[3], detail: PAL_DETAIL[1] },
  { id: 'c3', name: 'Wisp', body: 'tall', eyes: 'sleepy', mouth: 'smile', head: 'halo', acc: 'wings', primary: PAL_PRIMARY[4], accent: PAL_ACCENT[6], detail: PAL_DETAIL[4] },
  { id: 'c4', name: 'Grud', body: 'blob', eyes: 'cyclops', mouth: 'tongue', head: 'mohawk', acc: 'tail', primary: PAL_PRIMARY[3], accent: PAL_ACCENT[1], detail: PAL_DETAIL[3] },
  { id: 'c5', name: 'Pip', body: 'hex', eyes: 'three', mouth: 'oh', head: 'cap', acc: 'phones', primary: PAL_PRIMARY[6], accent: PAL_ACCENT[4], detail: PAL_DETAIL[7] },
  { id: 'c6', name: 'Scritch', body: 'spike', eyes: 'star', mouth: 'zig', head: 'none', acc: 'scarf', primary: PAL_PRIMARY[1], accent: PAL_ACCENT[5], detail: PAL_DETAIL[2] },
  { id: 'c7', name: 'Mo', body: 'round', eyes: 'two', mouth: 'oh', head: 'cap', acc: 'phones', primary: PAL_PRIMARY[7], accent: PAL_ACCENT[2], detail: PAL_DETAIL[0] },
];

/* ==========================================================================
   SOUND GLYPHS — one shape per loop, legible at 40px
   ========================================================================== */
function Glyph({ kind, color, size = 40 }) {
  const s = { stroke: color, strokeWidth: 2.4, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  const inner = (() => {
    switch (kind) {
      case 'dots4': return <g>{[5, 11.5, 18, 24.5].map((y, i) => <circle key={i} cx="12" cy={y} r="2.4" fill={color} />)}</g>;
      case 'halfbar': return <g><rect x="3" y="8" width="8" height="14" rx="2" fill={color} /><rect x="16" y="12" width="5" height="6" rx="1.5" fill={color} /></g>;
      case 'broken': return <g><rect x="2" y="6" width="5" height="8" rx="1.5" fill={color} /><rect x="9" y="14" width="5" height="8" rx="1.5" fill={color} /><rect x="16" y="8" width="5" height="12" rx="1.5" fill={color} /></g>;
      case 'ticks': return <g>{[4, 8.5, 13, 17.5, 22].map((x, i) => <path key={i} d={`M${x} 6 L${x} ${i % 2 ? 14 : 20}`} {...s} />)}</g>;
      case 'pulse': return <g><circle cx="12" cy="12" r="4" fill={color} /><circle cx="12" cy="12" r="9" {...s} /></g>;
      case 'octave': return <g><path d="M4 18 L12 6 L20 18" {...s} /><path d="M4 22 H20" {...s} /></g>;
      case 'wave': return <path d="M2 14 Q7 4 12 14 T22 14" {...s} strokeWidth="3" />;
      case 'zig': return <polyline points="2,18 7,8 12,18 17,8 22,14" {...s} strokeWidth="3" />;
      case 'stairs': return <polyline points="3,21 8,21 8,15 13,15 13,9 18,9 18,3 22,3" {...s} />;
      case 'bars': return <g>{[[4, 8, 12], [10, 4, 18], [16, 9, 10]].map(([x, y, h], i) => <rect key={i} x={x} y={y} width="4.5" height={h} rx="1.5" fill={color} />)}</g>;
      case 'bell': return <g><path d="M12 4 C17 4 18 10 18 16 H6 C6 10 7 4 12 4 Z" {...s} /><circle cx="12" cy="20" r="2.4" fill={color} /></g>;
      case 'pluck': return <g><path d="M5 3 V21" {...s} /><path d="M12 6 V18" {...s} /><path d="M19 9 V15" {...s} /></g>;
      case 'ring': return <g><circle cx="12" cy="12" r="8.5" {...s} strokeWidth="3" /><circle cx="12" cy="12" r="3.2" fill={color} /></g>;
      case 'squares': return <g>{[[3, 8], [10, 4], [17, 10]].map(([x, y], i) => <rect key={i} x={x} y={y} width="6" height="6" rx="1.5" fill={color} />)}</g>;
      case 'humwave': return <g><path d="M2 12 Q7 6 12 12 T22 12" {...s} /><path d="M2 18 Q7 14 12 18 T22 18" {...s} strokeWidth="1.8" /></g>;
      case 'blips': return <g>{[[5, 16], [10, 8], [15, 14], [20, 6]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.6" fill={color} />)}</g>;
      case 'riser': return <g><polygon points="3,21 21,3 21,21" fill={color} opacity="0.85" /></g>;
      case 'rings': return <g><circle cx="12" cy="12" r="9.5" {...s} /><circle cx="12" cy="12" r="5.5" {...s} /><circle cx="12" cy="12" r="1.6" fill={color} /></g>;
      case 'stutter': return <g>{[3, 8, 13].map((x, i) => <rect key={i} x={x} y={5 + i * 3} width="3.5" height={14 - i * 4} rx="1.5" fill={color} />)}<path d="M19 8 L19 18" {...s} /></g>;
      case 'swell': return <g><path d="M3 21 C3 8 21 8 21 21" {...s} strokeWidth="3" /><path d="M12 21 V13" {...s} /></g>;
      default: return <circle cx="12" cy="12" r="7" fill={color} />;
    }
  })();
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{inner}</svg>;
}

/* ==========================================================================
   ANIMATION — CSS keyframes only. React never re-renders on the beat.
   Everything is phase-locked to AUDIO_EPOCH via a negative animation-delay.
   ========================================================================== */
let AUDIO_EPOCH = 0;
const phase = (period) => `-${(((typeof performance !== 'undefined' ? performance.now() : 0) - AUDIO_EPOCH) / 1000) % period}s`;

const CSS = `
@keyframes sb-bob {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50%      { transform: translateY(-9px) rotate(2deg); }
}
@keyframes sb-sing {
  0%, 100% { transform: scaleY(0.55); }
  50%      { transform: scaleY(1.15); }
}
@keyframes sb-ping {
  0%   { transform: scale(0.7); opacity: 0.85; }
  70%  { transform: scale(1.5); opacity: 0; }
  100% { transform: scale(1.5); opacity: 0; }
}
@keyframes sb-glow {
  0%, 100% { filter: drop-shadow(0 0 2px rgba(252, 211, 77, 0.35)); }
  50%      { filter: drop-shadow(0 0 16px rgba(252, 211, 77, 0.95)); }
}
@keyframes sb-drop { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: none; } }
@keyframes sb-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.sb-drop { animation: sb-drop 260ms ease-out both; }
.sb-rise { animation: sb-rise 200ms ease-out both; }
.sb-hover { outline: 3px dashed #fcd34d; outline-offset: 3px; }
.sb-scroll { scrollbar-width: thin; scrollbar-color: #52525b transparent; }
.sb-scroll::-webkit-scrollbar { height: 8px; width: 8px; }
.sb-scroll::-webkit-scrollbar-thumb { background: #52525b; border-radius: 9999px; }
.sb-scroll::-webkit-scrollbar-track { background: transparent; }
@media (prefers-reduced-motion: reduce) {
  .sb-anim { animation: none !important; }
}
`;

/* ==========================================================================
   SMALL UI PIECES
   ========================================================================== */
function Splash({ onStart }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-neutral-950 px-6 text-center">
      <div className="pointer-events-none absolute h-72 w-72 rounded-full bg-amber-500 opacity-20 blur-3xl" />
      <div className="relative flex items-end justify-center gap-1">
        {DEFAULT_CHARS.slice(0, 4).map((c) => (
          <div key={c.id}>
            <Character char={c} size={64} />
          </div>
        ))}
      </div>
      <h1 className="relative mt-6 text-4xl font-black tracking-tight text-neutral-50 sm:text-6xl">SONGBRUHS</h1>
      <p className="relative mt-3 max-w-sm text-sm text-neutral-400">
        Hand your crew a sound and they start singing. Everything is synthesised live — no samples, no downloads.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="relative mt-8 flex min-h-16 items-center gap-3 rounded-full bg-amber-400 px-10 text-lg font-black text-neutral-950 hover:bg-amber-300 active:scale-95"
      >
        <Play className="h-6 w-6" fill="currentColor" />
        START
      </button>
      <p className="relative mt-4 text-xs text-neutral-600">110 BPM · A minor · sound starts on tap</p>
    </div>
  );
}

function Pulse() {
  const d = useMemo(() => phase(BAR_SEC), []);
  return (
    <div className="relative flex h-9 w-9 items-center justify-center">
      <span
        className="sb-anim absolute h-7 w-7 rounded-full border-2 border-amber-400"
        style={{ animation: `sb-ping ${BAR_SEC}s linear infinite`, animationDelay: d }}
      />
      <span className="h-3 w-3 rounded-full bg-amber-400" />
    </div>
  );
}

function Slot({ index, slot, sound, singing, comboLit, onTap, selectedFamilyHex }) {
  const bobDelay = useMemo(() => phase(BOB_SEC), [singing]);
  const fam = sound ? FAM[sound.family] : null;
  return (
    <button
      type="button"
      data-slot={index}
      onClick={() => onTap(index)}
      aria-label={sound ? `${slot.char.name} singing ${sound.name}` : `${slot.char.name}, empty slot`}
      className={[
        'group relative flex w-24 shrink-0 flex-col items-center rounded-3xl border-2 p-2 text-center transition-colors sm:w-28',
        comboLit ? 'border-amber-300 bg-neutral-800' : singing ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-800 bg-neutral-900',
      ].join(' ')}
      style={selectedFamilyHex && !singing ? { borderColor: selectedFamilyHex } : undefined}
    >
      <span className="pointer-events-none absolute left-1/2 top-2 h-20 w-20 -translate-x-1/2 rounded-full bg-amber-500 opacity-0 blur-2xl group-hover:opacity-10" />
      <div
        className={[
          'sb-anim relative',
          singing ? '' : 'saturate-50 opacity-70',
        ].join(' ')}
        style={
          singing
            ? {
                animation: `sb-bob ${BOB_SEC}s ease-in-out infinite${comboLit ? `, sb-glow ${BOB_SEC * 2}s ease-in-out infinite` : ''}`,
                animationDelay: comboLit ? `${bobDelay}, ${bobDelay}` : bobDelay,
              }
            : undefined
        }
      >
        <Character char={slot.char} size={72} singing={singing} />
      </div>
      <div className="mt-1 h-10 w-full">
        {sound ? (
          <div className="flex flex-col items-center">
            <span className={`text-xs font-bold leading-tight ${fam.text}`}>{sound.name}</span>
            <span className="mt-0.5 flex items-center gap-1">
              {slot.muted && <VolumeX className="h-3 w-3 text-neutral-500" />}
              {slot.solo && <Headphones className="h-3 w-3 text-amber-300" />}
            </span>
          </div>
        ) : (
          <span className="text-xs font-semibold text-neutral-600">{slot.char.name}</span>
        )}
      </div>
    </button>
  );
}

function TrayItem({ sound, selected, inUse, onPointerDown }) {
  const fam = FAM[sound.family];
  return (
    <button
      type="button"
      disabled={inUse}
      onPointerDown={(e) => onPointerDown(e, sound.id)}
      className={[
        'flex h-20 w-full touch-none select-none flex-col items-center justify-center gap-1 rounded-2xl border-2 bg-neutral-900 px-1 transition-transform',
        inUse ? 'cursor-not-allowed border-neutral-800 opacity-25' : 'border-neutral-800 hover:border-neutral-600 active:scale-95',
        selected ? `ring-4 ${fam.ring} ${fam.border}` : '',
      ].join(' ')}
      aria-pressed={selected}
      aria-label={`${fam.label} — ${sound.name}`}
    >
      <Glyph kind={sound.glyph} color={fam.hex} size={34} />
      <span className="w-full truncate text-center text-xs font-semibold text-neutral-400">{sound.name}</span>
    </button>
  );
}

function Tray({ selected, activeIds, onPointerDown }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {FAM_ORDER.map((fk) => {
        const fam = FAM[fk];
        return (
          <div key={fk} className="rounded-3xl border-2 border-neutral-800 bg-neutral-950 p-2">
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className={`h-2.5 w-2.5 rounded-full ${fam.dot}`} />
              <span className={`text-xs font-black tracking-widest ${fam.text}`}>{fam.label}</span>
            </div>
            <div className="grid grid-cols-4 gap-2 lg:grid-cols-2">
              {SOUNDS.filter((s) => s.family === fk).map((s) => (
                <TrayItem
                  key={s.id}
                  sound={s}
                  selected={selected === s.id}
                  inUse={activeIds.includes(s.id)}
                  onPointerDown={onPointerDown}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CombosPanel({ discovered, activeIds }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {COMBOS.map((c) => {
        const found = discovered.includes(c.id);
        const live = c.ids.every((id) => activeIds.includes(id));
        return (
          <div
            key={c.id}
            className={[
              'rounded-3xl border-2 p-4',
              live ? 'border-amber-300 bg-neutral-800' : found ? 'border-neutral-700 bg-neutral-900' : 'border-neutral-800 bg-neutral-950',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`text-base font-black tracking-wide ${found ? 'text-neutral-50' : 'text-neutral-600'}`}>
                {found ? c.name : '? ? ?'}
              </span>
              {live && <Sparkles className="h-5 w-5 shrink-0 text-amber-300" />}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {c.ids.map((id) => {
                const s = SOUND_BY_ID[id];
                const fam = FAM[s.family];
                return found ? (
                  <span key={id} className="flex items-center gap-1 rounded-full border-2 border-neutral-700 py-1 pl-1 pr-3">
                    <Glyph kind={s.glyph} color={fam.hex} size={20} />
                    <span className="text-xs font-semibold text-neutral-300">{s.name}</span>
                  </span>
                ) : (
                  <span key={id} className={`h-5 w-5 rounded-full ${fam.dot}`} title={fam.label} />
                );
              })}
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              {found ? c.blurb : 'Three sounds, these families. Keep mixing.'}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ==========================================================================
   CHARACTER CREATOR
   ========================================================================== */
const NAME_A = ['Bop', 'Grim', 'Wob', 'Zib', 'Klunk', 'Neen', 'Vex', 'Muro', 'Tink', 'Skree'];
const NAME_B = ['ster', 'lo', 'bit', 'mo', 'zzy', 'lump', 'ka', 'nix', 'oo', 'rah'];
const randomName = () => NAME_A[Math.floor(Math.random() * NAME_A.length)] + NAME_B[Math.floor(Math.random() * NAME_B.length)];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomChar = () => ({
  id: `c_${Math.random().toString(36).slice(2, 9)}`,
  name: randomName(),
  body: pick(BODY_KINDS), eyes: pick(EYE_KINDS), mouth: pick(MOUTH_KINDS),
  head: pick(HEAD_KINDS), acc: pick(ACC_KINDS),
  primary: pick(PAL_PRIMARY), accent: pick(PAL_ACCENT), detail: pick(PAL_DETAIL),
});

function Swatches({ label, palette, value, onChange }) {
  return (
    <div>
      <p className="mb-2 text-xs font-black tracking-widest text-neutral-500">{label.toUpperCase()}</p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {palette.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`${label} ${c}`}
            className={[
              'flex h-11 w-full items-center justify-center rounded-xl border-2',
              value === c ? 'border-amber-300' : 'border-neutral-800',
            ].join(' ')}
            style={{ backgroundColor: c }}
          >
            {value === c && <Check className="h-5 w-5 text-neutral-900" strokeWidth={4} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function LayerRow({ layer, draft, onPick }) {
  return (
    <div>
      <p className="mb-2 text-xs font-black tracking-widest text-neutral-500">{LAYER_LABELS[layer].toUpperCase()}</p>
      <div className="sb-scroll flex gap-2 overflow-x-auto pb-1">
        {LAYER_OPTIONS[layer].map((opt) => {
          const preview = { ...draft, [layer]: opt };
          const on = draft[layer] === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onPick(layer, opt)}
              aria-label={`${LAYER_LABELS[layer]} ${opt}`}
              className={[
                'flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 bg-neutral-900',
                on ? 'border-amber-300' : 'border-neutral-800 hover:border-neutral-600',
              ].join(' ')}
            >
              <Character char={preview} size={38} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Creator({ draft, setDraft, roster, onSave, onSavePlace, running }) {
  const bobDelay = useMemo(() => phase(BOB_SEC), []);
  const setLayer = useCallback((layer, opt) => setDraft((d) => ({ ...d, [layer]: opt })), [setDraft]);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      <div className="lg:col-span-2">
        <div className="sticky top-2 rounded-3xl border-2 border-neutral-800 bg-neutral-950 p-4">
          <div className="flex flex-col items-center">
            <div
              className="sb-anim"
              style={running ? { animation: `sb-bob ${BOB_SEC}s ease-in-out infinite`, animationDelay: bobDelay } : undefined}
            >
              <Character char={draft} size={128} singing={running} />
            </div>
            <input
              value={draft.name}
              maxLength={14}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="mt-3 w-full rounded-2xl border-2 border-neutral-800 bg-neutral-900 px-4 py-3 text-center text-base font-black text-neutral-100"
              aria-label="Character name"
            />
            <div className="mt-3 grid w-full grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDraft(randomChar())}
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-neutral-800 bg-neutral-900 text-sm font-bold text-neutral-300 hover:border-neutral-600"
              >
                <Shuffle className="h-4 w-4" /> Surprise
              </button>
              <button
                type="button"
                onClick={onSave}
                className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-neutral-200 text-sm font-black text-neutral-900 hover:bg-white"
              >
                <Check className="h-4 w-4" /> Save
              </button>
            </div>
            <button
              type="button"
              onClick={onSavePlace}
              className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 text-sm font-black text-neutral-900 hover:bg-amber-300"
            >
              <Sparkles className="h-4 w-4" /> Save &amp; put on stage
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:col-span-3">
        {['body', 'eyes', 'mouth', 'head', 'acc'].map((l) => (
          <LayerRow key={l} layer={l} draft={draft} onPick={setLayer} />
        ))}
        <Swatches label="Primary" palette={PAL_PRIMARY} value={draft.primary} onChange={(c) => setDraft((d) => ({ ...d, primary: c }))} />
        <Swatches label="Accent" palette={PAL_ACCENT} value={draft.accent} onChange={(c) => setDraft((d) => ({ ...d, accent: c }))} />
        <Swatches label="Detail" palette={PAL_DETAIL} value={draft.detail} onChange={(c) => setDraft((d) => ({ ...d, detail: c }))} />

        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-black tracking-widest text-neutral-500">
            <Users className="h-4 w-4" /> ROSTER ({roster.length})
          </p>
          <div className="sb-scroll flex gap-2 overflow-x-auto pb-1">
            {roster.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setDraft({ ...c, id: `c_${Math.random().toString(36).slice(2, 9)}` })}
                className="flex w-20 shrink-0 flex-col items-center rounded-2xl border-2 border-neutral-800 bg-neutral-900 p-1 hover:border-neutral-600"
                title={`Edit a copy of ${c.name}`}
              >
                <Character char={c} size={44} />
                <span className="w-full truncate text-center text-xs font-semibold text-neutral-500">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   APP
   ========================================================================== */
export default function SongBruhs() {
  const [started, setStarted] = useState(false);
  const [tab, setTab] = useState('stage');
  const [roster, setRoster] = useState(DEFAULT_CHARS);
  const [slots, setSlots] = useState(() =>
    DEFAULT_CHARS.map((c) => ({ charId: c.id, soundId: null, muted: false, solo: false })));
  const [selected, setSelected] = useState(null);
  const [sheet, setSheet] = useState(null);        // { kind: 'slot' | 'roster', index }
  const [masterMuted, setMasterMuted] = useState(false);
  const [discovered, setDiscovered] = useState([]);
  const [draft, setDraft] = useState(() => ({ ...randomChar(), name: 'New Bruh' }));
  const [dragging, setDragging] = useState(null);
  const [toast, setToast] = useState(null);

  const engineRef = useRef(null);
  const pendingRef = useRef(null);
  const ghostRef = useRef(null);
  const hoverRef = useRef(null);

  const charById = useMemo(() => {
    const m = {};
    roster.forEach((c) => { m[c.id] = c; });
    return m;
  }, [roster]);

  const view = useMemo(() => slots.map((s) => ({
    ...s,
    char: charById[s.charId] || roster[0],
    sound: s.soundId ? SOUND_BY_ID[s.soundId] : null,
  })), [slots, charById, roster]);

  const activeIds = useMemo(() => slots.map((s) => s.soundId).filter(Boolean), [slots]);

  /* --- what the engine should be playing -------------------------------- */
  const desired = useMemo(() => {
    const anySolo = slots.some((s) => s.soundId && s.solo);
    const map = new Map();
    slots.forEach((s) => {
      if (!s.soundId) return;
      const audible = !s.muted && (!anySolo || s.solo);
      map.set(s.soundId, audible ? 1 : 0);
    });
    return map;
  }, [slots]);

  const liveCombos = useMemo(
    () => COMBOS.filter((c) => c.ids.every((id) => desired.get(id) === 1)),
    [desired],
  );

  const comboSoundIds = useMemo(() => {
    const set = new Set();
    liveCombos.forEach((c) => c.ids.forEach((id) => set.add(id)));
    return set;
  }, [liveCombos]);

  const desiredKey = useMemo(() => {
    const parts = [];
    desired.forEach((v, k) => parts.push(`${k}:${v}`));
    liveCombos.forEach((c) => parts.push(`${c.bonus}:1`));
    return parts.sort().join('|');
  }, [desired, liveCombos]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const full = new Map(desired);
    liveCombos.forEach((c) => full.set(c.bonus, 1));
    eng.sync(full);
    // desiredKey is the stable serialisation that drives this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredKey, started]);

  useEffect(() => {
    if (!liveCombos.length) return;
    setDiscovered((d) => {
      const add = liveCombos.map((c) => c.id).filter((id) => !d.includes(id));
      return add.length ? d.concat(add) : d;
    });
  }, [liveCombos]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setMasterMuted(masterMuted);
  }, [masterMuted]);

  useEffect(() => () => {
    if (engineRef.current) {
      engineRef.current.dispose();
      engineRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const handleStart = useCallback(async () => {
    try {
      await Tone.start();
    } catch (e) { /* older browsers resolve on the gesture anyway */ }
    AUDIO_EPOCH = performance.now();
    engineRef.current = createEngine();
    engineRef.current.start();
    engineRef.current.setMasterMuted(false);
    setStarted(true);
  }, []);

  /* --- assignment -------------------------------------------------------- */
  const assign = useCallback((index, soundId) => {
    setSlots((prev) => prev.map((s, i) => {
      if (i === index) return { ...s, soundId, muted: false, solo: s.solo };
      return s.soundId === soundId ? { ...s, soundId: null, muted: false, solo: false } : s;
    }));
    setSelected(null);
    setSheet(null);
  }, []);

  const clearSlot = useCallback((index) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, soundId: null, muted: false, solo: false } : s)));
    setSheet(null);
  }, []);

  const onSlotTap = useCallback((index) => {
    if (selected) { assign(index, selected); return; }
    if (slots[index].soundId) { setSheet({ kind: 'slot', index }); return; }
    setSheet({ kind: 'roster', index });
  }, [selected, slots, assign]);

  const clearAll = useCallback(() => {
    setSlots((prev) => prev.map((s) => ({ ...s, soundId: null, muted: false, solo: false })));
    setSelected(null);
    setSheet(null);
  }, []);

  const randomise = useCallback(() => {
    const pool = SOUNDS.map((s) => s.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const n = 4 + Math.floor(Math.random() * 3);
    const order = [0, 1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5).slice(0, n);
    setSlots((prev) => prev.map((s, i) => {
      const at = order.indexOf(i);
      return { ...s, soundId: at === -1 ? null : pool[at], muted: false, solo: false };
    }));
    setSelected(null);
    setSheet(null);
  }, []);

  /* --- pointer drag (secondary input; tap-to-assign is primary) ---------- */
  const onTrayPointerDown = useCallback((e, id) => {
    pendingRef.current = { id, x: e.clientX, y: e.clientY, moved: false };
  }, []);

  useEffect(() => {
    function clearHover() {
      if (hoverRef.current) { hoverRef.current.classList.remove('sb-hover'); hoverRef.current = null; }
    }
    function slotAt(x, y) {
      const el = document.elementFromPoint(x, y);
      return el && el.closest ? el.closest('[data-slot]') : null;
    }
    function onMove(e) {
      const p = pendingRef.current;
      if (!p) return;
      if (!p.moved) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 9) return;
        p.moved = true;
        setDragging(p.id);
      }
      e.preventDefault();
      p.x = e.clientX;
      p.y = e.clientY;
      if (ghostRef.current) ghostRef.current.style.transform = `translate(${e.clientX - 34}px, ${e.clientY - 34}px)`;
      const target = slotAt(e.clientX, e.clientY);
      if (target !== hoverRef.current) {
        clearHover();
        if (target) { target.classList.add('sb-hover'); hoverRef.current = target; }
      }
    }
    function onUp(e) {
      const p = pendingRef.current;
      pendingRef.current = null;
      if (!p) return;
      if (p.moved) {
        const target = slotAt(e.clientX, e.clientY);
        clearHover();
        setDragging(null);
        if (target) assign(Number(target.getAttribute('data-slot')), p.id);
      } else {
        setSelected((s) => (s === p.id ? null : p.id));
      }
    }
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      clearHover();
    };
  }, [assign]);

  /* --- creator ----------------------------------------------------------- */
  const saveChar = useCallback((place) => {
    const c = { ...draft, name: draft.name.trim() || randomName(), id: `c_${Math.random().toString(36).slice(2, 9)}` };
    setRoster((r) => r.concat(c));
    if (place) {
      setSlots((prev) => {
        const empty = prev.findIndex((s) => !s.soundId);
        const idx = empty === -1 ? prev.length - 1 : empty;
        return prev.map((s, i) => (i === idx ? { ...s, charId: c.id } : s));
      });
      setTab('stage');
      setToast(`${c.name} joined the stage`);
    } else {
      setToast(`${c.name} added to the roster`);
    }
    setDraft({ ...randomChar(), name: 'New Bruh' });
  }, [draft]);

  const selectedSound = selected ? SOUND_BY_ID[selected] : null;
  const dragSound = dragging ? SOUND_BY_ID[dragging] : null;
  const sheetSlot = sheet ? view[sheet.index] : null;

  if (!started) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <style>{CSS}</style>
        <Splash onStart={handleStart} />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-neutral-950 pb-24 text-neutral-100">
      <style>{CSS}</style>
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-amber-500 opacity-10 blur-3xl" />

      {/* header */}
      <header className="relative flex items-center gap-3 px-3 pt-3 sm:px-5">
        <Music className="h-6 w-6 shrink-0 text-amber-400" />
        <h1 className="text-lg font-black tracking-tight sm:text-2xl">SONGBRUHS</h1>
        <span className="hidden text-xs font-semibold text-neutral-600 sm:inline">110 BPM · A MINOR</span>
        <div className="ml-auto flex items-center gap-2">
          <Pulse />
          <button
            type="button"
            onClick={() => setMasterMuted((m) => !m)}
            aria-pressed={masterMuted}
            className={[
              'flex h-12 w-12 items-center justify-center rounded-2xl border-2',
              masterMuted ? 'border-red-500 bg-neutral-900 text-red-400' : 'border-neutral-800 bg-neutral-900 text-neutral-300',
            ].join(' ')}
            title="Master mute"
          >
            {masterMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {/* combo banner */}
      <div className="relative mt-2 min-h-12 px-3 sm:px-5">
        {liveCombos.length > 0 && (
          <div key={liveCombos.map((c) => c.id).join('-')} className="sb-drop flex flex-wrap items-center gap-2 rounded-2xl border-2 border-amber-300 bg-neutral-900 px-4 py-2">
            <Sparkles className="h-5 w-5 shrink-0 text-amber-300" />
            {liveCombos.map((c) => (
              <span key={c.id} className="text-sm font-black tracking-wide text-amber-200">
                {c.name}
                <span className="ml-2 text-xs font-semibold text-neutral-400">{c.blurb}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <main className="relative mt-2 px-3 sm:px-5">
        {tab === 'stage' && (
          <>
            {/* stage */}
            <div className="relative overflow-hidden rounded-3xl border-2 border-neutral-800 bg-neutral-900 pb-3 pt-4">
              <div className="pointer-events-none absolute bottom-0 h-16 w-full bg-neutral-800" />
              <div className="sb-scroll relative flex gap-2 overflow-x-auto px-3 pb-2 sm:justify-center">
                {view.map((s, i) => (
                  <Slot
                    key={i}
                    index={i}
                    slot={s}
                    sound={s.sound}
                    singing={Boolean(s.soundId) && !s.muted}
                    comboLit={Boolean(s.soundId) && comboSoundIds.has(s.soundId)}
                    onTap={onSlotTap}
                    selectedFamilyHex={selectedSound ? FAM[selectedSound.family].hex : null}
                  />
                ))}
              </div>
            </div>

            {/* controls */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={randomise}
                className="flex min-h-12 items-center gap-2 rounded-2xl border-2 border-neutral-800 bg-neutral-900 px-4 text-sm font-bold text-neutral-200 hover:border-neutral-600"
              >
                <Shuffle className="h-4 w-4" /> Randomise
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="flex min-h-12 items-center gap-2 rounded-2xl border-2 border-neutral-800 bg-neutral-900 px-4 text-sm font-bold text-neutral-200 hover:border-neutral-600"
              >
                <Trash2 className="h-4 w-4" /> Clear all
              </button>
              <p className="ml-auto text-xs font-semibold text-neutral-500">
                {selectedSound ? (
                  <span className={FAM[selectedSound.family].text}>Now tap a character →</span>
                ) : (
                  <span>Tap a sound, then tap a character. Dragging works too.</span>
                )}
              </p>
            </div>

            {/* tray */}
            <div className="mt-3">
              <Tray selected={selected} activeIds={activeIds} onPointerDown={onTrayPointerDown} />
            </div>
          </>
        )}

        {tab === 'create' && (
          <Creator
            draft={draft}
            setDraft={setDraft}
            roster={roster}
            running={!masterMuted}
            onSave={() => saveChar(false)}
            onSavePlace={() => saveChar(true)}
          />
        )}

        {tab === 'combos' && (
          <div>
            <p className="mb-3 text-sm text-neutral-500">
              Four secret sets. Land all three sounds at once and a bonus layer fades in on the next bar.
            </p>
            <CombosPanel discovered={discovered} activeIds={activeIds} />
          </div>
        )}
      </main>

      {/* bottom tabs */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex gap-2 border-t-2 border-neutral-800 bg-neutral-950 px-3 py-2 sm:px-5">
        {[
          { k: 'stage', label: 'Stage', Icon: Music },
          { k: 'create', label: 'Create', Icon: Wand2 },
          { k: 'combos', label: 'Combos', Icon: Sparkles },
        ].map(({ k, label, Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={[
              'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border-2 text-sm font-black',
              tab === k ? 'border-amber-400 bg-neutral-900 text-amber-300' : 'border-neutral-800 bg-neutral-900 text-neutral-500',
            ].join(' ')}
          >
            <Icon className="h-4 w-4" /> {label}
            {k === 'combos' && discovered.length > 0 && (
              <span className="rounded-full bg-neutral-800 px-2 text-xs text-neutral-300">{discovered.length}/4</span>
            )}
          </button>
        ))}
      </nav>

      {/* drag ghost */}
      {dragSound && (
        <div
          ref={(el) => {
            ghostRef.current = el;
            const p = pendingRef.current;
            if (el && p) el.style.transform = `translate(${p.x - 34}px, ${p.y - 34}px)`;
          }}
          className="pointer-events-none fixed left-0 top-0 z-50"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-neutral-600 bg-neutral-900 opacity-90">
            <Glyph kind={dragSound.glyph} color={FAM[dragSound.family].hex} size={34} />
          </div>
        </div>
      )}

      {/* bottom sheet */}
      {sheet && sheetSlot && (
        <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={() => setSheet(null)}>
          <div className="absolute inset-0 bg-neutral-950 opacity-70" />
          <div
            className="sb-rise relative mb-20 w-full max-w-lg rounded-3xl border-2 border-neutral-700 bg-neutral-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <Character char={sheetSlot.char} size={40} />
              <div className="min-w-0">
                <p className="truncate text-base font-black">{sheetSlot.char.name}</p>
                <p className="truncate text-xs text-neutral-500">
                  {sheetSlot.sound ? `${FAM[sheetSlot.sound.family].label} · ${sheetSlot.sound.name}` : 'No sound yet'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSheet(null)}
                className="ml-auto flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-neutral-800 text-neutral-400"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {sheet.kind === 'slot' ? (
              <>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSlots((p) => p.map((s, i) => (i === sheet.index ? { ...s, muted: !s.muted } : s)))}
                    className={[
                      'flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border-2 text-xs font-bold',
                      sheetSlot.muted ? 'border-red-500 bg-neutral-800 text-red-400' : 'border-neutral-800 bg-neutral-950 text-neutral-300',
                    ].join(' ')}
                  >
                    <VolumeX className="h-5 w-5" /> {sheetSlot.muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlots((p) => p.map((s, i) => (i === sheet.index ? { ...s, solo: !s.solo } : s)))}
                    className={[
                      'flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border-2 text-xs font-bold',
                      sheetSlot.solo ? 'border-amber-300 bg-neutral-800 text-amber-300' : 'border-neutral-800 bg-neutral-950 text-neutral-300',
                    ].join(' ')}
                  >
                    <Headphones className="h-5 w-5" /> Solo
                  </button>
                  <button
                    type="button"
                    onClick={() => clearSlot(sheet.index)}
                    className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-neutral-800 bg-neutral-950 text-xs font-bold text-neutral-300"
                  >
                    <Ban className="h-5 w-5" /> Remove
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setSheet({ kind: 'roster', index: sheet.index })}
                  className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-neutral-800 bg-neutral-950 text-sm font-bold text-neutral-300"
                >
                  <Users className="h-4 w-4" /> Swap character
                </button>
              </>
            ) : (
              <div className="sb-scroll mt-4 grid max-h-64 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                {roster.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSlots((p) => p.map((s, i) => (i === sheet.index ? { ...s, charId: c.id } : s)));
                      setSheet(null);
                    }}
                    className={[
                      'flex flex-col items-center rounded-2xl border-2 bg-neutral-950 p-1',
                      c.id === sheetSlot.charId ? 'border-amber-300' : 'border-neutral-800',
                    ].join(' ')}
                  >
                    <Character char={c} size={40} />
                    <span className="w-full truncate text-center text-xs text-neutral-500">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div className="sb-rise pointer-events-none fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-full border-2 border-neutral-700 bg-neutral-900 px-5 py-2 text-sm font-bold text-neutral-100">
          {toast}
        </div>
      )}
    </div>
  );
}
