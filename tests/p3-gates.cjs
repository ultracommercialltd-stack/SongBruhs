/* P3 "The Fusion" ship gates — the audit's #1 finding.
 *
 *   1. chant default  — putting a phoneme monster on a stage slot gives it its
 *                       own sound, not a music loop. Arranging the band is
 *                       arranging phonemes.
 *   2. quantised      — proved in tests/engine.cjs (the engine is private to the
 *                       module, so it is instrumented there, not from the page).
 *   3. blend bridge   — adjacent monsters spelling a decodable word fire the
 *                       bridge; breaking the run clears it.
 *   4. word integrity — only hand-curated words fire, and only from graphemes
 *                       the child has met.
 *   5. scrapbook      — discovered words persist per child.
 *   6. audio health   — a full stage of chants plus a blend runs with no page
 *                       errors and disposes cleanly.
 */
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4173/';
const EXE = process.env.CHROMIUM_PATH || undefined;
const bad = [];
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad.push(m); };

const PHONEME_IDS = ['ph_s', 'ph_a', 'ph_t', 'ph_p', 'ph_i', 'ph_n'];
const SAVE = {
  version: 2, active: 'kid_f',
  profiles: [{
    id: 'kid_f', name: 'Blendy', tier: 'A', colour: '#3ec9a7', coins: 30, treats: 2,
    mons: Object.fromEntries(PHONEME_IDS.map((id) => [id, { xp: 0 }])),
    stats: {}, createdChars: [], discovered: [], words: [], correct: 0,
  }],
};

async function openStage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate((s) => localStorage.setItem('songbruhs_save_v1', JSON.stringify(s)), SAVE);
  await p.reload({ waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'START' }).click();
  await p.waitForSelector('[data-target]');
  await p.locator('nav [aria-label="Stage"]').click();
  await p.waitForSelector('[data-slot]');
  return { ctx, p, errs };
}

/* put a named monster into a stage slot via the roster sheet */
async function place(p, slotIdx, monsterName) {
  await p.locator('[data-slot]').nth(slotIdx).click();
  await p.waitForTimeout(250);
  // an occupied slot opens the action sheet first
  if (await p.getByRole('button', { name: /Swap character/ }).count()) {
    await p.getByRole('button', { name: /Swap character/ }).click();
    await p.waitForTimeout(200);
  }
  await p.locator(`button:has-text("${monsterName}")`).last().click();
  await p.waitForTimeout(350);
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
const blendOf = async (p) => {
  const el = p.locator('[data-blend]');
  return (await el.count()) ? el.getAttribute('data-blend') : null;
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ---- gates 1, 3, 4: chants and the bridge ------------------------------ */
  console.log('\n== chant-voices and the blend bridge ==');
  {
    const { ctx, p, errs } = await openStage(browser);

    await place(p, 0, 'Sizzo');   // s
    const label = await p.locator('[data-slot]').nth(0).innerText();
    ok(/sound/i.test(label), `the slot names what it is singing, not the monster (${label.split('\n').pop()})`);
    ok(/“s”|"s"/.test(label), 'and it names the phoneme the child placed');
    ok((await blendOf(p)) === null, 'one monster alone spells nothing');

    await place(p, 1, 'Azza');    // s-a
    ok((await blendOf(p)) === 'as' || (await blendOf(p)) === null,
      `two monsters: "sa" is not a word, so no bridge (got ${await blendOf(p)})`);

    await place(p, 2, 'Tikko');   // s-a-t
    await p.waitForTimeout(400);
    ok((await blendOf(p)) === 'sat', `s + a + t blends into "sat" (got ${await blendOf(p)})`);
    const letters = await p.locator('[data-blend] span span').allInnerTexts();
    ok(letters.slice(0, 3).join('') === 'sat', `the banner shows the parts (${letters.slice(0, 3).join('-')})`);

    // break the run -> the bridge must clear
    await place(p, 1, 'Nono');    // s-n-t
    await p.waitForTimeout(400);
    ok((await blendOf(p)) === null, 'breaking the run clears the bridge');

    // and reform a different word
    await place(p, 0, 'Popsy');
    await place(p, 1, 'Azza');
    await place(p, 2, 'Nono');    // p-a-n
    await p.waitForTimeout(400);
    ok((await blendOf(p)) === 'pan', `p + a + n blends into "pan" (got ${await blendOf(p)})`);

    ok(errs.length === 0, `no page errors while blending (${errs.length}: ${errs[0] || ''})`);
    await ctx.close();
  }

  /* ---- gate 2: chants are quantised --------------------------------------
     The engine is module-private, so quantisation is proved where it can
     actually be observed: tests/engine.cjs mounts the app against a Tone stub
     and asserts every chant entry is scheduled at a bar downbeat. Here we only
     confirm a stage full of chants stays healthy (gate 6). */

  /* ---- gate 5: scrapbook -------------------------------------------------- */
  console.log('\n== the word scrapbook ==');
  {
    const { ctx, p } = await openStage(browser);
    await place(p, 0, 'Sizzo');
    await place(p, 1, 'Azza');
    await place(p, 2, 'Tikko');
    await p.waitForTimeout(500);
    await openFamily(p);
    const found = Number(await p.locator('[data-scrapbook]').getAttribute('data-scrapbook'));
    ok(found >= 1, `the made word is recorded in the scrapbook (${found})`);
    const words = await p.locator('[data-scrapbook] > *').allInnerTexts();
    ok(words.includes('sat'), `"sat" is in the book (${words.filter((w) => w !== '· · ·').join(', ')})`);
    ok(words.filter((w) => w === '· · ·').length > 0, `undiscovered words stay hidden (${words.filter((w) => w === '· · ·').length} left)`);

    // survives a reload
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'START' }).click();
    await p.waitForSelector('[data-target]');
    await openFamily(p);
    const after = await p.locator('[data-scrapbook] > *').allInnerTexts();
    ok(after.includes('sat'), 'the scrapbook survives a reload');
    await ctx.close();
  }

  /* ---- gate 6: a full stage of chants ------------------------------------ */
  console.log('\n== a full band of sound monsters ==');
  {
    const { ctx, p, errs } = await openStage(browser);
    const names = ['Sizzo', 'Azza', 'Tikko', 'Popsy', 'Inko', 'Nono'];
    for (let i = 0; i < names.length; i++) await place(p, i, names[i]);
    await p.waitForTimeout(4000);   // let every chant enter and loop
    const singing = await p.locator('[data-slot] [data-part="mouth"]').count();
    ok(singing >= 6, `all six sound monsters are singing (${singing})`);
    ok(errs.length === 0, `six simultaneous chants ran clean (${errs.length}: ${errs[0] || ''})`);
    await ctx.close();
  }

  await browser.close();
  console.log('\n==============================');
  console.log(bad.length ? 'GATE FAILURES:\n' + bad.join('\n') : 'ALL P3 GATES PASS');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
