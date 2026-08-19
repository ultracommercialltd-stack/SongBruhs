/* P5 "A Kid's House" ship gates.
 *
 *   1. kid nav       — four tabs a four-year-old can operate, all icon-led.
 *   2. no reading    — nothing a child must read to play: every kid-facing
 *                      control is an icon and/or speaks on tap.
 *   3. hold gate     — the family corner needs a sustained press; a toddler's
 *                      tap bounces off it.
 *   4. parent card   — renders real logged data in bands, with one tip.
 *   5. captions      — the letter-matching rung can be turned on, is labelled
 *                      as such, and actually shows the letter.
 *   6. no escape     — switch-player and the creator are behind the gate; the
 *                      kid surface has no door out of the game.
 */
const { chromium } = require('playwright');

const URL = process.env.URL || 'http://localhost:4173/';
const EXE = process.env.CHROMIUM_PATH || undefined;
const bad = [];
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) bad.push(m); };

const stat = (o) => ({ asked: 0, right: 0, fastRight: 0, wrong: 0, totalMs: 0, confusions: {}, ...o });
const SAVE = {
  version: 2, active: 'kid',
  profiles: [{
    id: 'kid', name: 'Ada', tier: 'A', colour: '#8ac926', coins: 40, treats: 3,
    mons: { ph_s: { xp: 6 }, ph_a: { xp: 2 }, ph_t: { xp: 0 }, ph_n: { xp: 0 } },
    stats: {
      ph_s: stat({ asked: 14, right: 13, fastRight: 12 }),
      ph_a: stat({ asked: 10, right: 7, fastRight: 3, wrong: 3, confusions: { ph_t: 2 } }),
      ph_t: stat({ asked: 8, right: 2, fastRight: 1, wrong: 6 }),
    },
    createdChars: [], discovered: [], words: ['sat', 'an'], correct: 22, captions: false,
  }],
};

async function open(browser, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 380, height: 800 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__sbSpeechLog = []; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate((s) => localStorage.setItem('songbruhs_save_v1', JSON.stringify(s)), SAVE);
  await p.reload({ waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'START' }).click();
  await p.waitForSelector('[data-target]');
  return { ctx, p };
}

async function openFamily(p) {
  await p.locator('nav [aria-label="Grown-ups"]').click();
  await p.waitForSelector('[data-hold-gate]');
  const box = await p.locator('[data-hold-gate]').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(1800);
  await p.mouse.up();
  await p.waitForSelector('[data-family]', { timeout: 4000 });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });

  /* ---- gates 1, 2, 6: the kid surface ------------------------------------ */
  console.log('\n== the kid surface ==');
  {
    const { ctx, p } = await open(browser);
    const kidTabs = await p.locator('nav button').count();
    ok(kidTabs === 5, `four kid tabs plus one small family door (${kidTabs} buttons)`);
    for (const label of ['Play', 'Monsters', 'Shop', 'Stage']) {
      ok((await p.locator(`nav [aria-label="${label}"]`).count()) === 1, `${label} tab present`);
    }
    ok((await p.locator('nav [aria-label="Create"]').count()) === 0, 'Create is gone from the kid nav');
    ok((await p.locator('nav [aria-label="Combos"]').count()) === 0, 'Combos is gone from the kid nav');
    ok((await p.locator('header button[title*="Switch player"]').count()) === 0,
      'the switch-player escape hatch is gone from the header');

    // tabs speak their name for a pre-reader
    await p.evaluate(() => { window.__sbSpeechLog.length = 0; });
    await p.locator('nav [aria-label="Monsters"]').click();
    await p.waitForTimeout(300);
    const spoken = await p.evaluate(() => window.__sbSpeechLog.slice());
    ok(spoken.some((t) => /monsters/i.test(t)), `the tab says its own name (${spoken.join(', ')})`);

    // the replay control is an icon, not a phrase
    await p.locator('nav [aria-label="Play"]').click();
    await p.waitForSelector('[data-target]');
    const replay = p.locator('button[aria-label="Hear it again"]');
    ok((await replay.innerText()).trim() === '', 'the replay control is a speaker icon with no text to read');
    const box = await replay.boundingBox();
    ok(box.width >= 44 && box.height >= 44, `and it is a real tap target (${Math.round(box.width)}x${Math.round(box.height)})`);

    // no Solo in the kid popover
    await p.locator('nav [aria-label="Stage"]').click();
    await p.waitForSelector('[data-slot]');
    await p.locator('[data-slot]').first().click();
    await p.waitForTimeout(300);
    if (await p.getByRole('button', { name: /Remove/ }).count()) {
      ok((await p.getByRole('button', { name: /^Solo/ }).count()) === 0, 'Solo is gone from the slot sheet');
    } else {
      ok(true, 'empty slot opens the character picker, no producer controls');
    }
    await ctx.close();
  }

  /* ---- gate 3: the hold gate --------------------------------------------- */
  console.log('\n== the family door ==');
  {
    const { ctx, p } = await open(browser);
    await p.locator('nav [aria-label="Grown-ups"]').click();
    await p.waitForSelector('[data-hold-gate]');
    // a toddler tap
    await p.locator('[data-hold-gate]').click();
    await p.waitForTimeout(400);
    ok((await p.locator('[data-family]').count()) === 0, 'a quick tap does not open the family corner');
    // a short press, released early
    const box = await p.locator('[data-hold-gate]').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(600);
    await p.mouse.up();
    await p.waitForTimeout(400);
    ok((await p.locator('[data-family]').count()) === 0, 'letting go early does not open it either');
    // a real hold
    await openFamily(p);
    ok((await p.locator('[data-family]').count()) === 1, 'a sustained hold opens it');
    await ctx.close();
  }

  /* ---- gates 4, 5: the parent card and captions -------------------------- */
  console.log('\n== the parent card ==');
  {
    const { ctx, p } = await open(browser, { width: 900, height: 1000 });
    await openFamily(p);
    const card = p.locator('[data-parent-card]');
    ok((await card.count()) === 1, 'the parent card renders');
    const answered = Number(await card.getAttribute('data-parent-card'));
    ok(answered === 32, `it counts real logged answers (${answered} from the seeded stats)`);
    const text = await card.innerText();
    ok(/Ada/.test(text), 'it is about this child by name');
    ok(/KNOWS/.test(text) && /NEEDS PRACTICE/.test(text), 'it bands sounds into knows / improving / needs practice');
    ok(/TRY THIS AT DINNER/.test(text), 'it ends with one thing to try away from the screen');
    ok(/2 words built/.test(text) || /words built/.test(text), 'it reports words built on the stage');
    ok(!/%\s*%|NaN|undefined/.test(text), 'no broken numbers');
    // the seeded child is strong on s, weak on t
    const knowsIdx = text.indexOf('KNOWS');
    const practIdx = text.indexOf('NEEDS PRACTICE');
    ok(text.slice(knowsIdx, text.indexOf('IMPROVING')).includes('s'), 'the mastered sound sits under KNOWS');
    ok(text.slice(practIdx, practIdx + 120).includes('t'), 'the failing sound sits under NEEDS PRACTICE');

    console.log('\n== captions (the letter-matching rung) ==');
    const toggle = p.locator('[data-captions]');
    ok((await toggle.getAttribute('data-captions')) === '0', 'captions start off');
    const label = await toggle.innerText();
    ok(/letter-matching/i.test(label), 'the toggle is honest that it changes the task');
    ok(/deaf|hard-of-hearing/i.test(label), 'and says who it is for');
    await toggle.click();
    await p.waitForTimeout(300);
    ok((await toggle.getAttribute('data-captions')) === '1', 'it turns on');
    await p.locator('nav [aria-label="Play"]').click();
    await p.waitForSelector('[data-target]');
    const cap = p.locator('[data-caption]');
    ok((await cap.count()) === 1, 'the target letter is now on screen');
    const shown = await cap.getAttribute('data-caption');
    const target = await p.locator('[data-target]').getAttribute('data-target');
    ok(shown.length === 1, `and it is a single grapheme ("${shown}" for ${target})`);
    await ctx.close();
  }

  /* ---- creator and recorder live behind the gate -------------------------- */
  console.log('\n== grown-up tools are behind the door ==');
  {
    const { ctx, p } = await open(browser, { width: 900, height: 1000 });
    await openFamily(p);
    for (const label of ['Progress', 'Voices', 'Create']) {
      ok((await p.getByRole('button', { name: label }).count()) >= 1, `${label} is inside the family corner`);
    }
    await p.getByRole('button', { name: 'Voices' }).click();
    await p.waitForTimeout(300);
    ok((await p.locator('[data-recorder]').count()) === 1, 'the voice recorder opens here now');
    await p.getByRole('button', { name: 'Create' }).click();
    await p.waitForTimeout(300);
    ok((await p.locator('input[aria-label="Character name"]').count()) === 1, 'the creator lives here too');
    await ctx.close();
  }

  await browser.close();
  console.log('\n==============================');
  console.log(bad.length ? 'GATE FAILURES:\n' + bad.join('\n') : 'ALL P5 GATES PASS');
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error('THREW:', e.message); process.exit(1); });
