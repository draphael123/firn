# FIRN

**You roll a sleeping thing, sealed in ice, down out of the cold — and every second of speed melts the only thing keeping it asleep.**

A tilt-the-stage roller in the Monkey Ball tradition, with one substitution: where
Monkey Ball trades speed against control, FIRN trades speed against *containment*.

Play: <https://firn-game.vercel.app> · Dev: `python serve.py` → <http://localhost:5826>

---

## What makes it not Monkey Ball

Melting makes you **better at the course** and **worse at holding it**.

- A thinner shell is a **smaller ball** — faster, and narrow enough for gates a fresh
  ball cannot pass. Shortcuts are bought with shell.
- A thinner shell also means **the thing inside stirs harder** — the offset centre of
  mass wobbles more violently as the ice goes.

So the fast line and the safe line diverge, and the game gets harder in exactly the
way you chose to make it easier. Two props carry the whole argument:

| Prop | Geometry | Threshold |
|---|---|---|
| **Gate** | lintel 0.80 high | passable **below** 54.5% shell |
| **Grate** | bars 0.62 apart | you fall **through** below 27.3% shell |

Melt enough to fit; not so much that the floor forgets you. Neither is scripted —
both are ordinary colliders, and passage is pure geometry.

**The ball is the meter.** Ice is a transmission material whose roughness and
thickness are driven by `shell`: thick ice is frosted and hides what it holds, thin
ice is clear and shows it. `R_MIN` is not an arbitrary floor — it is the sleeper's
own radius, so shell 0 literally means the ice is gone.

**Zero shell is a state, not a death.** You keep rolling: bare, small, quick, and one
hard blow from waking it.

**Failure is succession.** Each attempt is another named bearer in a long line.

## Worlds

Worlds are not skins — they are **bands of the descent**. The route runs down out
of the cold into warmth, so each world sits lower and hotter than the last, and a
world's `band` drives air, light and ground together. Stage difficulty, the melt
economy and the look therefore move in the same direction by construction rather
than being tuned into agreement.

| | Stage | World | Character |
|---|---|---|---|
| I | The Cold Stair | Névé | Wind-scoured snowfield, sastrugi, whiteout |
| II | The Icefall | Icefall | Broken blue blocks and crevasses; a gap you must carry speed into |
| III | The Thaw Gate | Frozen Sea | The shelf: cracked sheet ice, floes, causeway on piers |
| IV | The Cathedral | Cathedral | Enclosed. A vault, stalactites, meltwater pooling warm on the road |
| V | The Grate Run | Geothermal | Black rock, fumaroles, ash haze — where the warmth comes from |

Only the causeway tilts. Everything a world provides stays level, so the horizon
is the fixed reference the tilt is read against. Adding a world is data plus, at
most, one ground builder.

## Structure

```
src/sim.js        physics, melt, wobble — no three.js, runs headless
src/stages.js     the five stages, as data
src/worlds.js     world descriptors, grounds, ridgelines, deck surfaces
src/props.js      cairns, handline, piers, wrecks, vents — all instanced
src/ball.js       the ice shell, the frost, and the passenger
src/autopilot.js  waypoint pilot: verifies routes, drives the title screen
src/render.js     three.js presentation
src/ui.js         menus, settings, persistence
src/main.js       boot, input, frame loop
test/             invariants, course verification, stall probe
```

### Why the ball has four layers

A smooth featureless sphere does not read as rolling — it reads as *sliding*,
because nothing on it moves as it turns. So: a refractive `ice` shell for the
material, a flat-shaded `rime` coat whose patches make rotation legible **and**
whose opacity is the shell gauge, a `crack` lattice that flashes on impact, and a
`sleeper` that leans under load and braces on hits. Frost *is* the shell.

### The one structural idea

The stage is a rigid body that tilts, so the sim runs entirely in **stage-local
space**, where every box stays axis-aligned. Tilting rotates the *gravity vector*
rather than the geometry. Sphere-vs-box is then exact and cheap, and rendering is
just one group rotation. The camera is deliberately **not** in that group: it keeps
world up and never rolls with the floor.

Rolling uses the real solid-sphere constant — `a = 5/7 · g · sin θ` — which is most
of why it feels like weight rather than a sliding puck.

## Tests

```bash
node test/sim-test.mjs && node test/course-check.mjs
```

`sim-test` guards 22 invariants. The load-bearing one:

> **MELT INVARIANT** — `melt = ambient(p) + FRICTION_MELT · contactSpeed`.
> `shell` must never appear on the right-hand side. If thinner melted faster, every
> run would death-spiral and the spend-shell-for-a-shortcut decision would collapse
> into a countdown.

`course-check` flies every route with the autopilot and asserts the ball *reached the
gate and the grate carrying the shell the design requires* — not merely that it
reached the goal. A run that wins without ever meeting the decision proves nothing.

## Known open question

**Stage II's gate-versus-detour margin is not settled.** The harness measures the
gate route at ~30s against ~32s for the switchback, but it measures a bot that crawls
at 4.5 m/s while melting where a human would dive the hot spot and leave. The check
only asserts that neither route is a trap. The real payoff needs a playtest.

## Controls

`WASD` / arrows tilt the stage (absolute angle, camera-relative by default) ·
`R` restart · `Esc` pause. Gamepad stick supported. Everything is remappable-ish
through Settings: tilt limit and response, steering mode, camera follow/distance/
height, brightness, ice quality, snowfall, shadows, resolution, and volumes.

## Credits

Vanilla ES modules, three.js vendored locally in `vendor/`. All sound is synthesised
in WebAudio at runtime — no audio assets. No build step.
