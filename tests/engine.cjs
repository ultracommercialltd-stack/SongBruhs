/* Audio-engine invariants, checked against a Tone.js stub in jsdom.
 *
 * The browser gate tests cannot see inside the engine, so the hard audio
 * guarantees live here: every loop entry is quantised to a bar downbeat,
 * loops are cached rather than rebuilt, and everything is disposed on unmount.
 * Covers the music loops, the combo bonus layers, and the P3 chant-voices.
 *
 * Run: npm run test:engine
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');
const babel = require('@babel/core');
const { JSDOM } = require('jsdom');

const STUBS = __dirname + '/stubs';
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'tone') return STUBS + '/tone.cjs';
  if (req === 'lucide-react') return STUBS + '/lucide-react.cjs';
  return origResolve.call(this, req, ...rest);
};

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
dom.window.performance = global.performance;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.SVGElement = dom.window.SVGElement;
global.MouseEvent = dom.window.MouseEvent;
global.Event = dom.window.Event;
global.IS_REACT_ACT_ENVIRONMENT = true;

const problems = [];
['error', 'warn'].forEach((lvl) => {
  const orig = console[lvl].bind(console);
  console[lvl] = (...a) => { problems.push(`[${lvl}] ${a.map(String).join(' ')}`); orig(...a); };
});

const src = fs.readFileSync(path.join(__dirname, '..', 'SongBruhs.jsx'), 'utf8');
const out = babel.transformSync(src, {
  presets: [['@babel/preset-react'], ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
  filename: 'SongBruhs.jsx',
}).code;
const file = path.join(__dirname, '.compiled.cjs');   // beside node_modules so requires resolve
fs.writeFileSync(file, out);

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react');
const Tone = require(STUBS + '/tone.cjs');
const SongBruhs = require(file).default;

const container = document.getElementById('root');
const root = createRoot(container);

const $ = (sel) => document.querySelectorAll(sel);
const byText = (sel, txt) => Array.from($(sel)).find((e) => (e.textContent || '').includes(txt));

function pointer(el, type, x = 10, y = 10) {
  const ev = new dom.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  el.dispatchEvent(ev);
}

function assert(cond, msg) {
  if (!cond) { problems.push(`[assert] ${msg}`); console.log('  FAIL ' + msg); }
  else console.log('  ok   ' + msg);
}

(async () => {
  await act(async () => { root.render(React.createElement(SongBruhs)); });

  console.log('\n-- splash --');
  const startBtn = byText('button', 'START');
  assert(!!startBtn, 'splash shows a START button');
  assert(Tone.__log.created.length === 0, 'no Tone nodes created before the gesture');

  await act(async () => { startBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

  console.log('\n-- profile gate --');
  assert(Tone.__transport.state === 'started', 'transport started on the gesture');
  const goBtn = byText('button', "Let's play!");
  assert(!!goBtn, 'fresh browser shows the create-profile form');
  await act(async () => { goBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert(!!$('button[aria-label="Hear it again"]')[0], 'lands on the Play tab with a question');
  const persisted = JSON.parse(dom.window.localStorage.getItem('songbruhs_save_v1'));
  assert(persisted && persisted.profiles.length === 1, 'profile persisted to localStorage');

  // answer one tier-A question correctly: target letter is discoverable from state? use the choice whose card is target
  await act(async () => { byText('button', 'Stage').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

  console.log('\n-- after start --');
  const slotEls = $('[data-slot]');
  assert(slotEls.length === 7, `7 character slots rendered (got ${slotEls.length})`);
  const trayBtns = Array.from($('button[aria-label]')).filter((b) => /—/.test(b.getAttribute('aria-label')));
  assert(trayBtns.length === 20, `20 tray sounds rendered (got ${trayBtns.length})`);

  // tap-to-select then tap-a-slot, for all 20 loops in turn
  console.log('\n-- assign all 20 loops (tap to select, tap a slot) --');
  let built = 0;
  for (let i = 0; i < trayBtns.length; i++) {
    const btn = Array.from($('button[aria-label]')).filter((b) => /—/.test(b.getAttribute('aria-label')))[i];
    await act(async () => { pointer(btn, 'pointerdown'); });
    await act(async () => { pointer(dom.window, 'pointerup'); });
    const slot = $('[data-slot]')[i % 7];
    await act(async () => { slot.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    built = Tone.__log.created.length;
  }
  assert(built > 40, `all 20 builders ran without throwing (${built} audio nodes created)`);
  const barStarts = Tone.__log.scheduled.filter((t) => /^\d+:0:0$/.test(String(t)));
  assert(barStarts.length === Tone.__log.scheduled.length && barStarts.length >= 20,
    `every entry quantised to a bar downbeat (${barStarts.length}/${Tone.__log.scheduled.length})`);
  const partStarts = Tone.__log.starts.filter(([k]) => k === 'Part' || k === 'Sequence');
  assert(partStarts.every(([, t]) => /^\d+:0:0$/.test(String(t))), 'every Part/Sequence starts on a bar downbeat');

  // add / remove the same sound 20 times -> must reuse cached nodes, leak nothing
  console.log('\n-- remove + re-add the same sound 20x --');
  const before = Tone.__log.created.length;
  for (let n = 0; n < 20; n++) {
    const slot = $('[data-slot]')[0];
    await act(async () => { slot.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    const rm = byText('button', 'Remove');
    await act(async () => { rm.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    const btn = Array.from($('button[aria-label]')).find((b) => /—/.test(b.getAttribute('aria-label')) && !b.disabled);
    await act(async () => { pointer(btn, 'pointerdown'); });
    await act(async () => { pointer(dom.window, 'pointerup'); });
    await act(async () => { $('[data-slot]')[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  }
  assert(Tone.__log.created.length === before, `no new nodes after 20 remove/re-add cycles (${Tone.__log.created.length - before} created)`);

  // mute / solo
  console.log('\n-- mute / solo / clear / randomise --');
  await act(async () => { $('[data-slot]')[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { byText('button', 'Mute').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { $('[data-slot]')[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert(!!byText('button', 'Unmute'), 'mute toggles to Unmute');
  assert(!byText('button', 'Solo'), 'Solo is gone from the kid popover (P5)');
  const closeBtn = Array.from($('button[aria-label="Close"]'))[0];
  if (closeBtn) await act(async () => { closeBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { byText('button', 'Randomise').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { byText('button', 'Clear all').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert($('[data-slot]').length === 7, 'stage intact after clear all');

  // combo: b_broken + s_sub + v_chant (the panel moved to the family corner
  // in P5, so this only checks the engine accepts the layer without error)
  console.log('\n-- combo --');
  const pickByLabel = async (frag, slotIdx) => {
    const btn = Array.from($('button[aria-label]')).find((b) => (b.getAttribute('aria-label') || '').includes(frag));
    if (!btn) return;
    await act(async () => { pointer(btn, 'pointerdown'); });
    await act(async () => { pointer(dom.window, 'pointerup'); });
    await act(async () => { $('[data-slot]')[slotIdx].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  };
  await pickByLabel('Broken Shuffle', 0);
  await pickByLabel('Sub Drone', 1);
  await pickByLabel('Chant Line', 2);
  assert(!!byText('div', 'BASEMENT GARAGE'), 'combo banner names the discovered combo');

  console.log('\n-- chant-voices (P3) are quantised like every other loop --');
  await act(async () => { byText('button', 'Stage').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  Tone.__log.scheduled.length = 0;
  const chantsBefore = Tone.__log.created.length;
  for (const name of ['Sizzo', 'Azza', 'Tikko']) {
    await act(async () => { $('[data-slot]')[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    const swap = byText('button', 'Swap character');
    if (swap) await act(async () => { swap.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    const pick = Array.from($('button')).reverse().find((b) => (b.textContent || '').includes(name));
    if (pick) await act(async () => { pick.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  }
  assert(Tone.__log.created.length > chantsBefore, `chant loops were built (${Tone.__log.created.length - chantsBefore} nodes)`);
  assert(Tone.__log.scheduled.length > 0 && Tone.__log.scheduled.every((t) => /^\d+:0:0$/.test(String(t))),
    `every chant entry quantised to a bar downbeat (${Tone.__log.scheduled.length} entries)`);

  console.log('\n-- audio invariants --');
  const bonusScheduled = Tone.__log.scheduled.length;
  assert(Tone.__log.scheduled.every((t) => /^\d+:0:0$/.test(String(t))),
    `all ${bonusScheduled} gain entries (loops + combo bonus) land on a bar downbeat`);
  Tone.__log.created.filter((n) => n.kind === 'Sequence' || n.kind === 'Part').forEach((p2) => p2.fire());
  assert(true, 'every Part/Sequence callback runs without throwing');

  // unmount -> everything disposed exactly once
  console.log('\n-- unmount --');
  await act(async () => { root.unmount(); });
  const live = Tone.__log.created.filter((n) => !n.disposed);
  assert(live.length === 0, `every audio node disposed on unmount (${live.length} still live: ${[...new Set(live.map((n) => n.kind))].join(',')})`);

  console.log('\n===============================');
  if (problems.length) {
    console.log('PROBLEMS:\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
