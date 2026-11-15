# SANDLINE — Tactical FPS (three.js)

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/embongtuyul/makefun-threejs-fps-02-v3/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/embongtuyul/makefun-threejs-fps-02-v3/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical first-person shooter in the Counter-Strike style,
built with three.js 0.187.0. Two teams of five fight over YARD-7, an original
desert freight depot: attackers plant the bomb at site A, B or C, defenders
hold the line. First to 5 rounds takes the yard; sides swap after round 4 —
you attack first, then defend.

## Play

Serve `game/` with any static HTTP server and open `index.html` in desktop
Chrome. No network, no build step.

```
cd game && python3 -m http.server 8080
```

Click **DEPLOY**, then play: WASD move, mouse look, click to fire, R reload,
Shift sprint, Ctrl/C crouch, Space jump, B buy menu, E plant/defuse the bomb,
G frag grenade, 4 smoke, 5 flashbang, 1/2/3 primary/pistol/knife, TAB
scoreboard, right-click aim down sights.

## What is in the game

- **Complete round loop** — freeze/buy phase, 100s rounds, elimination and
  bomb win conditions, intermission, side swap, match end with stats and MVP.
- **Gunplay** — hitscan with head/body/leg hitboxes, damage falloff, a fixed
  learnable recoil pattern per weapon, spread that punishes firing on the
  move, acceleration-based movement, crouching, jumping and AABB collision
  with the map.
- **Tactics** — bomb plant/defuse objective (defuse kits cut the defuse to
  3.6s), per-round economy with loss bonus, buy menu (5 weapons, frag/smoke/
  flash grenades, kevlar, defuse kit), smoke that blocks bot sight, flash-
  bangs that blind, a combat knife, and 9 bots that follow A* routes over a
  validated waypoint graph, hold pre-aimed angles and peek them, play round
  plans (entry/support/lurk, staggered executes, a rotator, trades on
  death), hear five kinds of sound through wall muffling with certainty,
  plant and defuse, shop by team economy (eco rounds when broke), and call
  out contacts on the radio.
- **Map** — YARD-7: three lanes (A Long, Mid, B Tunnel), three sites (the
  crane yard at site C), crates, containers, sandbags and sightlines worth
  playing; golden-hour lighting, procedural canvas textures, fog and a
  gradient sky dome. The minimap shows your current named callout (MID,
  SITE A, SITE C, A LONG…).
- **Presentation** — HUD with health, armor, ammo, money, timer, score,
  killfeed, radio feed, hitmarkers, minimap, damage vignette, flash
  blindness and synthesized WebAudio sound (no audio files).

## Code layout (`game/src/`)

One module per job, fixed 60 Hz simulation kept apart from rendering, one
shared state object, pooled effects (no per-frame allocation in hot loops).
See the source map at the top of `src/main.js`.

| module | job |
|---|---|
| `main.js` | boot, fixed-step loop, shooting, menus, demo mode |
| `config.js` | weapons (with recoil patterns), economy, grenades, bot tuning |
| `state.js` | the single game state object |
| `map.js` | YARD-7 geometry, colliders, waypoints, 3 sites, callout zones |
| `nav.js` | A*: validated waypoint edges, path smoothing, danger map |
| `tactics.js` | round plans (roles, staggered executes, rotator, trades) |
| `collision.js` | AABB raycasts, capsule resolution, ground height |
| `player.js` | first-person movement, look, camera rig |
| `weapons.js` | fire control, spread/recoil model, viewmodel |
| `combat.js` | raycast hits, hitboxes, damage, armor, assists |
| `bots.js` | bot AI: routes, vision, hearing, combat, bomb duties, shopping, radio |
| `grenades.js` | frag/smoke/flash physics, smoke clouds, flash blindness |
| `rounds.js` | round machine, economy, bomb, buy menu, win rules |
| `effects.js` | pooled tracers, particles, muzzle flash |
| `audio.js` | synthesized WebAudio sound effects |
| `hud.js` | DOM HUD, buy menu, killfeed, radio feed, minimap, scoreboard |
| `input.js` | keyboard, mouse, pointer lock |
| `shots.js` | staged screenshot scenes (`?shot=firefight|buy|defuse|board`) |
| `utils.js` | math helpers and preallocated scratch vectors |

## Entry

`main.ts` (repo root) copies `game/` and `screenshots/` to the output
directory and writes `dossier.json` with `buildDossier` from the kit's
`vendor/makefun-threejs.ts`. three.js 0.187.0 is vendored under
`game/vendor/three/` byte for byte from npm.

## License

MIT — see LICENSE.
