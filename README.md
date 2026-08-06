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

## Learning game (Sound Island v1)

On top of the mixer sits a phonics game for kids (3–7):

- **Profiles** — each kid gets their own save (coins, monsters, creations),
  stored in `localStorage` on the device. The last active player auto-resumes.
- **Play** — spoken questions via the browser's speech synthesis. Two tiers:
  *Little* (3–5): hear a pure sound, tap the monster that says it.
  *Big* (5–7): hear a word, tap the sound it starts with.
- **Coins** — +2 per correct answer, streak bonuses every 5.
- **Monsters** — the s-a-t-p-i-n crew. Each correct answer gives that monster
  XP; feeding (5 coins) gives more. XP climbs NumBots-style metal tiers:
  Bronze → Silver → Gold → Diamond → Rainbow.
- **Shop** — the crew starts with s and a; t, p, i, n are bought with coins.
- Owned monsters join the roster and can perform on the mixer Stage.

Note on phoneme audio: browser TTS cannot produce a perfectly clean /t/ or
/p/, so those prompts use close approximations ("tuh", "puh"). For proper
phonics precision, swap in recorded voice clips later.

The stage arrangement itself (which sound is on which slot) is still
session-only by design.
