# SongBruhs

A single-file React artifact: a drag-and-drop looping music mixer with a character creator.
All art is inline SVG, all audio is synthesised at runtime. No images, no audio files, no fonts.

Original assets only — the loop-mixer mechanic is the reference; the characters, names,
sound packs and combos here are all our own.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
```

## Deploy (Vercel)

Import the repo and pick the **Vite** preset. Everything else is auto-detected:

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `./` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

No environment variables. It is a fully static single-page app — all audio is
generated in the browser, so there is no server side and nothing to configure.

## Using the component on its own

```jsx
import SongBruhs from './SongBruhs.jsx';

<SongBruhs />
```

No props. Requires `react`, `tone`, `lucide-react`, and Tailwind (core utilities only —
no arbitrary values, no custom config).

## How it works

**Audio.** One `Tone.Transport` at 110 BPM, 4/4. Every loop is 2 bars in A minor
(melodic content uses only A/C/D/E/G, so any combination of layers is consonant).
Loops are built lazily on first use and cached for the lifetime of the component —
removing a sound stops its `Part` and fades its gate to zero, it never disposes and
rebuilds, so add/remove churn allocates nothing. Everything is disposed on unmount.

Entries are quantised to `"1m"`: a sound dropped mid-bar has its `Part` started, and
its gate ramped up, at the next bar downbeat. Nothing is ever scheduled off-grid.

Master chain is `bus → Compressor → Limiter → destination`, with per-loop levels
tuned so all 7 slots plus a combo bonus layer stay under the limiter.

**Sounds.** 20 loops across 5 colour-coded families — BEATS (red), BASS (blue),
MELODY (green), VOICE (yellow), FX (purple) — four variants each.

**Interaction.** Tap-to-select then tap-a-slot is the primary input and needs no
drag. Pointer-event dragging from tray to slot is the secondary path (pointer events,
not HTML5 DnD, so it works on touch). Tapping an occupied slot opens mute / solo /
remove / swap-character.

**Combos.** Four hidden sets of three sound IDs. Satisfying one highlights the three
contributing characters, fades in a bonus layer on the next bar, and names the combo
in a banner. The Combos tab shows undiscovered sets as `? ? ?` with only their family
colours as a hint.

**Animation** is CSS keyframes only — React never re-renders on the beat. Bob duration
is `60 / 110 * 2` seconds and every character is phase-locked to the audio start via a
negative `animation-delay`, so characters that start singing later stay in step.

## Sound Island — the phonics game

A phonics game for 3–7s built on top of the mixer. Seven build phases, each
with its own gate tests (`npm test`). Full plan and rationale in PLAN.md.

**Profiles.** Each kid gets a save on the device (coins, monsters, mastery,
creations, words). The last player auto-resumes.

**Play.** Rounds of five spoken questions with a filling trail. Finish a round
and the child's own monsters take the stage and perform. There is no difficulty
setting: the game reads one mastery number per sound and asks mostly about the
wobbly ones, promoting a sound to word questions once it is fluent.

**Wrong answers teach.** First wrong halves the reward and replays the sound;
second wrong models the answer — the right monster sings and the child taps it
to finish. Missed sounds come back two questions later. A distractor that beats
the same target twice triggers a two-card drill on exactly that pair. Taps
faster than a child could have listened are treated as slips, not gaps.

**Real voices.** Browser speech cannot make a clean /t/ or /p/ — it says "tuh",
"puh", the schwa error that makes blending impossible. The family corner has a
recorder so a parent records the sounds in their own voice; everything falls
back to speech synthesis until they do.

**The fusion.** Sound monsters sing their own phoneme on the stage, quantised
to the beat. Stand s, a and t next to each other and they blend: a banner shows
`s a t → sat` and the word is spoken on the beat. Discovered words fill a
scrapbook. Arranging the band is arranging phonemes.

**Growing.** Answers and treats raise each monster through visible metal tiers —
Silver belt, Gold star, Diamond sparkles, Rainbow stripes — drawn on the monster
everywhere it appears. 19 sounds across four GPC sets; new ones arrive as eggs
that hum and hatch after the child finds the sound three times in play, paced by
fluency rather than coins.

**Grown-ups.** Four kid tabs (Play, Monsters, Shop, Stage) plus a hold-to-open
family door holding the parent card (knows / improving / needs practice, with a
dinner-table tip from the child's real confusions), the recorder, the character
creator and player switching. A caption toggle shows the target letter for deaf
and hard-of-hearing players, labelled honestly as letter-matching.

Nothing is uploaded, there are no ads, purchases, notifications or streak
punishments, and every word the game speaks is hand-written.

## Tests

```bash
npm test          # engine invariants + all seven phase gates
npm run test:engine   # audio: quantisation, loop caching, disposal (jsdom + Tone stub)
npm run test:gates    # P0..P6 in real Chromium against the production build
```

Two of these started as exploits found in an audit and are now permanent: an
audio-blind bot that once scored 100% on the phonics quiz, and a guess-bot that
once earned full coins by elimination. Both must fail forever.

The stage arrangement itself (which sound is on which slot) is still
session-only by design.
