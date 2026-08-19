/* Minimal Tone.js stub: records the calls the engine makes so we can assert on
   quantisation, disposal and ordering without a real AudioContext. */
const log = { created: [], disposed: [], starts: [], stops: [], scheduled: [] };

let clock = 0;
function param(name, owner) {
  return {
    _name: name,
    value: 0,
    owner,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    cancelScheduledValues() { return this; },
    rampTo() { return this; },
  };
}

class Node {
  constructor(kind, opts) {
    this.kind = kind;
    this.opts = opts;
    this.disposed = false;
    this.gain = param('gain', this);
    this.frequency = param('frequency', this);
    this.detune = param('detune', this);
    this.volume = param('volume', this);
    this.wet = param('wet', this);
    this.bpm = param('bpm', this);
    log.created.push(this);
  }
  connect() { return this; }
  disconnect() { return this; }
  toDestination() { return this; }
  start(t) { if (this.disposed) throw new Error(`start on disposed ${this.kind}`); log.starts.push([this.kind, t]); return this; }
  stop(t) { if (this.disposed) throw new Error(`stop on disposed ${this.kind}`); log.stops.push([this.kind, t]); return this; }
  cancel() { return this; }
  triggerAttackRelease() { return this; }
  triggerAttack() { return this; }
  triggerRelease() { return this; }
  dispose() {
    if (this.disposed) throw new Error(`double dispose of ${this.kind}`);
    this.disposed = true;
    log.disposed.push(this);
    return this;
  }
}

const mk = (kind) => class extends Node { constructor(o) { super(kind, o); } };

const DEST = new Node('Destination');
log.created.pop();

const transport = {
  kind: 'Transport',
  state: 'stopped',
  position: '0:0:0',
  bpm: param('bpm'),
  timeSignature: 4,
  swing: 0,
  start(t) { this.state = 'started'; log.starts.push(['Transport', t]); return this; },
  stop() { this.state = 'stopped'; return this; },
  cancel() { return this; },
  scheduleOnce(cb, time) { log.scheduled.push(time); cb(clock += 0.001); return 1; },
};

module.exports = {
  __log: log,
  __transport: transport,
  __setPosition(p) { transport.position = p; },
  start: () => Promise.resolve(),
  now: () => clock,
  getTransport: () => transport,
  getDestination: () => DEST,
  Gain: mk('Gain'),
  Limiter: mk('Limiter'),
  Compressor: mk('Compressor'),
  Filter: mk('Filter'),
  Noise: mk('Noise'),
  Reverb: mk('Reverb'),
  Chorus: mk('Chorus'),
  AutoFilter: mk('AutoFilter'),
  PingPongDelay: mk('PingPongDelay'),
  MembraneSynth: mk('MembraneSynth'),
  NoiseSynth: mk('NoiseSynth'),
  MetalSynth: mk('MetalSynth'),
  MonoSynth: mk('MonoSynth'),
  FMSynth: mk('FMSynth'),
  AMSynth: mk('AMSynth'),
  Synth: mk('Synth'),
  PolySynth: class extends Node { constructor(voice, o) { super('PolySynth', o); this.voice = voice; this.maxPolyphony = 32; } },
  Part: class extends Node {
    constructor(cb, events) {
      super('Part');
      this.cb = cb;
      this.events = events || [];
      this.loop = false;
      this.loopStart = 0;
      this.loopEnd = 0;
    }
    /** run every scheduled event once, as the real transport would */
    fire() { this.events.forEach((e, i) => this.cb(i * 0.1, e)); }
  },
  Sequence: class extends Node {
    constructor(cb, events, sub) {
      super('Sequence');
      this.cb = cb;
      this.events = events || [];
      this.subdivision = sub;
      this.loop = false;
    }
    fire() { this.events.forEach((e, i) => this.cb(i * 0.1, e)); }
  },
};
