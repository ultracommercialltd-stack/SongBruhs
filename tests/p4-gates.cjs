/* P4 "The Quiet Teacher" ship gates.
 *
 * Four simulated learners play 50+ questions each; the game must respond to
 * each differently without ever showing a difficulty setting.
 *
 *   1. wobbly focus   — a child strong on some sounds and weak on others is
 *                       asked mostly about the weak ones.
 *   2. contrast drill — a child who keeps confusing one pair gets a two-card
 *                       round on just that pair, which then resolves.
 *   3. impulse taps    — wrongs faster than a child could have listened do not
 *                       teach the model that the sound is unknown.
 *   4. word promotion  — word questions arrive per sound as that sound becomes
 *                       fluent, with no tier setting anywhere.
 *   5. shop gate       — new monsters unlock on mastery, not on the wallet.
 */
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4173/';
const EXE = process.env.CHROMIUM_PATH || undefined;
const bad = [];
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad.push(m); };

const ALL = ['ph_s', 'ph_a', 'ph_t', 'ph_p', 'ph_i', 'ph_n'];
/* Owning every sound means no egg is waiting, so these gates measure the
   adaptive picker rather than P6's new-arrival questions. */
const EVERY = ALL.concat(['ph_m', 'ph_d', 'ph_g', 'ph_o', 'ph_c', 'ph_k',
  'ph_e', 'ph_u', 'ph_r', 'ph_h', 'ph_b', 'ph_f', 'ph_l']);
const stat = (o) => ({ asked: 0, right: 0, fastRight: 0, wrong: 0, totalMs: 0, confusions: {}, ...o });

function saveWith(mons, stats, extra) {
  return {
    version: 2, active: 'kid',
    profiles: [{
      id: 'kid', name: 'Sim', tier: 'A', colour: '#4ea8de', coins: 200, treats: 5,
      mons: Object.fromEntries(mons.map((id) => [id, { xp: 0 }])),
      stats, createdChars: [], discovered: [], words: [], correct: 0, ...(extra || {}),
    }],
  };
}

async function open(browser, save) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate((s) => localStorage.setItem('songbruhs_save_v1', JSON.stringify(s)), save);
  await p.reload({ waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'START' }).click();
  await p.waitForSelector('[data-target]');
  return { ctx, p };
}

const grid = (p) => p.locator('[data-target]');
const targetOf = (p) => grid(p).getAttribute('data-target');
const choicesOf = (p) => p.locator('[data-choice]').evaluateAll((els) => els.map((e) => e.getAttribute('data-choice')));

async function toAsk(p) {
  await p.waitForFunction(() => {
    const g = document.querySelector('[data-target]');
    return !g || g.getAttribute('data-phase') === 'ask';
  }, null, { timeout: 9000 });
  if (await p.locator('[data-finale]').count()) {
    await p.getByRole('button', { name: /Another round/ }).click();
    await p.waitForSelector('[data-target]');
  }
}

/* Play n questions; `strategy(target, choices)` returns the id to tap. */
async function play(p, n, strategy, opts) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    const target = await targetOf(p);
    const choices = await choicesOf(p);
    const word = await p.locator('[data-target]').evaluate(() => {
      const el = document.querySelector('main p.text-lg');
      return el ? el.textContent : '';
    });
    seen.push({ target, choices, wordQuestion: /word start with/i.test(word) });
    const pick = strategy(target, choices, i);
    if (opts && opts.delayMs) await p.waitForTimeout(opts.delayMs);
    await p.locator(`[data-choice="${pick}"]`).click();
    if (pick !== target) {
      await p.waitForTimeout(1900);                 // clear the lockout
      const after = await p.locator('[data-target]').getAttribute('data-phase');
      if (after === 'model') await p.locator(`[data-choice="${target}"]`).click();
      else await p.locator(`[data-choice="${target}"]`).click();
    }
    await toAsk(p);
  }
  return seen;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ---- gate 1: the picker favours wobbly sounds -------------------------- */
  console.log('\n== a child strong on some sounds, weak on others ==');
  {
    // s and a fluent; t and p wobbly; i and n untouched
    const stats = {
      ph_s: stat({ asked: 10, right: 10, fastRight: 10 }),
      ph_a: stat({ asked: 10, right: 10, fastRight: 10 }),
      ph_t: stat({ asked: 8, right: 4, fastRight: 2, wrong: 1 }),
      ph_p: stat({ asked: 8, right: 4, fastRight: 2, wrong: 1 }),
    };
    const { ctx, p } = await open(browser, saveWith(EVERY, stats));
    const seen = await play(p, 40, (t) => t, { delayMs: 60 });
    /* Measure the opening stretch: this sim answers everything correctly, so
       the wobbly sounds become fluent as it plays and the mix shifts - which
       is the system working, but makes a whole-run ratio meaningless. */
    const early = seen.slice(0, 15);
    const count = {};
    early.forEach((s) => { count[s.target] = (count[s.target] || 0) + 1; });
    const wobbly = (count.ph_t || 0) + (count.ph_p || 0);
    const known = (count.ph_s || 0) + (count.ph_a || 0);
    ok(wobbly > known,
      `while they are still weak, t+p are asked more than the mastered s+a (${wobbly} vs ${known} of 15)`);
    const all = {};
    seen.forEach((s) => { all[s.target] = (all[s.target] || 0) + 1; });
    ok((all.ph_s || 0) + (all.ph_a || 0) > 0, `mastered sounds still come round for maintenance (${(all.ph_s || 0) + (all.ph_a || 0)})`);
    ok(Object.keys(all).length >= 4, `the picker still covers the set (${Object.keys(all).length} sounds seen)`);
    // and the model actually moved: t/p should be fluent by the end
    const grew = await p.evaluate(() => {
      const sv = JSON.parse(localStorage.getItem('songbruhs_save_v1'));
      return sv.profiles[0].stats.ph_t.right;
    });
    ok(grew > 4, `practice moved the model for the weak sound (ph_t right: ${grew})`);
    await ctx.close();
  }

  /* ---- gate 2: contrast drill -------------------------------------------- */
  console.log('\n== a child who keeps mixing up two sounds ==');
  {
    const stats = {
      ph_s: stat({ asked: 6, right: 3, wrong: 3, confusions: { ph_n: 3 } }),
    };
    const { ctx, p } = await open(browser, saveWith(ALL, stats));
    const seen = await play(p, 12, (t) => t, { delayMs: 60 });
    const twoCard = seen.filter((s) => s.choices.length === 2);
    ok(twoCard.length > 0, `a two-card contrast drill appeared (${twoCard.length} of 12)`);
    ok(twoCard.every((s) => s.choices.includes('ph_s') && s.choices.includes('ph_n')),
      'the drill is on exactly the confused pair');
    const threeAfter = seen.slice(seen.findIndex((s) => s.choices.length === 2)).filter((s) => s.choices.length === 3);
    ok(threeAfter.length > 0, `the drill resolves and normal questions resume (${threeAfter.length} after)`);
    const cleared = await p.evaluate(() => {
      const sv = JSON.parse(localStorage.getItem('songbruhs_save_v1'));
      return (sv.profiles[0].stats.ph_s.confusions || {}).ph_n || 0;
    });
    ok(cleared === 0, `the resolved confusion is cleared so the drill cannot loop (${cleared})`);
    await ctx.close();
  }

  /* ---- gate 3: impulse taps -------------------------------------------- */
  console.log('\n== a child machine-gunning the cards ==');
  {
    const { ctx, p } = await open(browser, saveWith(ALL, {}));
    // tap a wrong card instantly, every question
    await play(p, 8, (t, ch) => ch.find((c) => c !== t), { delayMs: 0 });
    const confusions = await p.evaluate(() => {
      const sv = JSON.parse(localStorage.getItem('songbruhs_save_v1'));
      return Object.values(sv.profiles[0].stats).reduce(
        (n, st) => n + Object.values(st.confusions || {}).reduce((a, b) => a + b, 0), 0);
    });
    ok(confusions === 0, `instant wrong taps taught the model nothing (${confusions} confusions recorded)`);
    await ctx.close();
  }

  /* ---- gate 4: word questions arrive with fluency ------------------------ */
  console.log('\n== word questions arrive per sound, with no tier setting ==');
  {
    // no tier chooser on the signup screen any more
    const ctx0 = await browser.newContext({ viewport: { width: 900, height: 900 } });
    const p0 = await ctx0.newPage();
    await p0.goto(URL, { waitUntil: 'networkidle' });
    await p0.getByRole('button', { name: 'START' }).click();
    await p0.waitForSelector("text=Who's playing?");
    const gateText = await p0.locator('body').innerText();
    ok(!/Little \(3–5\)|Big \(5–7\)/.test(gateText), 'the parent is no longer asked to pick a difficulty');
    await ctx0.close();

    // a beginner gets sound questions only
    const { ctx: c1, p: p1 } = await open(browser, saveWith(ALL, {}));
    const early = await play(p1, 10, (t) => t, { delayMs: 60 });
    /* Only the opening stretch: this sim answers everything correctly, so a
       sound can reach fluency mid-run and be promoted - which is the point of
       the feature. The picker never repeats the immediate last target, so in
       five questions no sound can reach the four fast corrects promotion needs. */
    const opening = early.slice(0, 5);
    ok(opening.every((s) => !s.wordQuestion),
      `a child with no history starts on sound questions (${opening.filter((s) => s.wordQuestion).length} word questions in the first 5)`);
    ok(early.filter((s) => s.wordQuestion).length < 10,
      'and is not wholesale promoted before earning it');
    await c1.close();

    // a child fluent in everything gets word questions
    const fluent = {};
    EVERY.forEach((id) => { fluent[id] = stat({ asked: 12, right: 12, fastRight: 12 }); });
    const { ctx: c2, p: p2 } = await open(browser, saveWith(EVERY, fluent));
    const later = await play(p2, 10, (t) => t, { delayMs: 60 });
    ok(later.filter((s) => s.wordQuestion).length >= 8,
      `a fluent child is promoted to word questions (${later.filter((s) => s.wordQuestion).length}/10)`);
    await c2.close();
  }

  /* ---- gate 5: mastery gates the shop ------------------------------------ */
  console.log('\n== the shop follows mastery, not the wallet ==');
  {
    // rich but not fluent: locked
    const { ctx: c1, p: p1 } = await open(browser, saveWith(['ph_s', 'ph_a'], {}));
    await p1.locator('nav [aria-label="Shop"]').click();
    await p1.waitForTimeout(300);
    ok((await p1.locator('[data-shop-unlocked]').getAttribute('data-shop-unlocked')) === '0',
      '200 coins does not open the shop on its own');
    ok((await p1.locator('main button:has-text("Locked")').count()) > 0, 'new monsters read as Locked');
    await c1.close();

    // fluent in three: open
    const fluent3 = {
      ph_s: stat({ asked: 12, right: 12, fastRight: 12 }),
      ph_a: stat({ asked: 12, right: 12, fastRight: 12 }),
      ph_t: stat({ asked: 12, right: 12, fastRight: 12 }),
    };
    const { ctx: c2, p: p2 } = await open(browser, saveWith(['ph_s', 'ph_a', 'ph_t'], fluent3));
    await p2.locator('nav [aria-label="Shop"]').click();
    await p2.waitForTimeout(300);
    ok((await p2.locator('[data-shop-unlocked]').getAttribute('data-shop-unlocked')) === '1',
      'three fluent sounds open the shop');
    await c2.close();
  }

  await browser.close();
  console.log('\n==============================');
  console.log(bad.length ? 'GATE FAILURES:\n' + bad.join('\n') : 'ALL P4 GATES PASS');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
