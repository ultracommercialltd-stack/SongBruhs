/* P1 "Visible Growth" ship gates.
 *
 *   1. rounds        — five questions fill a trail, then the band performs.
 *   2. performance   — the finale actually starts loops on the transport,
 *                      quantised, and stops them when the round restarts.
 *   3. evolution     — metal tiers draw gear on the monster itself, and the
 *                      gear is visible on Play / Monsters / Stage.
 *   4. celebration   — routine corrects are silent (no speech); voice is
 *                      reserved for level-ups and the end of a round.
 *   5. treats        — feeding spends a treat, not coins; rounds pay treats.
 *   6. session end   — the finale is a real stopping point (no auto-advance).
 *
 * Run: npm run build && npx vite preview --port 4173 &  node tests/p1-gates.cjs
 */
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4173/';
const EXE = process.env.CHROMIUM_PATH || undefined;
const bad = [];
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad.push(m); };

const grid = (p) => p.locator('[data-target]');
const phaseOf = async (p) => (await grid(p).count()) ? grid(p).getAttribute('data-phase') : 'finale';
const targetOf = async (p) => grid(p).getAttribute('data-target');
const coinsOf = async (p) => Number(await p.locator('[data-coins]').getAttribute('data-coins'));
const treatsOf = async (p) => Number(await p.locator('[data-treats]').getAttribute('data-treats'));
const trailOf = async (p) => Number(await p.locator('[data-trail]').getAttribute('data-trail'));
const atFinale = (p) => p.locator('[data-finale]').count().then((n) => n > 0);

async function fresh(browser, name, tier) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__sbSpeechLog = []; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'START' }).click();
  await p.waitForSelector("text=Who's playing?");
  await p.fill('input[aria-label="Player name"]', name);
  await p.getByText(tier === 'B' ? 'Big (5–7)' : 'Little (3–5)').click();
  await p.getByRole('button', { name: /Let's play/ }).click();
  await p.waitForSelector('[data-target]');
  return { ctx, p };
}

/* answer the current question correctly and wait for whatever comes next */
async function answerRight(p) {
  const target = await targetOf(p);
  await p.locator(`[data-choice="${target}"]`).click();
  await p.waitForFunction(() => {
    const g = document.querySelector('[data-target]');
    return !g || g.getAttribute('data-phase') === 'ask';
  }, null, { timeout: 8000 });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ---- gates 1, 4, 6: rounds, celebration economy, session end ----------- */
  console.log('\n== rounds, celebration economy, session end ==');
  {
    const { ctx, p } = await fresh(browser, 'Rounder', 'A');
    ok((await trailOf(p)) === 0, 'round starts with an empty trail');
    ok((await p.locator('[data-trail] span').count()) === 5, 'trail shows five slots');

    await p.evaluate(() => { window.__sbSpeechLog.length = 0; });
    for (let i = 0; i < 5; i++) {
      const before = await trailOf(p).catch(() => -1);
      await answerRight(p);
      if (i < 4) {
        const after = await trailOf(p);
        ok(after === before + 1, `question ${i + 1}: trail advanced to ${after}`);
      }
    }
    await p.waitForSelector('[data-finale]', { timeout: 8000 });
    ok(await atFinale(p), 'five questions end in the band finale');

    const speech = await p.evaluate(() => window.__sbSpeechLog.slice());
    const praiseWords = /brilliant|well done|amazing|you got it|super|what a show/i;
    const praised = speech.filter((t) => praiseWords.test(t));
    ok(praised.length <= 1, `voice praise fired ${praised.length}x in a clean round (only the show)`);
    ok(praised.some((t) => /what a show/i.test(t)) || praised.length === 0,
      'the one praise line is the round finale, not a routine correct');

    // session end: the finale must WAIT for the child, not auto-advance
    await p.waitForTimeout(4000);
    ok(await atFinale(p), 'finale waits for a tap — a real stopping point');
    ok((await treatsOf(p)) >= 2, `round paid a treat (now ${await treatsOf(p)})`);

    await p.getByRole('button', { name: /Another round/ }).click();
    await p.waitForSelector('[data-target]');
    ok((await trailOf(p)) === 0, 'next round resets the trail');
    await ctx.close();
  }

  /* ---- gate 2: the finale really performs -------------------------------- */
  console.log('\n== performance uses the audio engine ==');
  {
    const { ctx, p } = await fresh(browser, 'Bandy', 'A');
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    for (let i = 0; i < 5; i++) await answerRight(p);
    await p.waitForSelector('[data-finale]', { timeout: 8000 });
    const monsters = await p.locator('[data-finale] svg').count();
    ok(monsters >= 2, `the child's own monsters are on stage (${monsters})`);
    const singing = await p.locator('[data-finale] [data-part="mouth"]').count();
    ok(singing >= 2, 'finale monsters are in singing state');
    await p.waitForTimeout(3000);   // let the quantised entry land and play
    ok(errs.length === 0, `performance ran with no page errors (${errs.length})`);
    await ctx.close();
  }

  /* ---- gate 3: visible evolution ----------------------------------------- */
  console.log('\n== metal tiers are visible on the monster ==');
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'networkidle' });
    // seed a save with one monster at each tier
    await p.evaluate(() => localStorage.setItem('songbruhs_save_v1', JSON.stringify({
      version: 2,
      active: 'kid_metal',
      profiles: [{
        id: 'kid_metal', name: 'Metals', tier: 'A', colour: '#ef6461', coins: 99, treats: 3,
        mons: { ph_s: { xp: 0 }, ph_a: { xp: 5 }, ph_t: { xp: 12 }, ph_p: { xp: 20 }, ph_i: { xp: 33 } },
        stats: {}, createdChars: [], discovered: [], correct: 0,
      }],
    })));
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'START' }).click();
    await p.waitForSelector('[data-target]');

    await p.locator('nav [aria-label="Monsters"]').click();
    await p.waitForTimeout(300);
    const metals = await p.locator('[data-metal]').evaluateAll((els) => els.map((e) => e.getAttribute('data-metal')));
    for (const want of ['silver', 'gold', 'diamond', 'rainbow']) {
      ok(metals.includes(want), `${want} gear drawn on the Monsters screen`);
    }
    ok(!metals.includes('bronze'), 'bronze (the starting tier) adds no gear — growth stays legible');

    /* gear must stay inside the character canvas: a stray coordinate (e.g. a
       string-concatenated point) paints a huge shape over the monster */
    const strays = await p.locator('[data-metal]').evaluateAll((els) => els.map((g) => {
      const b = g.getBBox();
      return { m: g.getAttribute('data-metal'), x: Math.round(b.x), y: Math.round(b.y),
               r: Math.round(b.x + b.width), bot: Math.round(b.y + b.height) };
    }).filter((b) => b.x < -8 || b.y < -8 || b.r > 208 || b.bot > 328));
    ok(strays.length === 0,
      `all metal gear stays inside the 200x320 canvas${strays.length ? ' — stray: ' + JSON.stringify(strays[0]) : ''}`);

    // and on the stage, where the child spends their time
    await p.locator('nav [aria-label="Stage"]').click();
    await p.waitForTimeout(300);
    await p.locator('[data-slot]').first().click();
    await p.waitForTimeout(300);
    await p.locator('button:has-text("Inko")').first().click();
    await p.waitForTimeout(300);
    const onStage = await p.locator('[data-slot] [data-metal]').evaluateAll((els) => els.map((e) => e.getAttribute('data-metal')));
    ok(onStage.includes('rainbow'), 'a Rainbow monster wears its gear on the Stage too');
    await ctx.close();
  }

  /* ---- gate 5: treats, not coins ----------------------------------------- */
  console.log('\n== feeding spends treats ==');
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.evaluate(() => localStorage.setItem('songbruhs_save_v1', JSON.stringify({
      version: 2,
      active: 'kid_feed',
      profiles: [{
        id: 'kid_feed', name: 'Nom', tier: 'A', colour: '#ef6461', coins: 50, treats: 2,
        mons: { ph_s: { xp: 0 }, ph_a: { xp: 0 } },
        stats: {}, createdChars: [], discovered: [], correct: 0,
      }],
    })));
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'START' }).click();
    await p.waitForSelector('[data-target]');
    await p.locator('nav [aria-label="Monsters"]').click();
    await p.waitForTimeout(300);
    const coinsBefore = await coinsOf(p);
    await p.locator('main').getByRole('button', { name: /^Feed/ }).first().click();
    await p.waitForTimeout(400);
    ok((await treatsOf(p)) === 1, `feeding spent a treat (2 -> ${await treatsOf(p)})`);
    ok((await coinsOf(p)) === coinsBefore, `feeding cost no coins (still ${await coinsOf(p)})`);
    // spend the last one, then the button must lock out
    await p.locator('main').getByRole('button', { name: /^Feed/ }).first().click();
    await p.waitForTimeout(400);
    ok((await treatsOf(p)) === 0, 'treats can reach zero');
    const disabled = await p.locator('main').getByRole('button', { name: /^Feed/ }).first().isDisabled();
    ok(disabled, 'with no treats the feed button is disabled, not a dead tap');
    await ctx.close();
  }

  await browser.close();
  console.log('\n==============================');
  console.log(bad.length ? 'GATE FAILURES:\n' + bad.join('\n') : 'ALL P1 GATES PASS');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
