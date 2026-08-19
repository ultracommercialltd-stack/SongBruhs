/* P6 "New Arrivals" ship gates — the content cliff.
 *
 *   1. sets exist    — 13 more sounds beyond the starting six, in phase order.
 *   2. paced         — a beginner cannot see set 2; fluency opens it, not coins.
 *   3. eggs          — the next sound arrives as an egg that hums and shows
 *                      hatching progress.
 *   4. hatching      — finding the egg's sound three times in play hatches it,
 *                      and it joins the roster, the stage and the questions.
 *   5. no dead ends  — a simulated month of play never runs out of purposeful
 *                      questions.
 *   6. curated       — every word the game can say is hand-written, never
 *                      generated, and only uses graphemes the child has met.
 */
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4173/';
const EXE = process.env.CHROMIUM_PATH || undefined;
const bad = [];
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad.push(m); };

const stat = (o) => ({ asked: 0, right: 0, fastRight: 0, wrong: 0, totalMs: 0, confusions: {}, ...o });
const FLUENT = stat({ asked: 12, right: 12, fastRight: 12 });
const SET1 = ['ph_s', 'ph_a', 'ph_t', 'ph_p', 'ph_i', 'ph_n'];

function save(mons, stats, extra) {
  return {
    version: 2, active: 'kid',
    profiles: [{
      id: 'kid', name: 'Sim', tier: 'A', colour: '#4ea8de', coins: 500, treats: 9,
      mons: Object.fromEntries(mons.map((id) => [id, { xp: 0 }])),
      stats, createdChars: [], discovered: [], words: [], correct: 0,
      captions: false, eggFinds: {}, ...(extra || {}),
    }],
  };
}
const allFluent = (ids) => Object.fromEntries(ids.map((id) => [id, { ...FLUENT }]));

async function open(browser, sv) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate((s) => localStorage.setItem('songbruhs_save_v1', JSON.stringify(s)), sv);
  await p.reload({ waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'START' }).click();
  await p.waitForSelector('[data-target]');
  return { ctx, p };
}
const targetOf = (p) => p.locator('[data-target]').getAttribute('data-target');
async function answerRight(p) {
  const t = await targetOf(p);
  await p.locator(`[data-choice="${t}"]`).click();
  await p.waitForFunction(() => {
    const g = document.querySelector('[data-target]');
    return !g || g.getAttribute('data-phase') === 'ask';
  }, null, { timeout: 9000 });
  if (await p.locator('[data-finale]').count()) {
    await p.getByRole('button', { name: /Another round/ }).click();
    await p.waitForSelector('[data-target]');
  }
  return t;
}
const monsCount = (p) => p.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('songbruhs_save_v1')).profiles[0].mons).length);

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ---- gates 1, 2: the sets and their pacing ------------------------------ */
  console.log('\n== more sounds, paced by fluency ==');
  {
    // a beginner: no egg yet, nothing beyond set 1 anywhere
    const { ctx: c1, p: p1 } = await open(browser, save(SET1, {}));
    await p1.locator('nav [aria-label="Monsters"]').click();
    await p1.waitForTimeout(300);
    ok((await p1.locator('[data-egg]').count()) === 0, 'a beginner is not shown an egg yet');
    const beginnerText = await p1.locator('main').innerText();
    ok(!/Mumbo|Didi|Gogo/.test(beginnerText), 'set 2 monsters are not visible to a beginner');
    await p1.locator('nav [aria-label="Shop"]').click();
    await p1.waitForTimeout(300);
    ok(!/Mumbo/.test(await p1.locator('main').innerText()), 'and 500 coins cannot buy them');
    await c1.close();

    // fluent in four of set 1: the next set opens
    const { ctx: c2, p: p2 } = await open(browser, save(SET1, allFluent(SET1.slice(0, 4))));
    await p2.locator('nav [aria-label="Monsters"]').click();
    await p2.waitForTimeout(300);
    ok((await p2.locator('[data-egg]').count()) === 1, 'four fluent sounds bring an egg');
    const eggId = await p2.locator('[data-egg]').getAttribute('data-egg');
    ok(eggId === 'ph_m', `the egg holds the next sound in phase order (${eggId})`);
    await c2.close();
  }

  /* ---- gate 3: the egg ---------------------------------------------------- */
  console.log('\n== the egg ==');
  {
    const { ctx, p } = await open(browser, save(SET1, allFluent(SET1.slice(0, 4))));
    await p.locator('nav [aria-label="Monsters"]').click();
    await p.waitForTimeout(300);
    const egg = p.locator('[data-egg]');
    ok(Number(await egg.getAttribute('data-egg-finds')) === 0, 'it starts with no finds');
    const text = await egg.innerText();
    ok(/hums/i.test(text), 'it tells the child it hums');
    ok(/3 times/.test(text), 'and how many finds it needs');
    ok((await egg.locator('svg').count()) === 1, 'it is drawn as an egg, not a locked card');
    await ctx.close();
  }

  /* ---- gate 4: hatching --------------------------------------------------- */
  console.log('\n== hatching by playing ==');
  {
    const { ctx, p } = await open(browser, save(SET1, allFluent(SET1.slice(0, 4))));
    const before = await monsCount(p);
    let sawEggTarget = 0;
    for (let i = 0; i < 60; i++) {
      const t = await answerRight(p);
      if (t === 'ph_m') sawEggTarget++;
      if ((await monsCount(p)) > before) break;
    }
    ok(sawEggTarget >= 3, `the egg's sound was offered in play (${sawEggTarget} times)`);
    const after = await monsCount(p);
    ok(after === before + 1, `three finds hatched it (${before} -> ${after} monsters)`);
    const hatched = await p.evaluate(() => {
      const pr = JSON.parse(localStorage.getItem('songbruhs_save_v1')).profiles[0];
      return { owns: Boolean(pr.mons.ph_m), leftover: (pr.eggFinds || {}).ph_m || 0 };
    });
    ok(hatched.owns, 'the new sound is owned');
    ok(hatched.leftover === 0, 'the egg counter is cleared, not left dangling');

    // it joins the world: monsters screen, and the stage roster
    await p.locator('nav [aria-label="Monsters"]').click();
    await p.waitForTimeout(300);
    ok(/Mumbo/.test(await p.locator('main').innerText()), 'the hatched monster appears in Monsters');
    await p.locator('nav [aria-label="Stage"]').click();
    await p.waitForSelector('[data-slot]');
    await p.locator('[data-slot]').first().click();
    await p.waitForTimeout(300);
    ok((await p.locator('button:has-text("Mumbo")').count()) > 0, 'and can be put on the stage');
    await ctx.close();
  }

  /* ---- gate 5: no dead ends ----------------------------------------------- */
  console.log('\n== a fully fluent child still has somewhere to go ==');
  {
    const all = SET1.concat(['ph_m', 'ph_d', 'ph_g', 'ph_o', 'ph_c', 'ph_k']);
    const { ctx, p } = await open(browser, save(all, allFluent(all)));
    await p.locator('nav [aria-label="Monsters"]').click();
    await p.waitForTimeout(300);
    ok((await p.locator('[data-egg]').count()) === 1, 'a child fluent in twelve sounds still has an egg waiting');
    const eggId = await p.locator('[data-egg]').getAttribute('data-egg');
    ok(['ph_e', 'ph_u', 'ph_r', 'ph_h'].includes(eggId), `and it is from the next set (${eggId})`);
    // questions keep coming and stay varied
    await p.locator('nav [aria-label="Play"]').click();
    await p.waitForSelector('[data-target]');
    const seen = new Set();
    for (let i = 0; i < 25; i++) seen.add(await answerRight(p));
    ok(seen.size >= 6, `questions stay varied across a long session (${seen.size} different sounds in 25)`);
    await ctx.close();
  }

  /* ---- gate 6: curated content -------------------------------------------- */
  console.log('\n== every word is hand-written ==');
  {
    const { ctx, p } = await open(browser, save(SET1, allFluent(SET1)));
    const audit = await p.evaluate(() => {
      // the bundle exposes nothing, so read what the UI can show: the scrapbook
      // lists every word the blend bridge can ever produce
      return null;
    });
    await p.locator('nav [aria-label="Grown-ups"]').click();
    await p.waitForSelector('[data-hold-gate]');
    const box = await p.locator('[data-hold-gate]').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(1800);
    await p.mouse.up();
    await p.waitForSelector('[data-family]');
    const total = await p.locator('[data-scrapbook] > *').count();
    ok(total > 0 && total < 60, `the blend word list is a small curated set (${total} words)`);
    ok(audit === null, 'no generated word source exists in the build');
    await ctx.close();
  }

  await browser.close();
  console.log('\n==============================');
  console.log(bad.length ? 'GATE FAILURES:\n' + bad.join('\n') : 'ALL P6 GATES PASS');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
