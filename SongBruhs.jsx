import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import * as Tone from 'tone';
import {
  Play, Volume2, VolumeX, Shuffle, Trash2, X, Check, Sparkles,
  Music, Wand2, Headphones, Users, Ban,
  Coins, Cookie, Medal, Lock, RotateCcw, Star, Ear, Heart, ShoppingBag,
  Mic, Square, BookOpen,
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

  /* immediate (unquantised) UI sounds: instant feedback beats a beat-locked
     delay for coin chimes and level-ups */
  const ding = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.12 },
  }).connect(master);
  ding.volume.value = -14;

  return {
    transport,
    start() {
      if (transport.state !== 'started') {
        transport.position = 0;
        transport.start('+0.08');
      }
    },
    chime() {
      const t = Tone.now();
      ding.triggerAttackRelease('E6', '16n', t, 0.7);
      ding.triggerAttackRelease('A6', '16n', t + 0.09, 0.8);
    },
    levelup() {
      const t = Tone.now();
      ['A5', 'C6', 'E6', 'A6'].forEach((n, i) => ding.triggerAttackRelease(n, '16n', t + i * 0.09, 0.8));
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
      [ding, master, comp, limiter].forEach((n) => { try { n.dispose(); } catch (e) { /* noop */ } });
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

/* Metal-tier gear: earned evolution drawn on top of everything, escalating per
   tier so growth is visible at a glance. Belt zone (y ~242) is the one region
   no body shape, headgear or accessory occupies, so tiers never collide. */
const METAL_HEX = { silver: '#cbd5e1', gold: '#fbbf24', diamond: '#7dd3fc' };
const RAINBOW_HEX = ['#ef6461', '#f4a259', '#f6d365', '#8ac926', '#4ea8de'];
function Sparkle({ x, y, r, fill }) {
  /* coerce: JSX passes numeric-looking attributes as strings, and `y + r`
     would concatenate instead of add, throwing the point off the canvas */
  const cx = Number(x); const cy = Number(y); const rad = Number(r);
  const k = rad * 0.3;
  return (
    <path
      d={`M ${cx} ${cy - rad} L ${cx + k} ${cy - k} L ${cx + rad} ${cy} L ${cx + k} ${cy + k} L ${cx} ${cy + rad} L ${cx - k} ${cy + k} L ${cx - rad} ${cy} L ${cx - k} ${cy - k} Z`}
      fill={fill} stroke={OUTLINE} strokeWidth={2.5} strokeLinejoin="round"
    />
  );
}
function StarBuckle({ fill }) {
  const cx = 100; const cy = 248; const a = 13; const b = 5.2;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? b : a;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + r * Math.cos(ang)).toFixed(1)},${(cy + r * Math.sin(ang)).toFixed(1)}`);
  }
  return <polygon points={pts.join(' ')} fill={fill} stroke={OUTLINE} strokeWidth={3} strokeLinejoin="round" />;
}
function MetalGear({ metal }) {
  if (!metal || metal === 'bronze') return null;
  const belt = { y: 240, h: 16, x: 62, w: 76 };
  return (
    <g data-part="metal" data-metal={metal}>
      {metal === 'rainbow' ? (
        <g>
          {RAINBOW_HEX.map((c, i) => (
            <rect key={c} x={belt.x + (i * belt.w) / 5} y={belt.y} width={belt.w / 5 + 0.5} height={belt.h} fill={c} />
          ))}
          <rect x={belt.x} y={belt.y} width={belt.w} height={belt.h} rx="8" fill="none" stroke={OUTLINE} strokeWidth={4} />
        </g>
      ) : (
        <rect x={belt.x} y={belt.y} width={belt.w} height={belt.h} rx="8"
          fill={metal === 'silver' ? METAL_HEX.silver : METAL_HEX.gold} stroke={OUTLINE} strokeWidth={4} />
      )}
      {metal === 'silver'
        ? <circle cx="100" cy="248" r="9" fill="#f8fafc" stroke={OUTLINE} strokeWidth={3} />
        : <StarBuckle fill={metal === 'gold' ? '#fef3c7' : metal === 'diamond' ? METAL_HEX.diamond : '#fdfdfb'} />}
      {(metal === 'diamond' || metal === 'rainbow') && (
        <g>
          <Sparkle x="26" y="104" r="9" fill={METAL_HEX.diamond} />
          <Sparkle x="174" y="104" r="9" fill={METAL_HEX.diamond} />
          <Sparkle x="36" y="146" r="6" fill={METAL_HEX.diamond} />
        </g>
      )}
      {metal === 'rainbow' && (
        <g>
          <Sparkle x="164" y="146" r="6" fill="#f472b6" />
          <Sparkle x="152" y="66" r="7" fill="#f6d365" />
        </g>
      )}
    </g>
  );
}

function Character({ char, size = 96, singing = false, metal = null }) {
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
        <MetalGear metal={metal} />
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
   LEARNING GAME — phonics monsters, coins, metal tiers, on-device save
   ========================================================================== */
const SAVE_KEY = 'songbruhs_save_v1';
const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 9)}`;
const shuffleArr = (a) => {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/* NumBots-style tiers. xp comes from correct answers (+1) and feeding (+2). */
const METALS = [
  { key: 'bronze', label: 'Bronze', need: 0, text: 'text-orange-400', border: 'border-orange-400' },
  { key: 'silver', label: 'Silver', need: 4, text: 'text-neutral-300', border: 'border-neutral-300' },
  { key: 'gold', label: 'Gold', need: 10, text: 'text-amber-300', border: 'border-amber-300' },
  { key: 'diamond', label: 'Diamond', need: 18, text: 'text-cyan-300', border: 'border-cyan-300' },
  { key: 'rainbow', label: 'Rainbow', need: 30, text: 'text-fuchsia-300', border: 'border-fuchsia-300' },
];
const metalOf = (xp) => { let m = METALS[0]; METALS.forEach((x) => { if (xp >= x.need) m = x; }); return m; };
const nextMetal = (xp) => METALS.find((m) => m.need > xp) || null;

const COIN_CORRECT = 2;
const STREAK_EVERY = 5;
const STREAK_BONUS = 3;
const FEED_XP = 2;   // feeding costs a treat earned by finishing a round

/* The s-a-t-p-i-n crew. `say` is what the browser voice utters for the pure
   sound — TTS can't make a truly clean /t/ or /p/, so these are the closest
   teachable approximations; swap for recorded clips later. */
const PHONEMES = [
  { id: 'ph_s', tempLoop: 'm_arp', letter: 's', say: 'ssss', name: 'Sizzo', price: 0,
    words: ['sun', 'sock', 'sand', 'seal'],
    char: { id: 'ph_s', name: 'Sizzo', body: 'tall', eyes: 'sleepy', mouth: 'smile', head: 'antenna', acc: 'tail', primary: '#3ec9a7', accent: '#7ae582', detail: '#2b2b33' } },
  { id: 'ph_a', tempLoop: 'v_oh', letter: 'a', say: 'a', name: 'Azza', price: 0,
    words: ['ant', 'apple', 'astronaut', 'ambulance'],
    char: { id: 'ph_a', name: 'Azza', body: 'round', eyes: 'two', mouth: 'grin', head: 'mohawk', acc: 'scarf', primary: '#ef6461', accent: '#ffd166', detail: '#2b2b33' } },
  { id: 'ph_t', tempLoop: 'b_four', letter: 't', say: 'tuh', name: 'Tikko', price: 25,
    words: ['tap', 'ten', 'tiger', 'towel'],
    char: { id: 'ph_t', name: 'Tikko', body: 'hex', eyes: 'square', mouth: 'zig', head: 'cap', acc: 'badge', primary: '#4ea8de', accent: '#5fd0e8', detail: '#ffd166' } },
  { id: 'ph_p', tempLoop: 'm_bell', letter: 'p', say: 'puh', name: 'Popsy', price: 25,
    words: ['pig', 'pan', 'panda', 'puddle'],
    char: { id: 'ph_p', name: 'Popsy', body: 'bell', eyes: 'three', mouth: 'tongue', head: 'antenna', acc: 'phones', primary: '#ef7fae', accent: '#ff8fab', detail: '#ffe9c9' } },
  { id: 'ph_i', tempLoop: 'v_blip', letter: 'i', say: 'ih', name: 'Inko', price: 40,
    words: ['ink', 'insect', 'igloo', 'itchy'],
    char: { id: 'ph_i', name: 'Inko', body: 'spike', eyes: 'cyclops', mouth: 'smile', head: 'halo', acc: 'none', primary: '#f6d365', accent: '#fdfdfb', detail: '#2b2b33' } },
  { id: 'ph_n', tempLoop: 's_root', letter: 'n', say: 'nnnn', name: 'Nono', price: 40,
    words: ['net', 'nose', 'nut', 'ninja'],
    char: { id: 'ph_n', name: 'Nono', body: 'blob', eyes: 'star', mouth: 'fangs', head: 'horns', acc: 'wings', primary: '#9d7bea', accent: '#c58cf5', detail: '#ffd166' } },
];
const PHONEME_BY_ID = {};
PHONEMES.forEach((p) => { PHONEME_BY_ID[p.id] = p; });

const PRAISE = ['Brilliant!', 'Well done!', 'Amazing!', 'You got it!', 'Super!'];

/* --- speech ---------------------------------------------------------------
   Browser TTS for prompts; no-ops cleanly where speechSynthesis is missing. */
let cachedVoice;
function speak(text, opts) {
  try {
    if (window.__sbSpeechLog) window.__sbSpeechLog.push(text);
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (cachedVoice === undefined) {
      const vs = synth.getVoices();
      cachedVoice = vs.find((v) => /en[-_]GB/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
    }
    if (cachedVoice) u.voice = cachedVoice;
    u.rate = (opts && opts.rate) || 0.85;
    u.pitch = (opts && opts.pitch) || 1.05;
    synth.speak(u);
  } catch (e) { /* speech unsupported */ }
}

/* --- on-device save ------------------------------------------------------- */
const SAVE_VERSION = 2;
/* v1 -> v2: adds the per-sound stats block. Unknown fields are preserved so a
   downgrade never destroys data; a corrupt save falls back to a fresh start. */
function migrateProfile(p) {
  return {
    createdChars: [],
    discovered: [],
    correct: 0,
    treats: 0,
    words: [],
    captions: false,
    eggFinds: {},
    ...p,
    stats: p.stats && typeof p.stats === 'object' ? p.stats : {},
  };
}
function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s && Array.isArray(s.profiles)) {
      return { ...s, version: SAVE_VERSION, profiles: s.profiles.map(migrateProfile) };
    }
  } catch (e) { /* fresh start */ }
  return { version: SAVE_VERSION, profiles: [], active: null };
}
function persistSave(data) {
  try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* full/blocked */ }
}
function newProfile(name, tier, colour) {
  return {
    id: uid('kid'),
    name,
    tier, // 'A' = 3-5 hear-a-sound, 'B' = 5-7 first-sound-of-word
    colour,
    coins: 10,
    mons: { ph_s: { xp: 0 }, ph_a: { xp: 0 } },
    stats: {},
    treats: 1,
    words: [],
    eggFinds: {},
    createdChars: [],
    discovered: [],
    correct: 0,
  };
}

/* ==========================================================================
   REAL VOICES — parent-recorded phoneme clips.

   Browser TTS cannot produce a clean /t/ or /p/; it says "tuh", "puh", which
   is the schwa error synthetic phonics works to prevent and which makes
   blending impossible. Recorded clips replace TTS for the sounds themselves;
   TTS still handles sentences and praise. Every playback path falls back
   gracefully, so the game works at any stage of recording completeness.
   ========================================================================== */
const CLIP_KEY = 'songbruhs_clips_v1';
const MAX_CLIP_MS = 2500;

/* What the parent is asked to record, in order. `kind` decides where it is
   used: 'sound' replaces the phoneme in every prompt; 'word' is the tier-B
   target; 'praise' is the round finale. */
function recordingScript() {
  const items = [];
  PHONEMES.forEach((p) => {
    items.push({ id: `s:${p.id}`, kind: 'sound', label: `The sound ${p.letter} makes`,
      hint: `Say the pure sound — a short hiss or hum, no “uh” on the end.`, letter: p.letter });
  });
  PHONEMES.forEach((p) => {
    p.words.forEach((w) => items.push({ id: `w:${w}`, kind: 'word', label: w, hint: 'Say the word normally.', letter: w[0] }));
  });
  items.push({ id: 'praise:show', kind: 'praise', label: 'What a show!', hint: 'Big and proud.', letter: '★' });
  items.push({ id: 'praise:yes', kind: 'praise', label: 'You got it!', hint: 'Warm and quick.', letter: '★' });
  return items;
}
const SCRIPT = recordingScript();
const SOUND_CLIPS = SCRIPT.filter((i) => i.kind === 'sound');

/* Clips live in their own storage key so a huge audio blob can never corrupt
   or bloat the game save. */
function loadClips() {
  try {
    const raw = window.localStorage.getItem(CLIP_KEY);
    const c = raw ? JSON.parse(raw) : null;
    if (c && typeof c === 'object') return c;
  } catch (e) { /* start empty */ }
  return {};
}
function persistClips(clips) {
  try { window.localStorage.setItem(CLIP_KEY, JSON.stringify(clips)); return true; } catch (e) { return false; }
}

/* One shared audio element pool: playing a clip must never queue behind TTS. */
let clipRegistry = {};
let clipAudio = null;
function setClipRegistry(c) { clipRegistry = c || {}; }
function hasClip(id) { return Boolean(clipRegistry[id]); }
function playClip(id) {
  const src = clipRegistry[id];
  if (!src) return false;
  try {
    if (!clipAudio) clipAudio = new Audio();
    clipAudio.pause();
    clipAudio.src = src;
    clipAudio.currentTime = 0;
    const pr = clipAudio.play();
    if (pr && pr.catch) pr.catch(() => { /* autoplay guard */ });
    if (window.__sbClipLog) window.__sbClipLog.push(id);
    return true;
  } catch (e) { return false; }
}

/* Say a phoneme: recorded clip first, TTS approximation second. */
function sayPhoneme(ph) {
  if (playClip(`s:${ph.id}`)) return 'clip';
  speak(ph.say);
  return 'tts';
}
/* Say a whole prompt. Where a recorded clip exists for the sound or word, the
   spoken carrier sentence is shortened and the clip carries the phoneme. */
function sayPrompt(q) {
  if (q.word) {
    if (hasClip(`w:${q.word}`)) {
      speak('Which sound does this word start with?');
      window.setTimeout(() => playClip(`w:${q.word}`), 1400);
      return 'clip';
    }
    speak(`Which sound does ${q.word} start with? ... ${q.word}`);
    return 'tts';
  }
  /* fall through to the sound prompt */
  if (hasClip(`s:${q.target.id}`)) {
    speak('Find the monster that says');
    window.setTimeout(() => playClip(`s:${q.target.id}`), 1100);
    return 'clip';
  }
  speak(`Find the monster that says ... ${q.target.say}`);
  return 'tts';
}

/* --- the recorder ---------------------------------------------------------- */
function VoiceRecorder({ clips, setClips, onClose }) {
  const [idx, setIdx] = useState(() => {
    const first = SCRIPT.findIndex((i) => !clips[i.id]);
    return first === -1 ? 0 : first;
  });
  const [state, setState] = useState('idle');   // idle | recording | saved | denied
  const [err, setErr] = useState(null);
  const recRef = useRef(null);
  const streamRef = useRef(null);
  const stopTimer = useRef(null);

  const item = SCRIPT[idx];
  const doneCount = SCRIPT.filter((i) => clips[i.id]).length;
  const soundsDone = SOUND_CLIPS.filter((i) => clips[i.id]).length;

  const cleanup = useCallback(() => {
    clearTimeout(stopTimer.current);
    if (recRef.current && recRef.current.state === 'recording') { try { recRef.current.stop(); } catch (e) { /* noop */ } }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const record = async () => {
    setErr(null);
    if (!navigator.mediaDevices || typeof window.MediaRecorder === 'undefined') {
      setState('denied');
      setErr('This browser will not let the page record. Try Chrome or Safari, or skip — the game still works.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new window.MediaRecorder(stream);
      recRef.current = rec;
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const next = { ...clips, [item.id]: String(reader.result) };
          if (!persistClips(next)) {
            setErr('No room to save that clip. Delete some and try again.');
            setState('idle');
            return;
          }
          setClips(next);
          setState('saved');
        };
        reader.readAsDataURL(blob);
        if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
      };
      rec.start();
      setState('recording');
      stopTimer.current = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, MAX_CLIP_MS);
    } catch (e) {
      setState('denied');
      setErr('Microphone blocked. Allow the mic in your browser, or skip — the game still works.');
    }
  };
  const stopNow = () => { clearTimeout(stopTimer.current); if (recRef.current && recRef.current.state === 'recording') recRef.current.stop(); };
  const go = (d) => { setState('idle'); setIdx((i) => Math.min(SCRIPT.length - 1, Math.max(0, i + d))); };

  return (
    <div className="mx-auto max-w-lg" data-recorder="1">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose} className="flex min-h-12 items-center gap-2 rounded-2xl border-2 border-neutral-700 px-4 text-sm font-bold text-neutral-300">
          <X className="h-4 w-4" /> Done
        </button>
        <span className="ml-auto text-sm font-bold text-neutral-400" data-clips-done={doneCount}>
          {doneCount}/{SCRIPT.length} recorded
        </span>
      </div>

      <div className="mt-3 rounded-3xl border-2 border-neutral-800 bg-neutral-900 p-5 text-center">
        <p className="text-xs font-black tracking-widest text-amber-300">
          {item.kind === 'sound' ? 'PURE SOUND' : item.kind === 'word' ? 'WORD' : 'PRAISE'}
        </p>
        <p className="mt-2 text-5xl font-black text-neutral-50">{item.label}</p>
        <p className="mt-2 text-sm text-neutral-400">{item.hint}</p>
        {item.kind === 'sound' && (
          <p className="mt-1 text-xs text-neutral-500">
            Say “{item.letter}” as in a whisper — not “{item.letter}uh”.
          </p>
        )}

        <div className="mt-5 flex items-center justify-center gap-3">
          {state === 'recording' ? (
            <button
              type="button"
              onClick={stopNow}
              className="flex min-h-16 w-40 items-center justify-center gap-2 rounded-full bg-red-500 text-base font-black text-neutral-950"
            >
              <Square className="h-5 w-5" fill="currentColor" /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={record}
              className="flex min-h-16 w-40 items-center justify-center gap-2 rounded-full bg-amber-400 text-base font-black text-neutral-950 hover:bg-amber-300"
            >
              <Mic className="h-5 w-5" /> {clips[item.id] ? 'Re-record' : 'Record'}
            </button>
          )}
          {clips[item.id] && (
            <button
              type="button"
              onClick={() => playClip(item.id)}
              aria-label="Play back"
              className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-neutral-700 text-neutral-200"
            >
              <Volume2 className="h-6 w-6" />
            </button>
          )}
        </div>
        {state === 'saved' && <p className="mt-3 text-sm font-bold text-green-400">Saved!</p>}
        {err && <p className="mt-3 text-sm font-bold text-red-400">{err}</p>}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => go(-1)} disabled={idx === 0}
          className="min-h-12 rounded-2xl border-2 border-neutral-800 text-sm font-bold text-neutral-300 disabled:opacity-30">
          Back
        </button>
        <button type="button" onClick={() => go(1)} disabled={idx >= SCRIPT.length - 1}
          className="min-h-12 rounded-2xl bg-neutral-200 text-sm font-black text-neutral-900 disabled:opacity-30">
          Next
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-neutral-500">
        The six pure sounds matter most — {soundsDone}/{SOUND_CLIPS.length} done.
        Everything else falls back to the computer voice.
      </p>
    </div>
  );
}

/* ==========================================================================
   THE FUSION — phoneme monsters sing their own sound on the stage, and
   adjacent monsters spelling a word blend it out loud.

   This is what makes the mixer the lesson rather than the reward: arranging
   the band IS arranging phonemes, and putting s-a-t side by side is blending.
   ========================================================================== */

/* Decodable words the blend bridge can fire, built only from the six starting
   graphemes. Hand-curated: every word a child hears is checked, never
   generated. `parts` are the phoneme ids in order. */
const BLEND_WORDS = [
  { word: 'at', parts: ['ph_a', 'ph_t'] },
  { word: 'an', parts: ['ph_a', 'ph_n'] },
  { word: 'as', parts: ['ph_a', 'ph_s'] },
  { word: 'it', parts: ['ph_i', 'ph_t'] },
  { word: 'in', parts: ['ph_i', 'ph_n'] },
  { word: 'is', parts: ['ph_i', 'ph_s'] },
  { word: 'up', parts: ['ph_a', 'ph_p'] },   // 'ap' is not a word; keep the pair out
  { word: 'sat', parts: ['ph_s', 'ph_a', 'ph_t'] },
  { word: 'sap', parts: ['ph_s', 'ph_a', 'ph_p'] },
  { word: 'sit', parts: ['ph_s', 'ph_i', 'ph_t'] },
  { word: 'sin', parts: ['ph_s', 'ph_i', 'ph_n'] },
  { word: 'sip', parts: ['ph_s', 'ph_i', 'ph_p'] },
  { word: 'tap', parts: ['ph_t', 'ph_a', 'ph_p'] },
  { word: 'tan', parts: ['ph_t', 'ph_a', 'ph_n'] },
  { word: 'tin', parts: ['ph_t', 'ph_i', 'ph_n'] },
  { word: 'tip', parts: ['ph_t', 'ph_i', 'ph_p'] },
  { word: 'pat', parts: ['ph_p', 'ph_a', 'ph_t'] },
  { word: 'pan', parts: ['ph_p', 'ph_a', 'ph_n'] },
  { word: 'pin', parts: ['ph_p', 'ph_i', 'ph_n'] },
  { word: 'pit', parts: ['ph_p', 'ph_i', 'ph_t'] },
  { word: 'nap', parts: ['ph_n', 'ph_a', 'ph_p'] },
  { word: 'nip', parts: ['ph_n', 'ph_i', 'ph_p'] },
  { word: 'nit', parts: ['ph_n', 'ph_i', 'ph_t'] },
];
/* 'up' above needs /u/, which is not in this set — drop it rather than teach
   a grapheme the child has not met. */
const WORDS = BLEND_WORDS.filter((w) => w.parts.every((id) => PHONEME_BY_ID[id]) && w.word !== 'up');

/* Find the longest run of adjacent occupied slots that spells a word. */
function findBlend(slotChars) {
  let best = null;
  for (let i = 0; i < slotChars.length; i++) {
    for (const w of WORDS) {
      const n = w.parts.length;
      if (i + n > slotChars.length) continue;
      let match = true;
      for (let k = 0; k < n; k++) if (slotChars[i + k] !== w.parts[k]) { match = false; break; }
      if (match && (!best || n > best.parts.length)) best = { ...w, from: i };
    }
  }
  return best;
}

/* A chant loop: the monster's own recorded sound, gated onto the beat.
   Uses the same lazy-build + quantised-gate machinery as every other loop,
   so a chant enters on the downbeat exactly like a drum pattern. */
function buildChant(bus, cfg) {
  const nodes = [];
  const parts = [];
  const player = new Tone.Player({ url: cfg.url, autostart: false, fadeOut: 0.02 });
  player.connect(bus);
  player.volume.value = -3;
  nodes.push(player);
  const seq = new Tone.Sequence((time, i) => {
    if (!cfg.steps[i]) return;
    try {
      if (player.loaded) player.start(time, 0, cfg.dur);
    } catch (e) { /* overlapping retrigger */ }
  }, IDX32, '16n');
  seq.loop = true;
  parts.push(seq);
  return { nodes, parts };
}

/* Synthesised stand-in when a sound has not been recorded yet: a short
   filtered-noise or tone hit in the phoneme's character, so the stage still
   works before the parent records. Not a substitute for a real voice. */
function buildChantFallback(bus, cfg) {
  const filt = new Tone.Filter({ type: cfg.voiced ? 'bandpass' : 'highpass', frequency: cfg.freq, Q: cfg.voiced ? 4 : 1 }).connect(bus);
  const src = cfg.voiced
    ? new Tone.AMSynth({ harmonicity: 1.4, oscillator: { type: 'sine' }, envelope: { attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.08 } })
    : new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.004, decay: 0.09, sustain: 0.2, release: 0.05 } });
  src.connect(filt);
  src.volume.value = cfg.voiced ? -16 : -22;
  const seq = new Tone.Sequence((time, i) => {
    if (!cfg.steps[i]) return;
    if (cfg.voiced) src.triggerAttackRelease(cfg.note, cfg.dur, time, cfg.steps[i]);
    else src.triggerAttackRelease(cfg.dur, time, cfg.steps[i]);
  }, IDX32, '16n');
  seq.loop = true;
  return { nodes: [src, filt], parts: [seq] };
}

/* Each phoneme chants on its own rhythm so a stacked band stays legible. */
const CHANT_STEPS = {
  ph_s: 'x...x...x...x...x...x...x...x...',
  ph_a: 'x.......x.......x.......x.......',
  ph_t: '..x...x...x...x...x...x...x...x.',
  ph_p: '....x.......x.......x.......x...',
  ph_i: 'x...........x...........x.......',
  ph_n: '..x.......x.......x.......x.....',
};
const CHANT_TONE = {
  ph_s: { voiced: false, freq: 5200, note: 'A4' },
  ph_a: { voiced: true, freq: 800, note: 'A3' },
  ph_t: { voiced: false, freq: 3200, note: 'C4' },
  ph_p: { voiced: false, freq: 1400, note: 'D4' },
  ph_i: { voiced: true, freq: 1900, note: 'E4' },
  ph_n: { voiced: true, freq: 420, note: 'G3' },
};

/* Register a chant loop per phoneme. Loops are defined once at module load and
   built lazily by the engine on first use, exactly like the music loops. */
PHONEMES.forEach((ph) => {
  const steps = pat(CHANT_STEPS[ph.id]);
  const tone = CHANT_TONE[ph.id];
  ALL_DEFS[`chant_${ph.id}`] = {
    id: `chant_${ph.id}`,
    family: 'voice',
    level: 0.85,
    build: (bus) => {
      const url = clipRegistry[`s:${ph.id}`];
      return url
        ? buildChant(bus, { url, steps, dur: 0.32 })
        : buildChantFallback(bus, { ...tone, steps, dur: '16n' });
    },
  };
});

/* A stage slot needs a display name for whatever it is playing. Chants are not
   in the music library, so resolve them to the phoneme they sing. */
function soundInfoFor(soundId) {
  if (!soundId) return null;
  if (SOUND_BY_ID[soundId]) return SOUND_BY_ID[soundId];
  if (soundId.indexOf('chant_') === 0) {
    const ph = PHONEME_BY_ID[soundId.slice('chant_'.length)];
    if (ph) return { id: soundId, family: 'voice', name: `“${ph.letter}” sound`, glyph: 'ring' };
  }
  return null;
}

/* The bridge itself: a bonus layer that speaks the whole word on the downbeat
   of every second bar, so the child hears the parts converge into the word. */
WORDS.forEach((w) => {
  ALL_DEFS[`blend_${w.word}`] = {
    id: `blend_${w.word}`,
    family: 'melody',
    level: 1,
    fade: 0.4,
    build: (bus) => {
      const gain = new Tone.Gain(1).connect(bus);
      const part = loopPart((time) => {
        const clip = clipRegistry[`w:${w.word}`];
        Tone.getDraw().schedule(() => {
          if (clip) playClip(`w:${w.word}`);
          else speak(w.word, { rate: 0.8 });
        }, time);
      }, [{ time: '1:2:0' }]);
      return { nodes: [gain], parts: [part] };
    },
  };
});

/* ==========================================================================
   GAME UI PIECES
   ========================================================================== */
function CoinPill({ coins }) {
  return (
    <span aria-label={`${coins} coins`} data-coins={coins} className="flex h-12 items-center gap-1 rounded-full border-2 border-amber-300 bg-neutral-900 px-3 text-base font-black text-amber-300">
      <Coins className="h-5 w-5" /> {coins}
    </span>
  );
}

function MetalBadge({ xp }) {
  const m = metalOf(xp);
  return (
    <span className={`flex items-center gap-1 rounded-full border-2 ${m.border} bg-neutral-950 px-2 py-0.5 text-xs font-black ${m.text}`}>
      <Medal className="h-3 w-3" /> {m.label}
    </span>
  );
}

function ProfileGate({ save, setSave }) {
  const [creating, setCreating] = useState(save.profiles.length === 0);
  const [name, setName] = useState(save.profiles.length === 0 ? 'Player 1' : '');
  const [colour, setColour] = useState(PAL_PRIMARY[4]);

  const create = () => {
    const p = newProfile(name.trim() || `Player ${save.profiles.length + 1}`, 'A', colour);
    setSave((s) => ({ profiles: s.profiles.concat(p), active: p.id }));
    speak(`Hello ${p.name}! Let's play!`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950 px-4">
      <div className="w-full max-w-md rounded-3xl border-2 border-neutral-800 bg-neutral-900 p-5">
        <h2 className="flex items-center gap-2 text-xl font-black text-neutral-50">
          <Users className="h-5 w-5 text-amber-300" /> Who's playing?
        </h2>

        {!creating && (
          <>
            <div className="mt-4 flex flex-col gap-2">
              {save.profiles.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setSave((s) => ({ ...s, active: p.id })); speak(`Hello ${p.name}!`); }}
                  className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-neutral-700 bg-neutral-950 px-3 text-left hover:border-amber-300"
                >
                  <Character char={{ ...DEFAULT_CHARS[0], primary: p.colour }} size={34} />
                  <span className="flex-1 text-base font-black text-neutral-100">{p.name}</span>
                  <span className="flex items-center gap-1 text-sm font-bold text-amber-300"><Coins className="h-4 w-4" />{p.coins}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border-2 border-neutral-800 text-sm font-bold text-neutral-300 hover:border-neutral-600"
            >
              + New player
            </button>
          </>
        )}

        {creating && (
          <div className="mt-4 flex flex-col gap-4">
            <input
              value={name}
              maxLength={16}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="w-full rounded-2xl border-2 border-neutral-700 bg-neutral-950 px-4 py-3 text-center text-lg font-black text-neutral-100"
              aria-label="Player name"
            />
            <p className="text-center text-xs text-neutral-500">
              Start with sounds; word puzzles arrive on their own as each sound clicks.
            </p>
            <div className="grid grid-cols-8 gap-2">
              {PAL_PRIMARY.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  onClick={() => setColour(c)}
                  className={`h-10 rounded-xl border-2 ${colour === c ? 'border-amber-300' : 'border-neutral-800'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={create}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 text-lg font-black text-neutral-950 hover:bg-amber-300"
            >
              <Play className="h-5 w-5" fill="currentColor" /> Let's play!
            </button>
            {save.profiles.length > 0 && (
              <button type="button" onClick={() => setCreating(false)} className="text-sm font-bold text-neutral-500">
                Back
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   THE QUIET TEACHER — adaptive question choice and mistake intelligence.

   One number per sound per child drives everything. No dashboards, no
   difficulty settings: the child just finds that the island offered the right
   thing today.
   ========================================================================== */
const M_MAX = 5;
const M_FLUENT = 4;          // at or above this a sound counts as known
const IMPULSE_MS = 700;      // a wrong tap faster than this is a slip, not a gap
const CONTRAST_CLEAN = 3;    // clean answers needed to close a contrast drill
const CONFUSION_TRIGGER = 2; // same distractor beating the same target this often

/* mastery: fast clean correct +1, slow or assisted +0.5, wrong -1, floor 0 */
function masteryOf(stat) {
  if (!stat || !stat.asked) return 0;
  const m = stat.fastRight * 1 + (stat.right - stat.fastRight) * 0.5 - stat.wrong * 1;
  return Math.max(0, Math.min(M_MAX, m));
}
const masteryMap = (profile) => {
  const out = {};
  PHONEMES.forEach((p) => { if (profile.mons[p.id]) out[p.id] = masteryOf(profile.stats[p.id]); });
  return out;
};

/* The confusion a child keeps making: the distractor that has beaten this
   target most often, if it has done so enough times to be a pattern. */
function worstConfusion(profile) {
  let worst = null;
  Object.keys(profile.stats || {}).forEach((targetId) => {
    if (!profile.mons[targetId]) return;
    const conf = profile.stats[targetId].confusions || {};
    Object.keys(conf).forEach((otherId) => {
      if (!profile.mons[otherId]) return;
      if (conf[otherId] < CONFUSION_TRIGGER) return;
      if (!worst || conf[otherId] > worst.count) worst = { targetId, otherId, count: conf[otherId] };
    });
  });
  return worst;
}

/* Weighted pick: mostly wobbly sounds, some of the newest, a little
   maintenance of what is already known. */
function pickTarget(profile, lastTargetId) {
  const m = masteryMap(profile);
  const ids = Object.keys(m);
  if (!ids.length) return PHONEMES[0].id;
  const avail = ids.length > 1 ? ids.filter((id) => id !== lastTargetId) : ids;
  const wobbly = avail.filter((id) => m[id] > 0 && m[id] < M_FLUENT);
  const fresh = avail.filter((id) => m[id] === 0);
  const known = avail.filter((id) => m[id] >= M_FLUENT);
  const roll = Math.random();
  let pool;
  if (roll < 0.6) pool = wobbly.length ? wobbly : (fresh.length ? fresh : known);
  else if (roll < 0.8) pool = fresh.length ? fresh : (wobbly.length ? wobbly : known);
  else pool = known.length ? known : (wobbly.length ? wobbly : fresh);
  if (!pool || !pool.length) pool = avail;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* Tier is no longer a parent setting: word questions mix in per sound as that
   sound becomes fluent, so the game finds the level instead of being told. */
function wantsWordQuestion(profile, targetId) {
  if (profile.tier === 'B') return true;
  return masteryOf(profile.stats[targetId]) >= M_FLUENT;
}

/* Curriculum unlocks follow mastery, not the wallet: the shop only offers the
   next monster once the child is fluent in three of the sounds they own. */
function fluentCount(profile) {
  return Object.values(masteryMap(profile)).filter((v) => v >= M_FLUENT).length;
}
function shopUnlocked(profile) {
  return fluentCount(profile) >= 3;
}

/* ==========================================================================
   NEW ARRIVALS — GPC sets 2-4 arrive as eggs that hum their sound.

   The audit's content cliff: a motivated child owned the whole catalogue in
   one sitting. New sounds now arrive as events rather than purchases — an egg
   appears, hums, and hatches once the child has found its sound three times.
   ========================================================================== */
const HATCH_FINDS = 3;

/* Phase 2 order, continued. Colours and parts are chosen so each set reads as
   a family without repeating an existing monster. */
const SET_2 = [
  { id: 'ph_m', letter: 'm', say: 'mmmm', name: 'Mumbo', words: ['man', 'map', 'moon', 'milk'],
    char: { id: 'ph_m', name: 'Mumbo', body: 'bell', eyes: 'sleepy', mouth: 'smile', head: 'horns', acc: 'scarf', primary: '#e07a5f', accent: '#f2cc8f', detail: '#2b2b33' } },
  { id: 'ph_d', letter: 'd', say: 'd', name: 'Didi', words: ['dog', 'dad', 'duck', 'dish'],
    char: { id: 'ph_d', name: 'Didi', body: 'round', eyes: 'three', mouth: 'grin', head: 'antenna', acc: 'badge', primary: '#7f9cf5', accent: '#c3dafe', detail: '#2b2b33' } },
  { id: 'ph_g', letter: 'g', say: 'g', name: 'Gogo', words: ['goat', 'gate', 'gum', 'garden'],
    char: { id: 'ph_g', name: 'Gogo', body: 'blob', eyes: 'two', mouth: 'tongue', head: 'mohawk', acc: 'tail', primary: '#68d391', accent: '#f6e05e', detail: '#2b2b33' } },
  { id: 'ph_o', letter: 'o', say: 'o', name: 'Ollo', words: ['octopus', 'olive', 'ostrich', 'orange'],
    char: { id: 'ph_o', name: 'Ollo', body: 'hex', eyes: 'cyclops', mouth: 'oh', head: 'halo', acc: 'none', primary: '#f6ad55', accent: '#fefcbf', detail: '#2b2b33' } },
  { id: 'ph_c', letter: 'c', say: 'c', name: 'Kiko', words: ['cat', 'cup', 'car', 'castle'],
    char: { id: 'ph_c', name: 'Kiko', body: 'spike', eyes: 'square', mouth: 'fangs', head: 'cap', acc: 'wings', primary: '#b794f4', accent: '#e9d8fd', detail: '#2b2b33' } },
  { id: 'ph_k', letter: 'k', say: 'k', name: 'Kappa', words: ['king', 'kite', 'key', 'kitten'],
    char: { id: 'ph_k', name: 'Kappa', body: 'tall', eyes: 'star', mouth: 'zig', head: 'none', acc: 'phones', primary: '#4fd1c5', accent: '#b2f5ea', detail: '#2b2b33' } },
];
const SET_3 = [
  { id: 'ph_e', letter: 'e', say: 'e', name: 'Ellie', words: ['egg', 'elephant', 'engine', 'exit'],
    char: { id: 'ph_e', name: 'Ellie', body: 'round', eyes: 'sleepy', mouth: 'oh', head: 'antenna', acc: 'scarf', primary: '#fc8181', accent: '#fed7d7', detail: '#2b2b33' } },
  { id: 'ph_u', letter: 'u', say: 'u', name: 'Umbo', words: ['umbrella', 'up', 'under', 'uncle'],
    char: { id: 'ph_u', name: 'Umbo', body: 'bell', eyes: 'two', mouth: 'grin', head: 'cap', acc: 'badge', primary: '#63b3ed', accent: '#bee3f8', detail: '#2b2b33' } },
  { id: 'ph_r', letter: 'r', say: 'rrrr', name: 'Rara', words: ['rat', 'run', 'rock', 'rabbit'],
    char: { id: 'ph_r', name: 'Rara', body: 'spike', eyes: 'star', mouth: 'fangs', head: 'mohawk', acc: 'tail', primary: '#f687b3', accent: '#fed7e2', detail: '#2b2b33' } },
  { id: 'ph_h', letter: 'h', say: 'h', name: 'Hooha', words: ['hat', 'hop', 'house', 'hand'],
    char: { id: 'ph_h', name: 'Hooha', body: 'blob', eyes: 'three', mouth: 'smile', head: 'halo', acc: 'wings', primary: '#9ae6b4', accent: '#f0fff4', detail: '#2b2b33' } },
];
const SET_4 = [
  { id: 'ph_b', letter: 'b', say: 'b', name: 'Bobo', words: ['bat', 'bus', 'ball', 'button'],
    char: { id: 'ph_b', name: 'Bobo', body: 'hex', eyes: 'cyclops', mouth: 'tongue', head: 'horns', acc: 'phones', primary: '#f6e05e', accent: '#2d3748', detail: '#ffffff' } },
  { id: 'ph_f', letter: 'f', say: 'ffff', name: 'Fofo', words: ['fish', 'fan', 'fox', 'finger'],
    char: { id: 'ph_f', name: 'Fofo', body: 'tall', eyes: 'square', mouth: 'zig', head: 'antenna', acc: 'none', primary: '#4299e1', accent: '#ebf8ff', detail: '#2b2b33' } },
  { id: 'ph_l', letter: 'l', say: 'llll', name: 'Lulu', words: ['leg', 'lamp', 'log', 'lemon'],
    char: { id: 'ph_l', name: 'Lulu', body: 'round', eyes: 'two', mouth: 'oh', head: 'mohawk', acc: 'scarf', primary: '#ed8936', accent: '#feebc8', detail: '#2b2b33' } },
];

/* A set unlocks when the child is fluent in most of the previous one, so the
   curriculum paces itself to the learner rather than to the wallet. */
const GPC_SETS = [
  { id: 'set1', label: 'First sounds', members: PHONEMES.map((p) => p.id), needFluent: 0 },
  { id: 'set2', label: 'Next sounds', members: SET_2.map((p) => p.id), needFluent: 4 },
  { id: 'set3', label: 'More sounds', members: SET_3.map((p) => p.id), needFluent: 8 },
  { id: 'set4', label: 'Last sounds', members: SET_4.map((p) => p.id), needFluent: 11 },
];

/* Register the new monsters. Everything downstream — chants, questions, the
   shop, the parent card — reads from PHONEMES, so this is the only place a new
   set has to be added. */
[].concat(SET_2, SET_3, SET_4).forEach((ph, i) => {
  ph.price = 40 + i * 5;
  PHONEMES.push(ph);
  PHONEME_BY_ID[ph.id] = ph;
});

/* Which set a sound belongs to, and whether the child has reached it. */
function setOf(phId) {
  return GPC_SETS.find((s) => s.members.indexOf(phId) !== -1) || GPC_SETS[0];
}
function setReached(profile, set) {
  return fluentCount(profile) >= set.needFluent;
}

/* The next egg: the first sound the child does not own, from a set they have
   reached. Eggs hum, and hatch after the child finds the sound HATCH_FINDS
   times in play. */
function nextEgg(profile) {
  for (const set of GPC_SETS) {
    if (!setReached(profile, set)) return null;
    for (const id of set.members) {
      if (!profile.mons[id]) return { id, set };
    }
  }
  return null;
}
const eggFinds = (profile, id) => (profile.eggFinds || {})[id] || 0;

/* ==========================================================================
   THE FAMILY CORNER — everything that is not for a four-year-old, behind a
   hold-to-open gate: the parent card, the voice recorder, the character
   creator, and player switching.
   ========================================================================== */
const HOLD_MS = 1500;

function HoldGate({ onOpen }) {
  const [held, setHeld] = useState(0);
  const timer = useRef(null);
  const start = () => {
    clearInterval(timer.current);
    const t0 = performance.now();
    timer.current = setInterval(() => {
      const pct = Math.min(1, (performance.now() - t0) / HOLD_MS);
      setHeld(pct);
      if (pct >= 1) { clearInterval(timer.current); setHeld(0); onOpen(); }
    }, 50);
  };
  const stop = () => { clearInterval(timer.current); setHeld(0); };
  useEffect(() => () => clearInterval(timer.current), []);
  return (
    <div className="mx-auto max-w-lg text-center">
      <p className="text-lg font-black text-neutral-200">Grown-ups only</p>
      <p className="mt-1 text-sm text-neutral-500">Press and hold the button to open.</p>
      <button
        type="button"
        data-hold-gate="1"
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        className="relative mt-5 flex min-h-20 w-full touch-none items-center justify-center overflow-hidden rounded-3xl border-2 border-neutral-700 bg-neutral-900 text-base font-black text-neutral-200"
      >
        <span className="absolute left-0 top-0 h-full bg-amber-400 opacity-30" style={{ width: `${Math.round(held * 100)}%` }} />
        <span className="relative flex items-center gap-2"><Lock className="h-5 w-5" /> Hold to open</span>
      </button>
    </div>
  );
}

/* Ten seconds of reading, no charts. Knows / improving / practising, plus one
   thing to try away from the screen. */
function ParentCard({ profile }) {
  const rows = PHONEMES.filter((ph) => profile.mons[ph.id]).map((ph) => {
    const st = profile.stats[ph.id];
    const m = masteryOf(st);
    const asked = st ? st.asked : 0;
    const acc = asked ? Math.round((st.right / asked) * 100) : null;
    let band = 'new';
    if (m >= M_FLUENT) band = 'knows';
    else if (asked >= 4 && acc !== null && acc >= 60) band = 'improving';
    else if (asked >= 4) band = 'practising';
    return { ph, m, asked, acc, band };
  });
  const by = (b) => rows.filter((r) => r.band === b);
  const practising = by('practising');
  const answered = rows.reduce((n, r) => n + r.asked, 0);
  const conf = worstConfusion(profile);
  const tipSound = practising[0] || by('improving')[0] || rows[0];

  const Band = ({ title, colour, list, empty }) => (
    <div className="mt-4">
      <p className={`text-xs font-black tracking-widest ${colour}`}>{title}</p>
      {list.length === 0 ? (
        <p className="mt-1 text-sm text-neutral-600">{empty}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {list.map((r) => (
            <span key={r.ph.id} className="flex items-center gap-2 rounded-2xl border-2 border-neutral-800 bg-neutral-950 py-1 pl-2 pr-3">
              <span className="text-2xl font-black text-neutral-100">{r.ph.letter}</span>
              <span className="text-xs text-neutral-500">{r.acc === null ? 'not tried' : `${r.acc}%`}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-lg" data-parent-card={answered}>
      <p className="text-xl font-black text-neutral-50">{profile.name}&rsquo;s reading</p>
      <p className="mt-1 text-sm text-neutral-500">
        {answered} sounds answered · {(profile.words || []).length} words built on the stage
      </p>

      <Band title="KNOWS" colour="text-green-400" list={by('knows')} empty="Nothing mastered yet — that is what the next few rounds are for." />
      <Band title="IMPROVING" colour="text-amber-300" list={by('improving')} empty="Nothing in progress right now." />
      <Band title="NEEDS PRACTICE" colour="text-red-400" list={practising} empty="Nothing is sticking out as hard." />
      <Band title="NOT MET YET" colour="text-neutral-500" list={by('new')} empty="Every sound they own has been tried." />

      <div className="mt-5 rounded-3xl border-2 border-amber-300 bg-neutral-900 p-4">
        <p className="text-xs font-black tracking-widest text-amber-300">TRY THIS AT DINNER</p>
        <p className="mt-2 text-sm text-neutral-200">
          {conf
            ? `${profile.name} sometimes hears “${PHONEME_BY_ID[conf.targetId].letter}” and “${PHONEME_BY_ID[conf.otherId].letter}” as the same sound. Say both slowly and ask which one starts “${PHONEME_BY_ID[conf.targetId].words[0]}”.`
            : tipSound
              ? `Ask ${profile.name} to find three things that start with “${tipSound.ph.letter}” — like ${tipSound.ph.words.slice(0, 2).join(' and ')}.`
              : 'Play a round together and ask them to say each sound out loud with the monster.'}
        </p>
      </div>

      <p className="mt-4 text-xs text-neutral-600">
        Everything stays on this device. Nothing is uploaded, and there is nothing to buy.
      </p>
    </div>
  );
}

/* --- Play tab: rounds of five, ending in a live band performance ---------- */
const LOCKOUT_MS = 1000;   // pause after a wrong tap: interrupts machine-gun guessing
const FAST_MS = 3000;      // a clean correct under this counts as fluent
const CELEBRATE_MS = 1200;
const ROUND_LEN = 5;

/* The metal a monster is currently wearing, for any screen that draws it. */
function metalFor(profile, charId) {
  const owned = profile && profile.mons[charId];
  return owned ? metalOf(owned.xp).key : null;
}

function makeQuestion(profile, lastTargetId, forcedId, drill) {
  /* a contrast drill narrows the board to just the two sounds being confused,
     so the child is choosing between them and nothing else */
  if (drill) {
    const target = PHONEME_BY_ID[drill.targetId];
    const other = PHONEME_BY_ID[drill.otherId];
    if (target && other) {
      return { target, word: null, drill: true, choices: shuffleArr([target, other]) };
    }
  }
  const useId = (forcedId && PHONEME_BY_ID[forcedId])
    ? forcedId
    : pickTarget(profile, lastTargetId);
  const target = PHONEME_BY_ID[useId] || PHONEMES[0];
  const others = shuffleArr(PHONEMES.filter((p) => p.id !== target.id)).slice(0, 2);
  const asWord = wantsWordQuestion(profile, target.id);
  return {
    target,
    word: asWord ? target.words[Math.floor(Math.random() * target.words.length)] : null,
    choices: shuffleArr([target, ...others]),
  };
}
function promptFor(q) {
  return q.word
    ? `Which sound does ${q.word} start with? ... ${q.word}`
    : `Find the monster that says ... ${q.target.say}`;
}

/* Per-sound flight recorder: one aggregate row per grapheme-phoneme pair.
   asked counts completed questions; confusions counts every wrong tap by
   which distractor was chosen. Feeds the P4 adaptive engine and P5 parent card. */
const emptyStat = () => ({ asked: 0, right: 0, fastRight: 0, wrong: 0, totalMs: 0, confusions: {} });
const statOf = (pr, id) => pr.stats[id] || emptyStat();

/* The round payoff: the child's own monsters take the stage and play. */
function Finale({ profile, coins, onAgain }) {
  const band = PHONEMES.filter((p) => profile.mons[p.id]);
  const bobDelay = useMemo(() => phase(BOB_SEC), []);
  return (
    <div className="sb-rise mx-auto max-w-lg text-center" data-finale="1">
      <p className="text-2xl font-black text-amber-300">Show time!</p>
      <p className="mt-1 text-sm text-neutral-400">Your band is playing your round.</p>
      <div className="sb-scroll mt-4 flex items-end justify-center gap-1 overflow-x-auto rounded-3xl border-2 border-amber-300 bg-neutral-900 px-2 py-4">
        {band.map((p) => (
          <div
            key={p.id}
            className="sb-anim shrink-0"
            style={{ animation: `sb-bob ${BOB_SEC}s ease-in-out infinite`, animationDelay: bobDelay }}
          >
            <Character char={p.char} size={66} singing metal={metalFor(profile, p.id)} />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-center gap-4">
        <span className="flex items-center gap-1 text-lg font-black text-amber-300">
          <Coins className="h-5 w-5" /> +{coins}
        </span>
        <span className="flex items-center gap-1 text-lg font-black text-neutral-200">
          <Cookie className="h-5 w-5" /> +1
        </span>
      </div>
      <button
        type="button"
        onClick={onAgain}
        className="mt-5 flex min-h-16 w-full items-center justify-center gap-2 rounded-3xl bg-amber-400 text-lg font-black text-neutral-950 hover:bg-amber-300"
      >
        <Play className="h-5 w-5" fill="currentColor" /> Another round!
      </button>
      <p className="mt-3 text-xs text-neutral-600">Or go feed your monsters — the show will be here tomorrow.</p>
    </div>
  );
}

function LearnTab({ profile, updateProfile, setToast, sfx, onPerform, onStopPerform, captions }) {
  const flagRef = useRef([]);            // missed sounds queued to return: {id, countdown}
  const drillRef = useRef(null);         // {targetId, otherId, clean} contrast drill in progress
  const [q, setQ] = useState(() => makeQuestion(profile, null, null));
  const [phaseState, setPhaseState] = useState('ask');   // ask | model | correct | finale
  const [wrongCount, setWrongCount] = useState(0);
  const [wrongId, setWrongId] = useState(null);
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(0);                   // questions completed this round
  const [roundCoins, setRoundCoins] = useState(0);
  const askedAtRef = useRef(0);
  const firstTapMsRef = useRef(null);
  const timer = useRef(null);
  const doneRef = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (phaseState !== 'ask') return;
    askedAtRef.current = performance.now();
    sayPrompt(q);
  }, [q, phaseState]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRound = useCallback(() => {
    onStopPerform();
    doneRef.current = 0;
    setDone(0);
    setRoundCoins(0);
    setPhaseState('ask');
    setWrongCount(0);
    setWrongId(null);
    setLocked(false);
    firstTapMsRef.current = null;
    setQ((old) => makeQuestion(profile, old.target.id, null));
  }, [profile, onStopPerform]);

  /* advance after a completed question: next question, or end the round */
  const advance = useCallback(() => {
    doneRef.current += 1;
    setDone(doneRef.current);
    if (doneRef.current >= ROUND_LEN) {
      const band = PHONEMES.filter((p) => profile.mons[p.id]).map((p) => p.tempLoop).filter(Boolean);
      updateProfile((pr) => ({ ...pr, treats: (pr.treats || 0) + 1 }));
      onPerform(band);
      if (!playClip('praise:show')) speak('What a show! Your band sounds amazing!');
      setPhaseState('finale');
      return;
    }
    /* a contrast drill runs until the pair is clean, then hands back */
    if (drillRef.current && drillRef.current.clean >= CONTRAST_CLEAN) {
      const solved = drillRef.current;
      updateProfile((pr) => {
        const st = statOf(pr, solved.targetId);
        const conf = { ...st.confusions };
        delete conf[solved.otherId];
        return { ...pr, stats: { ...pr.stats, [solved.targetId]: { ...st, confusions: conf } } };
      });
      drillRef.current = null;
    }
    if (!drillRef.current) {
      const conf = worstConfusion(profile);
      if (conf) drillRef.current = { ...conf, clean: 0 };
    }
    flagRef.current.forEach((f) => { f.countdown -= 1; });
    const due = flagRef.current.find((f) => f.countdown <= 0);
    if (due) flagRef.current = flagRef.current.filter((f) => f !== due);
    /* every few questions the waiting egg's sound is the target, so a new
       sound is met in play rather than bought */
    const egg = nextEgg(profile);
    /* One question in five, not one in three: an egg should hatch within a
       sitting without stealing practice from the sounds being consolidated. */
    const eggTurn = egg && !drillRef.current && !due && Math.random() < 0.2;
    setQ((old) => makeQuestion(profile, old.target.id, eggTurn ? egg.id : (due ? due.id : null), drillRef.current));
    setPhaseState('ask');
    setWrongCount(0);
    setWrongId(null);
    setLocked(false);
    firstTapMsRef.current = null;
  }, [profile, updateProfile, onPerform]);

  /* An unowned sound can still appear as a distractor; finding it correctly is
     what hatches its egg. Progress is counted on the profile, not in the round. */
  const noteEggFind = (id) => {
    updateProfile((pr) => {
      if (pr.mons[id]) return pr;
      const finds = { ...(pr.eggFinds || {}) };
      finds[id] = (finds[id] || 0) + 1;
      if (finds[id] < HATCH_FINDS) return { ...pr, eggFinds: finds };
      delete finds[id];
      return { ...pr, eggFinds: finds, mons: { ...pr.mons, [id]: { xp: 0 } } };
    });
  };

  const finishCorrect = (p, clean) => {
    setPhaseState('correct');
    if (drillRef.current) drillRef.current.clean = clean ? drillRef.current.clean + 1 : 0;
    const ms = firstTapMsRef.current == null ? FAST_MS : firstTapMsRef.current;
    const coins = clean ? COIN_CORRECT : 1;
    const owned = profile.mons[p.id];
    if (!owned) {
      /* this was the egg's sound: count the find, hatch at three */
      const finds = eggFinds(profile, p.id) + 1;
      noteEggFind(p.id);
      setRoundCoins((c) => c + coins);
      updateProfile((pr) => ({ ...pr, coins: pr.coins + coins, correct: pr.correct + 1 }));
      if (finds >= HATCH_FINDS) {
        sfx.levelup();
        speak(`It hatched! Say hello to ${p.name}!`);
        setToast(`${p.name} hatched!`);
      } else {
        sfx.chime();
        setToast(`The egg wobbled! ${HATCH_FINDS - finds} to go`);
      }
      timer.current = setTimeout(advance, CELEBRATE_MS + (finds >= HATCH_FINDS ? 700 : 0));
      return;
    }
    const prevXp = owned.xp;
    const grew = metalOf(prevXp + 1).key !== metalOf(prevXp).key;
    setRoundCoins((c) => c + coins);
    updateProfile((pr) => {
      const s = statOf(pr, p.id);
      return {
        ...pr,
        coins: pr.coins + coins,
        correct: pr.correct + 1,
        mons: { ...pr.mons, [p.id]: { xp: (pr.mons[p.id] ? pr.mons[p.id].xp : 0) + 1 } },
        stats: {
          ...pr.stats,
          [p.id]: {
            ...s,
            asked: s.asked + 1,
            right: s.right + 1,
            fastRight: s.fastRight + (clean && ms < FAST_MS ? 1 : 0),
            totalMs: s.totalMs + Math.round(ms),
          },
        },
      };
    });
    /* Celebration economy: routine successes get a sound, not a speech. Voice
       is reserved for level-ups and the end of a round so it keeps meaning. */
    if (grew) {
      sfx.levelup();
      speak(`${p.name} is now ${metalOf(prevXp + 1).label}!`);
      setToast(`${p.name} reached ${metalOf(prevXp + 1).label}!`);
    } else {
      sfx.chime();
    }
    timer.current = setTimeout(advance, grew ? CELEBRATE_MS + 700 : CELEBRATE_MS);
  };

  const answer = (p) => {
    if (locked || phaseState === 'correct' || phaseState === 'finale') return;

    if (phaseState === 'model') {
      if (p.id !== q.target.id) return;
      setPhaseState('correct');
      updateProfile((pr) => {
        const s = statOf(pr, q.target.id);
        return { ...pr, stats: { ...pr.stats, [q.target.id]: { ...s, asked: s.asked + 1, wrong: s.wrong + 1 } } };
      });
      speak("That's it!");
      window.setTimeout(() => sayPhoneme(q.target), 800);
      if (drillRef.current) drillRef.current.clean = 0;
      timer.current = setTimeout(advance, CELEBRATE_MS);
      return;
    }

    const tapMs = performance.now() - askedAtRef.current;
    if (firstTapMsRef.current == null) firstTapMsRef.current = tapMs;

    if (p.id === q.target.id) {
      finishCorrect(p, wrongCount === 0);
      return;
    }

    const wc = wrongCount + 1;
    setWrongCount(wc);
    setWrongId(p.id);
    setLocked(true);
    /* An impulse tap (faster than a child can have listened) is a slip, not a
       gap in knowledge: it still ends the question's full reward, but it does
       not teach the model that the sound is unknown. */
    const impulse = tapMs < IMPULSE_MS;
    if (!impulse) {
      updateProfile((pr) => {
        const s = statOf(pr, q.target.id);
        return {
          ...pr,
          stats: {
            ...pr.stats,
            [q.target.id]: { ...s, confusions: { ...s.confusions, [p.id]: (s.confusions[p.id] || 0) + 1 } },
          },
        };
      });
    }
    /* On a two-card contrast drill there is no second chance to give: the only
       other card IS the answer, so tapping it would pay for nothing. One wrong
       goes straight to the modelled completion. */
    if (wc >= 2 || q.drill) {
      flagRef.current.push({ id: q.target.id, countdown: 2 });
      if (drillRef.current) drillRef.current.clean = 0;
      speak(`Listen! Tap ${q.target.name}, who says`);
      window.setTimeout(() => sayPhoneme(q.target), 1200);
      timer.current = setTimeout(() => {
        setWrongId(null);
        setLocked(false);
        setPhaseState('model');
      }, LOCKOUT_MS);
    } else {
      speak('That one says');
      window.setTimeout(() => sayPhoneme(p), 700);
      timer.current = setTimeout(() => {
        setWrongId(null);
        setLocked(false);
        sayPrompt(q);
      }, LOCKOUT_MS + 500);
    }
  };

  if (phaseState === 'finale') {
    return <Finale profile={profile} coins={roundCoins} onAgain={startRound} />;
  }

  const revealWord = phaseState === 'correct' && Boolean(q.word);

  return (
    <div className="mx-auto max-w-lg">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => sayPrompt(q)}
          aria-label="Hear it again"
          className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-amber-300 bg-neutral-900 text-amber-300 hover:bg-neutral-800"
        >
          <Volume2 className="h-8 w-8" />
        </button>
        {/* round trail: five slots filling toward the show */}
        <div className="flex items-center gap-1.5" data-trail={done}>
          {Array.from({ length: ROUND_LEN }, (_, i) => (
            <span
              key={i}
              className={[
                'h-4 w-4 rounded-full border-2',
                i < done ? 'border-amber-300 bg-amber-300' : 'border-neutral-700 bg-neutral-900',
              ].join(' ')}
            />
          ))}
        </div>
      </div>

      <div className="mt-3 min-h-20 rounded-3xl border-2 border-neutral-800 bg-neutral-900 p-4 text-center">
        {revealWord ? (
          <p className="text-2xl font-black text-neutral-100" data-reveal={q.word}>
            <span className="text-amber-300">{q.word[0]}</span>{q.word.slice(1)}
          </p>
        ) : phaseState === 'model' ? (
          <p className="text-lg font-black text-amber-300">Tap the monster that sings the sound!</p>
        ) : q.drill ? (
          <p className="text-lg font-black text-amber-300">Just these two. Which one says it?</p>
        ) : q.word ? (
          <p className="text-lg font-black text-neutral-100">Listen! What sound does the word start with?</p>
        ) : (
          <p className="text-lg font-black text-neutral-100">Find the monster that says the sound!</p>
        )}
        {captions && phaseState === 'ask' && (
          <p className="mt-2 text-5xl font-black text-amber-300" data-caption={q.target.letter}>{q.target.letter}</p>
        )}

      </div>

      <div className="mt-3 grid grid-cols-3 gap-2" data-target={q.target.id} data-phase={phaseState}>
        {q.choices.map((p) => {
          const isTarget = p.id === q.target.id;
          const celebrate = phaseState !== 'ask' && isTarget;
          const dimmed = phaseState === 'model' && !isTarget;
          return (
            <button
              key={p.id}
              type="button"
              data-choice={p.id}
              disabled={dimmed}
              onClick={() => answer(p)}
              className={[
                'flex min-h-14 flex-col items-center rounded-3xl border-2 bg-neutral-900 p-2 pt-3',
                celebrate ? 'border-amber-300 bg-neutral-800' : 'border-neutral-800 hover:border-neutral-600',
                dimmed ? 'opacity-30' : '',
                wrongId === p.id ? 'sb-shake border-red-500' : '',
              ].join(' ')}
            >
              <div className={celebrate ? 'sb-anim' : ''} style={celebrate ? { animation: `sb-bob ${BOB_SEC}s ease-in-out infinite` } : undefined}>
                <Character char={p.char} size={64} singing={celebrate} metal={metalFor(profile, p.id)} />
              </div>
              <span className="mt-1 text-4xl font-black text-neutral-100">{p.letter}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-center text-xs text-neutral-600">
        {ROUND_LEN - done} more to the show
      </p>
    </div>
  );
}

/* --- Monsters tab: roster, feeding, metals -------------------------------- */
function EggCard({ profile }) {
  const egg = nextEgg(profile);
  if (!egg) return null;
  const ph = PHONEME_BY_ID[egg.id];
  const finds = eggFinds(profile, egg.id);
  return (
    <button
      type="button"
      data-egg={egg.id}
      data-egg-finds={finds}
      onClick={() => sayPhoneme(ph)}
      aria-label="A wobbling egg"
      className="sb-anim flex min-h-24 items-center gap-3 rounded-3xl border-2 border-amber-300 bg-neutral-900 p-3 text-left"
      style={{ animation: `sb-bob ${BOB_SEC * 2}s ease-in-out infinite` }}
    >
      <svg width="52" height="66" viewBox="0 0 100 130" aria-hidden="true">
        <ellipse cx="50" cy="78" rx="42" ry="50" fill="#f6e7c9" stroke={OUTLINE} strokeWidth="6" />
        <path d="M 16 78 Q 34 66 50 78 Q 66 90 84 78" fill="none" stroke={OUTLINE} strokeWidth="5" strokeLinecap="round" />
        <circle cx="34" cy="52" r="7" fill="#e6cfa5" />
        <circle cx="64" cy="98" r="9" fill="#e6cfa5" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-base font-black text-amber-300">Something is in here…</p>
        <p className="mt-1 text-xs text-neutral-400">
          It hums when you touch it. Find its sound {HATCH_FINDS} times in Play to hatch it.
        </p>
        <div className="mt-2 flex gap-1">
          {Array.from({ length: HATCH_FINDS }, (_, i) => (
            <span key={i} className={`h-3 w-8 rounded-full ${i < finds ? 'bg-amber-300' : 'bg-neutral-800'}`} />
          ))}
        </div>
      </div>
    </button>
  );
}

function MonstersTab({ profile, updateProfile, setToast, onGoShop, sfx }) {
  const treats = profile.treats || 0;
  const feed = (p) => {
    if (treats < 1) { speak('No treats left! Finish a round to earn one.'); return; }
    const prevXp = profile.mons[p.id].xp;
    const grew = metalOf(prevXp + FEED_XP).key !== metalOf(prevXp).key;
    updateProfile((pr) => ({
      ...pr,
      treats: (pr.treats || 0) - 1,
      mons: { ...pr.mons, [p.id]: { xp: pr.mons[p.id].xp + FEED_XP } },
    }));
    if (grew) { sfx.levelup(); setToast(`${p.name} reached ${metalOf(prevXp + FEED_XP).label}!`); }
    speak(grew ? `Yum! ${p.name} is now ${metalOf(prevXp + FEED_XP).label}!` : 'Yum yum! Thank you!', { pitch: 1.3 });
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <EggCard profile={profile} />
      {PHONEMES.map((p) => {
        const owned = profile.mons[p.id];
        if (!owned) {
          /* only the sound the shop is currently offering shows as a locked
             card; everything further out is not yet part of the child's world */
          if (!setReached(profile, setOf(p.id))) return null;
          return (
            <button
              key={p.id}
              type="button"
              onClick={onGoShop}
              className="flex min-h-24 items-center gap-3 rounded-3xl border-2 border-neutral-800 bg-neutral-950 p-3 opacity-60 hover:opacity-90"
            >
              <div className="saturate-0"><Character char={p.char} size={52} /></div>
              <div className="flex-1 text-left">
                <p className="text-base font-black text-neutral-500">? ? ?</p>
                <p className="text-xs text-neutral-600">Waiting in the shop</p>
              </div>
              <Lock className="h-5 w-5 shrink-0 text-neutral-600" />
            </button>
          );
        }
        const m = metalOf(owned.xp);
        const nm = nextMetal(owned.xp);
        return (
          <div key={p.id} className={`rounded-3xl border-2 ${m.border} bg-neutral-900 p-3`}>
            <div className="flex items-center gap-3">
              <Character char={p.char} size={56} metal={m.key} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-base font-black text-neutral-100">
                  {p.name} <span className="text-2xl text-amber-300">{p.letter}</span>
                </p>
                <MetalBadge xp={owned.xp} />
              </div>
            </div>
            {nm ? (
              <div className="mt-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-800">
                  <div className={`h-full rounded-full ${m.key === 'bronze' ? 'bg-orange-400' : m.key === 'silver' ? 'bg-neutral-300' : m.key === 'gold' ? 'bg-amber-300' : 'bg-cyan-300'}`}
                    style={{ width: `${Math.min(100, Math.round(((owned.xp - m.need) / (nm.need - m.need)) * 100))}%` }} />
                </div>
                <p className="mt-1 text-xs text-neutral-500">{nm.need - owned.xp} to {nm.label}</p>
              </div>
            ) : (
              <p className="mt-2 text-xs font-bold text-fuchsia-300">Fully grown — a true Rainbow bruh!</p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => sayPhoneme(p)}
                aria-label={`Hear ${p.name}`}
                className="flex min-h-12 items-center justify-center gap-1 rounded-2xl border-2 border-neutral-700 text-neutral-200 hover:border-neutral-500"
              >
                <Volume2 className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => feed(p)}
                aria-label={`Feed ${p.name}`}
                disabled={!nm || treats < 1}
                className="flex min-h-12 items-center justify-center gap-1 rounded-2xl bg-amber-400 text-xs font-black text-neutral-950 hover:bg-amber-300 disabled:opacity-40"
              >
                <Cookie className="h-5 w-5" /> {treats}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --- Shop tab -------------------------------------------------------------- */
function ShopTab({ profile, updateProfile, setToast }) {
  const unlocked = shopUnlocked(profile);
  const buy = (p) => {
    if (!unlocked) { speak('Practise your sounds a bit more and a new friend will arrive!'); return; }
    if (profile.coins < p.price) { speak('Not enough coins yet! Play to earn more.'); return; }
    updateProfile((pr) => ({
      ...pr,
      coins: pr.coins - p.price,
      mons: { ...pr.mons, [p.id]: { xp: 0 } },
    }));
    speak(`Welcome ${p.name}!`, { pitch: 1.2 });
    window.setTimeout(() => sayPhoneme(p), 900);
    setToast(`${p.name} joined your band!`);
  };
  const locked = PHONEMES.filter((p) => !profile.mons[p.id] && setReached(profile, setOf(p.id)));

  return (
    <div>
      {locked.length === 0 ? (
        <div className="rounded-3xl border-2 border-neutral-800 bg-neutral-900 p-6 text-center">
          <p className="text-lg font-black text-neutral-100">
            {nextEgg(profile) ? 'An egg is wobbling!' : 'The whole crew is yours!'}
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            {nextEgg(profile)
              ? 'Go and meet it in Monsters — new friends hatch, they are not bought.'
              : 'More sound monsters are on their way…'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {locked.map((p) => {
            const afford = unlocked && profile.coins >= p.price;
            return (
              <div key={p.id} className="flex flex-col items-center rounded-3xl border-2 border-neutral-800 bg-neutral-900 p-4">
                <Character char={p.char} size={72} />
                <p className="mt-1 flex items-center gap-2 text-base font-black text-neutral-100">
                  {p.name} <span className="text-2xl text-amber-300">{p.letter}</span>
                </p>
                <button
                  type="button"
                  onClick={() => sayPhoneme(p)}
                  className="mt-1 flex items-center gap-1 text-xs font-bold text-neutral-400 hover:text-neutral-200"
                >
                  <Volume2 className="h-4 w-4" /> hear my sound
                </button>
                <button
                  type="button"
                  onClick={() => buy(p)}
                  disabled={!afford}
                  className={[
                    'mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-black',
                    afford ? 'bg-amber-400 text-neutral-950 hover:bg-amber-300' : 'border-2 border-neutral-800 text-neutral-600',
                  ].join(' ')}
                >
                  {unlocked ? <><Coins className="h-4 w-4" /> {p.price}</> : <><Lock className="h-4 w-4" /> Locked</>}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-4 text-center text-xs text-neutral-600" data-shop-unlocked={unlocked ? '1' : '0'}>
        {unlocked
          ? `Earn coins in Play — every right answer pays ${COIN_CORRECT} coins.`
          : `New friends arrive when you know three sounds really well (${fluentCount(profile)}/3).`}
      </p>
    </div>
  );
}

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
@keyframes sb-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}
.sb-shake { animation: sb-shake 260ms ease-in-out; }
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
        <Character char={slot.char} size={72} singing={singing} metal={slot.metal} />
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
  const [tab, setTab] = useState('play');
  const [save, setSave] = useState(loadSave);
  const [slots, setSlots] = useState(() =>
    DEFAULT_CHARS.map((c) => ({ charId: c.id, soundId: null, muted: false, solo: false })));
  const [selected, setSelected] = useState(null);
  const [sheet, setSheet] = useState(null);        // { kind: 'slot' | 'roster', index }
  const [masterMuted, setMasterMuted] = useState(false);
  const [discovered, setDiscovered] = useState([]);
  const [draft, setDraft] = useState(() => ({ ...randomChar(), name: 'New Bruh' }));
  const [dragging, setDragging] = useState(null);
  const [toast, setToast] = useState(null);
  const [showtime, setShowtime] = useState(null);   // loop ids performing right now
  const [clips, setClips] = useState(loadClips);
  const [recording, setRecording] = useState(false);
  const [familyOpen, setFamilyOpen] = useState(false);
  const [familyView, setFamilyView] = useState('card');   // card | voices | create
  setClipRegistry(clips);

  const profile = save.active ? save.profiles.find((pr) => pr.id === save.active) : null;
  useEffect(() => { persistSave(save); }, [save]);
  const updateProfile = useCallback((fn) => {
    setSave((sv) => ({ ...sv, profiles: sv.profiles.map((pr) => (pr.id === sv.active ? fn(pr) : pr)) }));
  }, []);

  /* the band roster: defaults + owned phoneme monsters + this kid's creations */
  const roster = useMemo(() => {
    const owned = profile ? PHONEMES.filter((ph) => profile.mons[ph.id]).map((ph) => ph.char) : [];
    return DEFAULT_CHARS.concat(owned, profile ? profile.createdChars : []);
  }, [profile]);

  /* discovered combos live on the profile; hydrate on switch, write back on find */
  useEffect(() => { setDiscovered(profile ? profile.discovered : []); }, [save.active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!profile || discovered.length === 0) return;
    if (discovered.some((id) => !profile.discovered.includes(id))) {
      updateProfile((pr) => ({ ...pr, discovered: Array.from(new Set(pr.discovered.concat(discovered))) }));
    }
  }, [discovered]); // eslint-disable-line react-hooks/exhaustive-deps

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
    sound: soundInfoFor(s.soundId),
    metal: metalFor(profile, s.charId),
  })), [slots, charById, roster, profile]);

  const activeIds = useMemo(() => slots.map((s) => s.soundId).filter(Boolean), [slots]);

  /* --- what the engine should be playing -------------------------------- */
  const desired = useMemo(() => {
    if (showtime) {
      const perf = new Map();
      showtime.forEach((id) => perf.set(id, 1));
      return perf;
    }
    const anySolo = slots.some((s) => s.soundId && s.solo);
    const map = new Map();
    slots.forEach((s) => {
      if (!s.soundId) return;
      const audible = !s.muted && (!anySolo || s.solo);
      map.set(s.soundId, audible ? 1 : 0);
    });
    return map;
  }, [slots, showtime]);

  /* the blend bridge: adjacent monsters spelling a decodable word */
  const blend = useMemo(() => {
    if (showtime) return null;
    const chars = slots.map((sl) => (sl.soundId && sl.soundId.startsWith('chant_') && !sl.muted ? sl.charId : null));
    return findBlend(chars);
  }, [slots, showtime]);

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
    if (blend) parts.push(`blend_${blend.word}:1`);
    return parts.sort().join('|');
  }, [desired, liveCombos, blend]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const full = new Map(desired);
    liveCombos.forEach((c) => full.set(c.bonus, 1));
    if (blend) full.set(`blend_${blend.word}`, 1);
    eng.sync(full);
    // desiredKey is the stable serialisation that drives this effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredKey, started]);

  useEffect(() => {
    if (!blend || !profile) return;
    if (!(profile.words || []).includes(blend.word)) {
      updateProfile((pr) => ({ ...pr, words: Array.from(new Set((pr.words || []).concat(blend.word))) }));
      setToast(`You made the word “${blend.word}”!`);
    }
  }, [blend]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (tab !== 'play' && showtime) setShowtime(null);
  }, [tab, showtime]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const sfx = useMemo(() => ({
    chime: () => { if (engineRef.current) engineRef.current.chime(); },
    levelup: () => { if (engineRef.current) engineRef.current.levelup(); },
  }), []);
  const onPerform = useCallback((loopIds) => setShowtime(loopIds.length ? loopIds : null), []);
  const onStopPerform = useCallback(() => setShowtime(null), []);

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

  /* Dropping a phoneme monster on a slot gives it its own voice: the chant is
     the default sound, so arranging the band is arranging phonemes. */
  const setSlotChar = useCallback((index, charId) => {
    setSlots((prev) => prev.map((sl, i) => {
      if (i !== index) return sl;
      const chant = PHONEME_BY_ID[charId] ? `chant_${charId}` : null;
      const wasChant = sl.soundId && sl.soundId.startsWith('chant_');
      return { ...sl, charId, soundId: chant || (wasChant ? null : sl.soundId) };
    }));
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
    updateProfile((pr) => ({ ...pr, createdChars: pr.createdChars.concat(c) }));
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
  }, [draft, updateProfile]);

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

  if (!profile) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <style>{CSS}</style>
        <ProfileGate save={save} setSave={setSave} />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-neutral-950 pb-24 text-neutral-100">
      <style>{CSS}</style>
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-amber-500 opacity-10 blur-3xl" />

      {/* header */}
      <header className="relative flex items-center gap-2 px-3 pt-3 sm:gap-3 sm:px-5">
        <Music className="hidden h-6 w-6 shrink-0 text-amber-400 sm:block" />
        <h1 className="text-base font-black tracking-tight sm:text-2xl">SONGBRUHS</h1>
        <span className="hidden text-xs font-semibold text-neutral-600 sm:inline">110 BPM · A MINOR</span>
        <div className="ml-auto flex items-center gap-2">
          <CoinPill coins={profile.coins} />
          <span
            aria-label={`${profile.treats || 0} treats`}
            data-treats={profile.treats || 0}
            className="hidden h-12 items-center gap-1 rounded-full border-2 border-neutral-700 bg-neutral-900 px-3 text-base font-black text-neutral-200 sm:flex"
          >
            <Cookie className="h-5 w-5" /> {profile.treats || 0}
          </span>
          <span className="hidden sm:block"><Pulse /></span>
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

      {/* the blend bridge: the word the band is spelling right now */}
      {blend && (
        <div className="relative mt-2 px-3 sm:px-5">
          <div
            key={blend.word}
            data-blend={blend.word}
            className="sb-drop flex items-center justify-center gap-3 rounded-3xl border-2 border-green-400 bg-neutral-900 px-4 py-3"
          >
            <span className="flex items-center gap-1">
              {blend.parts.map((id, i) => (
                <span key={i} className="rounded-xl border-2 border-green-400 px-2 py-0.5 text-xl font-black text-green-300">
                  {PHONEME_BY_ID[id].letter}
                </span>
              ))}
            </span>
            <span className="text-2xl font-black text-neutral-500">→</span>
            <span className="text-3xl font-black tracking-wide text-green-300">{blend.word}</span>
          </div>
        </div>
      )}

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
        {tab === 'play' && (
          <LearnTab
            key={profile.id}
            profile={profile}
            updateProfile={updateProfile}
            setToast={setToast}
            sfx={sfx}
            onPerform={onPerform}
            onStopPerform={onStopPerform}
            captions={Boolean(profile.captions)}
          />
        )}

        {tab === 'monsters' && (
          <MonstersTab profile={profile} updateProfile={updateProfile} setToast={setToast} onGoShop={() => setTab('shop')} sfx={sfx} />
        )}

        {tab === 'shop' && (
          <ShopTab profile={profile} updateProfile={updateProfile} setToast={setToast} />
        )}

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

        {tab === 'family' && !familyOpen && <HoldGate onOpen={() => setFamilyOpen(true)} />}

        {tab === 'family' && familyOpen && (
          <div data-family="1">
            <div className="mx-auto mb-4 flex max-w-lg gap-2">
              {[['card', 'Progress', Medal], ['voices', 'Voices', Mic], ['create', 'Create', Wand2]].map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setFamilyView(k); setRecording(false); }}
                  className={[
                    'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border-2 text-sm font-bold',
                    familyView === k ? 'border-amber-300 bg-neutral-900 text-amber-300' : 'border-neutral-800 text-neutral-400',
                  ].join(' ')}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>

            {familyView === 'card' && (
              <div className="mx-auto max-w-lg">
                <ParentCard profile={profile} />
                <div className="mt-6 border-t-2 border-neutral-800 pt-4">
                  <p className="mb-2 text-xs font-black tracking-widest text-neutral-500">SHOW THE LETTER</p>
                  <button
                    type="button"
                    data-captions={profile.captions ? '1' : '0'}
                    onClick={() => updateProfile((pr) => ({ ...pr, captions: !pr.captions }))}
                    className={[
                      'flex min-h-14 w-full items-center justify-between rounded-2xl border-2 px-4 text-sm font-bold',
                      profile.captions ? 'border-amber-300 text-amber-300' : 'border-neutral-800 text-neutral-300',
                    ].join(' ')}
                  >
                    <span className="text-left">
                      Show the target letter on screen
                      <span className="block text-xs font-normal text-neutral-500">
                        For deaf or hard-of-hearing players. This turns listening into letter-matching.
                      </span>
                    </span>
                    <span className={profile.captions ? 'text-amber-300' : 'text-neutral-600'}>{profile.captions ? 'ON' : 'OFF'}</span>
                  </button>
                </div>

                <div className="mt-6 border-t-2 border-neutral-800 pt-4">
                  <p className="mb-2 text-xs font-black tracking-widest text-neutral-500">PLAYERS</p>
                  <div className="flex flex-wrap gap-2">
                    {save.profiles.map((pr) => (
                      <button
                        key={pr.id}
                        type="button"
                        onClick={() => { setSave((sv) => ({ ...sv, active: pr.id })); setTab('play'); setFamilyOpen(false); }}
                        className={[
                          'flex min-h-12 items-center gap-2 rounded-2xl border-2 px-4 text-sm font-bold',
                          pr.id === profile.id ? 'border-amber-300 text-amber-300' : 'border-neutral-800 text-neutral-300',
                        ].join(' ')}
                      >
                        {pr.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSave((sv) => ({ ...sv, active: null }))}
                      className="flex min-h-12 items-center gap-2 rounded-2xl border-2 border-neutral-800 px-4 text-sm font-bold text-neutral-300"
                    >
                      + Add a player
                    </button>
                  </div>
                </div>
                <div className="mt-6 border-t-2 border-neutral-800 pt-4">
                  <p className="mb-2 text-xs font-black tracking-widest text-neutral-500">WORDS BUILT ON THE STAGE</p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" data-scrapbook={(profile.words || []).length}>
                    {WORDS.map((w) => {
                      const found = (profile.words || []).includes(w.word);
                      return (
                        <span
                          key={w.word}
                          className={[
                            'flex min-h-10 items-center justify-center rounded-xl border-2 text-base font-black',
                            found ? 'border-green-400 text-green-300' : 'border-neutral-800 text-neutral-700',
                          ].join(' ')}
                        >
                          {found ? w.word : '· · ·'}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-6 border-t-2 border-neutral-800 pt-4">
                  <p className="mb-2 text-xs font-black tracking-widest text-neutral-500">SOUND COMBOS FOUND</p>
                  <CombosPanel discovered={discovered} activeIds={activeIds} />
                </div>
              </div>
            )}

            {familyView === 'voices' && (
              <VoiceRecorder clips={clips} setClips={setClips} onClose={() => setFamilyView('card')} />
            )}

            {familyView === 'create' && (
              <Creator
                draft={draft}
                setDraft={setDraft}
                roster={roster}
                running={!masterMuted}
                onSave={() => saveChar(false)}
                onSavePlace={() => saveChar(true)}
              />
            )}
          </div>
        )}

      </main>

      {/* bottom tabs */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 flex gap-2 border-t-2 border-neutral-800 bg-neutral-950 px-3 py-2 sm:px-5">
        {[
          { k: 'play', label: 'Play', Icon: Ear },
          { k: 'monsters', label: 'Monsters', Icon: Heart },
          { k: 'shop', label: 'Shop', Icon: ShoppingBag },
          { k: 'stage', label: 'Stage', Icon: Music },
        ].map(({ k, label, Icon }) => (
          <button
            key={k}
            type="button"
            onClick={() => { setTab(k); speak(label); }}
            aria-label={label}
            className={[
              'flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-2 text-sm font-black',
              tab === k ? 'border-amber-400 bg-neutral-900 text-amber-300' : 'border-neutral-800 bg-neutral-900 text-neutral-500',
            ].join(' ')}
          >
            <Icon className="h-6 w-6 shrink-0" /> <span className="hidden lg:inline">{label}</span>
          </button>
        ))}
        {/* the family door: small, unlabelled, and gated behind a hold */}
        <button
          type="button"
          onClick={() => { setTab('family'); setFamilyOpen(false); }}
          aria-label="Grown-ups"
          className={[
            'flex min-h-14 w-14 items-center justify-center rounded-2xl border-2',
            tab === 'family' ? 'border-amber-400 bg-neutral-900 text-amber-300' : 'border-neutral-800 bg-neutral-900 text-neutral-600',
          ].join(' ')}
        >
          <Lock className="h-5 w-5" />
        </button>
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
                <div className="mt-4 grid grid-cols-2 gap-2">
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
                    onClick={() => setSlotChar(sheet.index, c.id)}
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
