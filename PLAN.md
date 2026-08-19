# The Sound Island Build Plan

Remediation roadmap for every finding in the Sound Island audit. Seven shippable
phases, dependency-ordered. Each phase merges to `main` green and auto-deploys.
Full rationale, coverage matrix and ship gates:
https://claude.ai/code/artifact/4047adc8-74d3-414c-8bdc-f29322776d56
(companion audit: https://claude.ai/code/artifact/7bd321a4-407c-4b2d-a1ee-a6316dcd9bda)

Rules that govern sequencing:
1. Severity ≠ sequence — the worst finding (learning/game disconnection) lands
   in P3 because its prerequisites are themselves fixes.
2. Data logging starts in P0 even though its UI ships in P5.
3. The audit's exploit bots (no-ears bot, guess-bot) become permanent
   regression tests.
4. Two kid playtests (after P1 and P3) can re-order everything after P3.

## P0 — Fair Play (integrity patch) · 1 session
- [ ] Tier B: hide the word during the question; show + speak it as a reveal after answering
- [ ] Wrong answers: 1st wrong halves coin value + replays target; 2nd wrong ends
      question with modelled completion (correct monster sings, child taps it, 0 coins)
- [ ] ~1s input lockout after each wrong tap
- [ ] Flagged (missed) sounds re-enter within the next 3 questions
- [ ] Save v2 + migration: per-sound log {asked, right, wrong, msToAnswer, distractorId}
- [ ] Copy: fix "tap the speaker" hint; audit word lists (no sneaky vowels in decode pools)
- Gate: no-ears bot ≤40%; guess-bot earns 0 coins over 20 Qs; v1 saves migrate; harness green.

## P1 — Visible Growth · 2 sessions
- [ ] Rounds of 5 with progress trail (replaces streak star); round end = owned
      monsters perform 2 bars on the engine (temp voices until P3)
- [ ] Metal tiers add visible layers to the monster everywhere (Bronze scarf →
      Silver headphones → Gold aura → Diamond sparkle → Rainbow costume)
- [ ] Celebration economy: routine correct = chime + one sung note; voice praise
      only on round complete / first mastery / level-up
- [ ] Feeding decoupled from coins→XP exchange; food = occasional round treat
- Gate: round→performance no dead air; evolution visible on all screens; session has an ending.
- 🧒 PLAYTEST 1: do they want the round to finish? notice evolutions? replay after the bow?

## P2 — Real Voices · 1 session
- [ ] Family-corner recorder flow (MediaRecorder → Opus → base64 in save): 6 phonemes
      ×2 takes + target words + praise lines, in the parent's voice
- [ ] Clip registry: recorded clip → improved TTS → skip, everywhere phonemes are spoken
- [ ] Verify on the actual family tablet (iOS MediaRecorder risk; fallback = bundled clip set)
- Gate: /t/ and /p/ play with no schwa; recording flow <10 min; save with clips survives reload.

## P3 — The Fusion · 2–3 sessions  ← the audit's #1 fix
- [ ] Chant-voices: buildChant() loop (Tone.Player + gate, quantised "1m") per phoneme
      monster; placing one on stage defaults to its own sound
- [ ] Blend bridge: adjacent slots spelling a known VC/CVC word → chants converge
      each bar → whole-word clip pops on the downbeat + banner
- [ ] Word combos: discovered words fill a scrapbook (Combos panel becomes this)
- [ ] Round payoff upgraded to chant-voices
- Gate: chant entries quantised (extend existing test); s-a-t fires reliably;
  8 layers incl. chants under the limiter; no node leaks on add/remove.
- 🧒 PLAYTEST 2: give the younger child s,a,t and no instructions. Discovery? Says the
  word aloud? Rearranges to repeat it? If no → iterate telegraphing before P4+.

## P4 — The Quiet Teacher · 2 sessions
- [ ] Mastery per sound: fast correct +1, slow/replayed +0.5, wrong −1 (0..5)
- [ ] Picker: ~60% wobbly / 20% newest / 20% maintenance
- [ ] Mistake intelligence: <700ms wrongs don't count; repeated same-distractor →
      2-card contrast drill until 3 clean; sustained guessing suspends payouts
- [ ] Mastery gates shop unlocks (3 sounds ≥4 → next monster purchasable); tier B
      words mix in per-sound automatically; remove A/B toggle from signup
- Gate: simulated learners (strong / struggling / guesser / s-n-confused) each get
  the intended mix over 50 questions; contrast drill triggers and resolves.

## P5 — A Kid's House · 2 sessions
- [ ] Kid nav → 4 tabs (Play, Monsters, Shop, Stage); Combos tab dissolves;
      Create + recorder + player switch + parent card behind hold-3s family corner
- [ ] Parent card: knows / improving / practising per sound, minutes, one
      dinner-table tip (data from P0 logs)
- [ ] Voice on tab switch; icon-first kid buttons with speech on tap
- [ ] Caption toggle (tier A shows target grapheme = letter-matching mode, labelled)
- [ ] Remove Solo from slot popover
- Gate: zero required reading on any kid surface; card comprehensible in 10s;
  hold-gate defeats toddler tapping.

## P6 — New Arrivals · 1–2 sessions
- [ ] GPC sets 2–4 (m d g o c k · ck e u r · h b f l) as eggs that hum their sound
      and hatch after the child finds it 3× across rounds
- [ ] CVC word pool grows from mastered sounds only (hand-curated list)
- [ ] Recorder round 2 prompts new phonemes as sets unlock
- Gate: simulated month of play never runs dry; every audible word is human-curated.

## Later — The Rhythm Section (maths)
Enters through the beat, reusing P1–P6 machinery: subitising drummer ("how many
claps?"), exact-count beat filling, ticket-booth number bonds, skip-count riffs.
Scheduled after the phonics arc proves itself in playtests.

## Deliberately not doing
No accounts/cloud sync, no notifications, no second currency, no voice
recognition, no AI-generated child-facing content, no new tabs.
