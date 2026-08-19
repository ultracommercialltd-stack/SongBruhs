/* P0 "Fair Play" ship gates — permanent regression tests.
 *
 * These bots broke the v1 game during the audit; they run forever so no
 * change can quietly reopen an exploit:
 *   1. no-ears bot   — plays tier B with no audio. Must NOT beat chance,
 *                      and the prompt word must never be readable pre-answer.
 *   2. guess-bot     — taps wrong cards first (elimination strategy).
 *                      Must earn ZERO coins.
 *   3. lockout       — a tap during the post-wrong lockout must not register.
 *   4. flag re-entry — a twice-missed sound must return within 3 questions.
 *   5. reveal        — tier B shows the word only after answering.
 *   6. migration     — a v1 save (no stats) loads, plays, and gains stats.
 *
 * Run: npm run build && npx vite preview --port 4173 &  node tests/p0-gates.cjs
 * CHROMIUM_PATH overrides the browser binary (needed on CI images with a
 * pre-provisioned chromium, e.g. /opt/pw-browsers/chromium-1194/...).
 */
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4173/';
const EXE = process.env.CHROMIUM_PATH || undefined;
/* the wrong-answer lockout runs long enough for the modelled sound to finish
   (P2 plays a recorded phoneme after the spoken lead-in) */
const LOCKOUT_WAIT = 1800;
const bad = [];
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad.push(m); };

async function freshTierB(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 380, height: 780 } });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'START' }).click();
  await p.waitForSelector("text=Who's playing?");
  await p.fill('input[aria-label="Player name"]', name);
  await p.getByText('Big (5–7)').click();
  await p.getByRole('button', { name: /Let's play/ }).click();
  await p.waitForSelector('[data-target]');
  return { ctx, p };
}

const grid = (p) => p.locator('[data-target]');
const phaseOf = async (p) => grid(p).getAttribute('data-phase');
const targetOf = async (p) => grid(p).getAttribute('data-target');
const coinsOf = async (p) => Number(await p.locator('[data-coins]').getAttribute('data-coins'));

/* Since P1 the drill runs in rounds of five, so any wait may land on the
   band finale instead of the next question. Wait for either, then move on. */
async function waitPhase(p, want, ms = 8000) {
  await p.waitForFunction(
    (w) => {
      if (document.querySelector('[data-finale]')) return true;
      const g = document.querySelector('[data-target]');
      return g && g.getAttribute('data-phase') === w;
    },
    want, { timeout: ms },
  );
}
async function clearFinale(p) {
  if (await p.locator('[data-finale]').count()) {
    await p.getByRole('button', { name: /Another round/ }).click();
    await p.waitForSelector('[data-target]');
    return true;
  }
  return false;
}
const readReveal = (p) => p.evaluate(() => {
  const el = document.querySelector('[data-reveal]');
  return el ? el.getAttribute('data-reveal') : null;
});

/* Complete the current question legitimately and return the tier-B reveal
   word captured during the celebrate phase (null in tier A). */
async function finishQuestion(p) {
  const target = await targetOf(p);
  let phase = await phaseOf(p);
  if (phase === 'ask') {
    await p.waitForTimeout(LOCKOUT_WAIT); // clear any lockout
    await p.locator(`[data-choice="${target}"]`).click();
    phase = await phaseOf(p);
  }
  if (phase === 'model') {
    await p.locator(`[data-choice="${target}"]`).click();
  } else if (phase !== 'correct') {
    await waitPhase(p, 'correct');
  }
  const revealed = await readReveal(p);
  await waitPhase(p, 'ask');
  await clearFinale(p);
  return revealed;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ---- gate 1 + 5: no-ears bot ------------------------------------------- */
  console.log('\n== no-ears bot (tier B, audio-blind) ==');
  {
    const { ctx, p } = await freshTierB(browser, 'NoEars');
    let cleanFirstTap = 0;
    let leaked = 0;
    let captured = 0;
    const N = 20;
    for (let i = 0; i < N; i++) {
      await clearFinale(p);
      // snapshot what a deaf bot can read during the ask phase...
      const askText = (await p.locator('main').innerText()).toLowerCase();
      await p.locator('[data-choice]').first().click();
      if ((await phaseOf(p)) === 'correct') cleanFirstTap++;
      // ...then learn the actual word from the post-answer reveal and check
      // it was never present (whole-word match) before answering
      const revealed = await finishQuestion(p);
      if (revealed) captured++;
      if (revealed && new RegExp(`\\b${revealed.toLowerCase()}\\b`).test(askText)) leaked++;
    }
    ok(captured >= N * 0.75, `reveal captured on most questions (${captured}/${N}) — leak check is not vacuous`);
    ok(leaked === 0, `prompt word never readable during ask (${leaked} leaks in ${N})`);
    ok(cleanFirstTap / N <= 0.65, `blind first-tap rate ${cleanFirstTap}/${N} — at or near chance, exploit closed`);
    await ctx.close();
  }

  /* ---- gate 2: guess-bot -------------------------------------------------- */
  console.log('\n== guess-bot (elimination strategy) ==');
  {
    const { ctx, p } = await freshTierB(browser, 'Guessy');
    const before = await coinsOf(p);
    const N = 12;
    for (let i = 0; i < N; i++) {
      const target = await targetOf(p);
      const wrong = await p.locator('[data-choice]').evaluateAll(
        (els, t) => els.map((e) => e.getAttribute('data-choice')).filter((id) => id !== t), target,
      );
      await p.locator(`[data-choice="${wrong[0]}"]`).click();
      await p.waitForTimeout(LOCKOUT_WAIT);
      await p.locator(`[data-choice="${wrong[1]}"]`).click();
      await waitPhase(p, 'model');
      await p.locator(`[data-choice="${target}"]`).click();
      await waitPhase(p, 'ask');
      await clearFinale(p);
    }
    const after = await coinsOf(p);
    ok(after - before === 0, `elimination earns nothing: ${before} -> ${after} coins over ${N} questions`);
    await ctx.close();
  }

  /* ---- gates 3, 4, 5, and halved reward ----------------------------------- */
  console.log('\n== lockout, halved reward, flag re-entry, reveal ==');
  {
    const { ctx, p } = await freshTierB(browser, 'Gates');
    // lockout + halved: one wrong, immediate correct tap must not register
    let target = await targetOf(p);
    const before = await coinsOf(p);
    const wrong = await p.locator('[data-choice]').evaluateAll(
      (els, t) => els.map((e) => e.getAttribute('data-choice')).filter((id) => id !== t), target,
    );
    await p.locator(`[data-choice="${wrong[0]}"]`).click();
    await p.locator(`[data-choice="${target}"]`).click(); // inside lockout
    await p.waitForTimeout(300);
    ok((await phaseOf(p)) !== 'correct', 'tap during lockout does not register');
    await p.waitForTimeout(LOCKOUT_WAIT);
    await p.locator(`[data-choice="${target}"]`).click();
    await waitPhase(p, 'correct');
    ok((await coinsOf(p)) - before === 1, `one-wrong correct pays half (+${(await coinsOf(p)) - before})`);
    // tier-B reveal appears only now
    ok((await p.locator('[data-reveal]').count()) === 1, 'word revealed after answering (tier B)');
    await waitPhase(p, 'ask');
    await clearFinale(p);

    // flag re-entry: force a modelled miss, expect the target back within 3
    target = await targetOf(p);
    const wrong2 = await p.locator('[data-choice]').evaluateAll(
      (els, t) => els.map((e) => e.getAttribute('data-choice')).filter((id) => id !== t), target,
    );
    await p.locator(`[data-choice="${wrong2[0]}"]`).click();
    await p.waitForTimeout(LOCKOUT_WAIT);
    await p.locator(`[data-choice="${wrong2[1]}"]`).click();
    await waitPhase(p, 'model');
    await p.locator(`[data-choice="${target}"]`).click();
    await waitPhase(p, 'ask');
    await clearFinale(p);
    let seen = false;
    for (let i = 0; i < 3 && !seen; i++) {
      if ((await targetOf(p)) === target) { seen = true; break; }
      await finishQuestion(p);
    }
    if (!seen) seen = (await targetOf(p)) === target;
    ok(seen, `twice-missed sound (${target}) returned within 3 questions`);
    await ctx.close();
  }

  /* ---- gate 6: v1 save migration ------------------------------------------ */
  console.log('\n== v1 save migration ==');
  {
    const ctx = await browser.newContext({ viewport: { width: 380, height: 780 } });
    const p = await ctx.newPage();
    const v1 = {
      profiles: [{
        id: 'kid_v1test', name: 'Legacy', tier: 'A', colour: '#ef6461', coins: 42,
        mons: { ph_s: { xp: 7 }, ph_a: { xp: 2 }, ph_t: { xp: 0 } },
        createdChars: [], discovered: ['garage'], correct: 19,
      }],
      active: 'kid_v1test',
    };
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.evaluate((s) => localStorage.setItem('songbruhs_save_v1', JSON.stringify(s)), v1);
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('button', { name: 'START' }).click();
    await p.waitForSelector('[data-target]');
    ok((await coinsOf(p)) === 42, 'v1 coins preserved (42)');
    // answer one question; stats must appear without disturbing v1 fields
    const target = await targetOf(p);
    await p.locator(`[data-choice="${target}"]`).click();
    await waitPhase(p, 'correct');
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('songbruhs_save_v1')));
    const prof = saved.profiles[0];
    ok(saved.version === 2, 'save carries version 2');
    ok(prof.mons.ph_s.xp >= 7, 'v1 xp preserved');
    ok(prof.discovered.includes('garage'), 'v1 discovered combos preserved');
    ok(prof.stats && prof.stats[target] && prof.stats[target].asked === 1, 'stats recorded for answered sound');
    await ctx.close();
  }

  await browser.close();
  console.log('\n==============================');
  console.log(bad.length ? 'GATE FAILURES:\n' + bad.join('\n') : 'ALL P0 GATES PASS');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
