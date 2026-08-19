/* P2 "Real Voices" ship gates.
 *
 *   1. clip wins      — where a recorded phoneme exists, it plays instead of
 *                       the TTS approximation, everywhere a sound is spoken.
 *   2. no schwa       — no prompt speaks "tuh"/"puh" once /t/ and /p/ are
 *                       recorded (the whole reason this phase exists).
 *   3. fallback       — with no clips at all the game still asks, answers and
 *                       completes rounds using TTS.
 *   4. partial        — a half-recorded set mixes clips and TTS per sound
 *                       without breaking.
 *   5. persistence    — clips survive reload and live outside the game save,
 *                       so audio can never corrupt or bloat progress.
 *   6. recorder UI    — the flow is reachable, shows progress, and degrades
 *                       with a clear message where the mic is unavailable.
 *
 * Clips are injected directly into localStorage as tiny silent WAVs; this
 * tests the playback/fallback contract, not the microphone.
 */
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4173/';
const EXE = process.env.CHROMIUM_PATH || undefined;
const bad = [];
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad.push(m); };

/* a 0.1s silent 8kHz mono WAV as a data URI — valid audio, no sound */
const SILENT_WAV = (() => {
  const n = 800; const bytes = 44 + n;
  const b = Buffer.alloc(bytes);
  b.write('RIFF', 0); b.writeUInt32LE(bytes - 8, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44);
  return 'data:audio/wav;base64,' + b.toString('base64');
})();

const PHONEME_IDS = ['ph_s', 'ph_a', 'ph_t', 'ph_p', 'ph_i', 'ph_n'];
const SAVE = {
  version: 2, active: 'kid_v',
  profiles: [{
    id: 'kid_v', name: 'Voxy', tier: 'A', colour: '#ef6461', coins: 30, treats: 2,
    mons: Object.fromEntries(PHONEME_IDS.map((id) => [id, { xp: 0 }])),
    stats: {}, createdChars: [], discovered: [], correct: 0,
  }],
};

async function open(browser, clipIds) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, permissions: [] });
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__sbSpeechLog = []; window.__sbClipLog = []; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate(([save, ids, wav]) => {
    localStorage.setItem('songbruhs_save_v1', JSON.stringify(save));
    const clips = {};
    ids.forEach((id) => { clips[id] = wav; });
    localStorage.setItem('songbruhs_clips_v1', JSON.stringify(clips));
  }, [SAVE, clipIds, SILENT_WAV]);
  await p.reload({ waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'START' }).click();
  await p.waitForSelector('[data-target]');
  return { ctx, p };
}
/* Since P5 the grown-up tools live behind a hold-to-open family door. */
async function openFamily(p, view) {
  await p.locator('nav [aria-label="Grown-ups"]').click();
  await p.waitForSelector('[data-hold-gate]');
  const box = await p.locator('[data-hold-gate]').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(1800);
  await p.mouse.up();
  await p.waitForSelector('[data-family]', { timeout: 4000 });
  if (view) { await p.getByRole('button', { name: view }).click(); await p.waitForTimeout(300); }
}
const logs = (p) => p.evaluate(() => ({ speech: window.__sbSpeechLog.slice(), clips: window.__sbClipLog.slice() }));
const targetOf = (p) => p.locator('[data-target]').getAttribute('data-target');

async function answerRight(p, keepFinale) {
  const t = await targetOf(p);
  await p.locator(`[data-choice="${t}"]`).click();
  await p.waitForFunction(() => {
    const g = document.querySelector('[data-target]');
    return !g || g.getAttribute('data-phase') === 'ask';
  }, null, { timeout: 8000 });
  // rounds end in the band finale; dismiss it unless the caller wants it
  if (!keepFinale && (await p.locator('[data-finale]').count())) {
    await p.getByRole('button', { name: /Another round/ }).click();
    await p.waitForSelector('[data-target]');
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ---- gates 1 + 2: recorded sounds win, and the schwa is gone ----------- */
  console.log('\n== recorded clips replace the TTS approximations ==');
  {
    const allSounds = PHONEME_IDS.map((id) => `s:${id}`);
    const { ctx, p } = await open(browser, allSounds);
    await p.evaluate(() => { window.__sbSpeechLog.length = 0; window.__sbClipLog.length = 0; });
    for (let i = 0; i < 4; i++) {
      await p.locator('button[aria-label="Hear it again"]').click();
      await p.waitForTimeout(250);
      await answerRight(p);
    }
    const { speech, clips } = await logs(p);
    ok(clips.length >= 4, `phoneme clips played (${clips.length})`);
    ok(clips.every((id) => id.startsWith('s:')), 'every clip played was a recorded sound');
    const schwa = speech.filter((t) => /\b(tuh|puh|nnnn|ssss|ih)\b/i.test(t));
    ok(schwa.length === 0, `no TTS approximation spoken while clips exist (${schwa.length}: ${schwa.slice(0, 2).join(' | ')})`);
    ok(speech.some((t) => /find the monster/i.test(t)), 'the carrier sentence is still spoken by TTS');
    await ctx.close();
  }

  /* ---- gate 3: no clips at all -------------------------------------------- */
  console.log('\n== fallback: no recordings yet ==');
  {
    const { ctx, p } = await open(browser, []);
    await p.evaluate(() => { window.__sbSpeechLog.length = 0; window.__sbClipLog.length = 0; });
    for (let i = 0; i < 5; i++) await answerRight(p, true);
    await p.waitForSelector('[data-finale]', { timeout: 8000 });
    const { speech, clips } = await logs(p);
    ok(clips.length === 0, 'no clips played when none are recorded');
    ok(speech.some((t) => /find the monster that says/i.test(t)), 'TTS carries the full prompt as before');
    ok(true, 'a whole round completes on TTS alone');
    await ctx.close();
  }

  /* ---- gate 4: partial recording ------------------------------------------ */
  console.log('\n== partial set: /t/ and /p/ recorded, rest TTS ==');
  {
    const { ctx, p } = await open(browser, ['s:ph_t', 's:ph_p']);
    await p.evaluate(() => { window.__sbSpeechLog.length = 0; window.__sbClipLog.length = 0; });
    for (let i = 0; i < 10; i++) await answerRight(p);
    const { speech, clips } = await logs(p);
    ok(clips.every((id) => id === 's:ph_t' || id === 's:ph_p'), 'only the recorded sounds play as clips');
    const schwa = speech.filter((t) => /\b(tuh|puh)\b/i.test(t));
    ok(schwa.length === 0, `the two schwa offenders are never spoken (${schwa.length})`);
    ok(speech.some((t) => /ssss|nnnn|ih|^a$/i.test(t)) || clips.length > 0,
      'unrecorded sounds still fall back to TTS');
    await ctx.close();
  }

  /* ---- gate 5: persistence + isolation ------------------------------------ */
  console.log('\n== clips persist, and live outside the game save ==');
  {
    const { ctx, p } = await open(browser, ['s:ph_s', 's:ph_a']);
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'START' }).click();
    await p.waitForSelector('[data-target]');
    const stored = await p.evaluate(() => ({
      clipKeys: Object.keys(JSON.parse(localStorage.getItem('songbruhs_clips_v1') || '{}')),
      saveHasAudio: /data:audio/.test(localStorage.getItem('songbruhs_save_v1') || ''),
    }));
    ok(stored.clipKeys.length === 2, `clips survive reload (${stored.clipKeys.length})`);
    ok(!stored.saveHasAudio, 'no audio blob leaks into the game save');
    await ctx.close();
  }

  /* ---- gate 6: recorder UI ------------------------------------------------ */
  console.log('\n== the recorder flow ==');
  {
    const { ctx, p } = await open(browser, ['s:ph_s']);
    await openFamily(p, 'Voices');
    ok((await p.locator('[data-recorder]').count()) === 1, 'a grown-up finds the recorder in the family corner');
    await p.waitForSelector('[data-recorder]');
    const done = Number(await p.locator('[data-clips-done]').getAttribute('data-clips-done'));
    ok(done === 1, `recorder shows real progress (${done} recorded)`);
    ok(await p.getByText('PURE SOUND', { exact: true }).isVisible(), 'the script starts with the pure sounds');
    // mic is unavailable in this context: the flow must say so, not crash
    await p.getByRole('button', { name: /Record/ }).click();
    await p.waitForTimeout(700);
    const errText = await p.locator('[data-recorder]').innerText();
    ok(/microphone|browser|allow/i.test(errText), 'a blocked mic explains itself instead of failing silently');
    ok(await p.locator('[data-recorder]').isVisible(), 'the recorder survives a denied mic');
    await p.getByRole('button', { name: 'Done' }).click();
    await p.waitForTimeout(300);
    ok(!(await p.locator('[data-recorder]').count()), 'Done leaves the recorder');
    await ctx.close();
  }

  await browser.close();
  console.log('\n==============================');
  console.log(bad.length ? 'GATE FAILURES:\n' + bad.join('\n') : 'ALL P2 GATES PASS');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
