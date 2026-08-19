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

## P0 — Fair Play (integrity patch) · 1 session — ✅ DONE
- [x] Tier B: hide the word during the question; show + speak it as a reveal after answering
- [x] Wrong answers: 1st wrong halves coin value + replays target; 2nd wrong ends
      question with modelled completion (correct monster sings, child taps it, 0 coins)
- [x] ~1s input lockout after each wrong tap
- [x] Flagged (missed) sounds re-enter within the next 3 questions (countdown 2)
- [x] Save v2 + migration: per-sound stats {asked, right, fastRight, wrong, totalMs, confusions}
- [x] Copy: fixed "tap the speaker" hint; word list de-sneakied (soup -> seal)
- Gate PASSED: no-ears bot at chance (0 word leaks); guess-bot earned 0 coins;
  lockout blocks taps; flag re-entry verified; v1 saves migrate losslessly.
  Permanent tests: tests/p0-gates.cjs (npm run test:gates).

## P1 — Visible Growth · 2 sessions — ✅ DONE
- [x] Rounds of 5 with a filling trail (streak star deleted); the round ends in a
      Finale where the child's own monsters take the stage and play (temp loops
      until P3 swaps in chant-voices)
- [x] Metal tiers draw gear on the monster itself, on every screen: Silver belt+stud,
      Gold star buckle, Diamond sparkles, Rainbow stripes. Bronze stays bare so
      the first level-up reads as growth.
- [x] Celebration economy: routine correct = coin chime only; voice reserved for
      level-ups and the end of a round
- [x] Feeding spends treats (earned one per round), never coins
- Gate PASSED: trail advances 1..5 then finale; finale waits for a tap (a real
  stopping point); exactly one voice praise per clean round; all four metals
  render and stay inside the character canvas; feeding spends treats and
  disables at zero. tests/p1-gates.cjs
- 🧒 PLAYTEST 1 (still to do with the kids): do they want the round to finish?
  notice evolutions? replay after the bow?

## P2 — Real Voices · 1 session — ✅ DONE
- [x] Recorder flow (MediaRecorder → base64): 6 pure sounds, 24 target words,
      2 praise lines, in the parent's voice. Reached from Create for now; moves
      behind the family corner in P5.
- [x] Clip registry: recorded clip → TTS approximation → skip, everywhere a
      phoneme is spoken (prompts, replays, wrong-answer modelling, shop preview,
      round praise). Clips live in their own storage key, never in the save.
- [ ] Verify on the actual family tablet (iOS MediaRecorder risk; fallback =
      bundled clip set) — needs the real device
- Gate PASSED: with clips present zero schwa strings are spoken; carrier
  sentences still use TTS; a full round completes with no clips at all; a
  partial set mixes cleanly; clips survive reload and never enter the game
  save; a blocked mic explains itself. tests/p2-gates.cjs

## P3 — The Fusion · 2–3 sessions — ✅ DONE  ← the audit's #1 fix
- [x] Chant-voices: a rhythm loop per phoneme playing the parent's recorded
      sound (Tone.Player), with a synthesised stand-in before recording.
      Placing a sound monster on a slot gives it its own voice by default, and
      the slot names the phoneme it is singing.
- [x] Blend bridge: adjacent slots spelling a decodable word light a banner
      (s a t → sat) and speak the whole word on the beat
- [x] Word scrapbook: discovered words persist per child; the Combos tab now
      leads with them
- [x] Round finale plays the child's own band
- Gate PASSED: s+a+t fires "sat", breaking the run clears it, p+a+n fires
  "pan", six simultaneous chants run clean, the scrapbook persists across
  reload. Chant quantisation is proved in tests/engine.cjs (every entry on a
  bar downbeat, all nodes disposed on unmount).
- 🧒 PLAYTEST 2 (still to do): give the younger child s,a,t and no instructions.
  Discovery? Says the word aloud? Rearranges to repeat it?

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
