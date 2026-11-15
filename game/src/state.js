// SANDLINE — state.js: one state object for the whole game.
// Every module reads and writes this object; nothing keeps a second copy of
// the match, the round or the actors. `resetMatch` / `resetRound` rebuild the
// per-match and per-round slices so a restart is a clean slate.

import { ECON, TEAM } from './config.js';

// Actor: a fighter in the round. The player is actors[0]; bots fill the rest.
// `mesh` is the THREE.Group for bots (null for the player — first person).
export function makeActor(id, team, isPlayer, name) {
  return {
    id, team, isPlayer, name,
    alive: true, health: 100, armor: 0,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0, onGround: true, crouching: false,
    money: ECON.start,
    weapons: [], // weapon instances (see weapons.js)
    current: 0, // index into weapons
    grenades: 0, smokes: 0, flashes: 0, // grenade counts by type (G / 4 / 5)
    hasBomb: false, hasKit: false, // defuse kit: defuse in 3.6s instead of 5s
    kills: 0, deaths: 0, assists: 0, dmgDealt: 0, // scoreboard columns
    assistId: -1, // last teammate (not the killer) to damage this actor
    mesh: null, // bot body group (null for the player)
    ai: null, // bot brain state (null for the player)
    flashUntil: 0, // sim time until which this actor is blinded by a flash
    lastDamageFrom: -1, lastDamageAt: 0,
  };
}

// Round phases: 'menu' | 'freeze' | 'live' | 'over' | 'matchEnd'
export const state = {
  phase: 'menu',
  time: 0, // seconds since match start (sim clock)
  round: 1,
  roundsWon: [0, 0], // per team
  lossStreak: [0, 0],
  attackerTeam: TEAM.JACKALS, // swaps after SWAP_AFTER_ROUND
  roundTimeLeft: 0,
  liveElapsed: 0, // seconds since the round went live (buy window clock)
  freezeLeft: 0,
  intermissionLeft: 0,
  roundWinner: -1,
  roundReason: '',
  matchWinner: -1,
  bomb: {
    state: 'carried', // 'carried' | 'planted' | 'exploded' | 'defused' | 'dropped'
    site: null, // 'A' | 'B'
    plantProgress: 0, defuseProgress: 0,
    fuseLeft: 0, carrierId: 0, pos: { x: 0, y: 0, z: 0 },
    plantedBy: -1,
  },
  actors: [],
  grenades: [], // live grenades (see grenades.js)
  smokes: [], // live smoke clouds: { x, z, until, group } — block bot sight
  radio: [], // team radio chatter: { text, at, team }
  tracers: [], // active tracer effects (see effects.js)
  killfeed: [], // { text, html, at }
  shake: 0, // camera shake magnitude (explosions)
  spectateId: -1, // actor the dead player watches
  demo: false, // ?demo=1: auto-start with a cinematic camera for screenshots
  stats: { shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0 },
  onKill: null, // set by rounds.js: (victim, attacker, headshot) => void
};

export function attackingTeam() { return state.attackerTeam; }
export function defendingTeam() { return 1 - state.attackerTeam; }
export function player() { return state.actors[0]; }

export function aliveCount(team) {
  let n = 0;
  for (const a of state.actors) if (a.team === team && a.alive) n++;
  return n;
}

export function aliveEnemiesOf(actor) {
  let n = 0;
  for (const a of state.actors) if (a.team !== actor.team && a.alive) n++;
  return n;
}

// Wipe per-round fields but keep match score and money.
export function resetRoundState() {
  state.roundTimeLeft = 0;
  state.liveElapsed = 0;
  state.freezeLeft = 0;
  state.intermissionLeft = 0;
  state.roundWinner = -1;
  state.roundReason = '';
  state.bomb = {
    state: 'carried', site: null, plantProgress: 0, defuseProgress: 0,
    fuseLeft: 0, carrierId: 0, pos: { x: 0, y: 0, z: 0 }, plantedBy: -1,
  };
  state.grenades.length = 0;
  state.tracers.length = 0;
  state.smokes.length = 0;
  state.shake = 0;
  state.spectateId = -1;
  for (const a of state.actors) {
    a.alive = true; a.health = 100; // armor persists between rounds
    a.hasBomb = false; a.flashUntil = 0;
    a.vel.x = 0; a.vel.y = 0; a.vel.z = 0;
    a.crouching = false;
  }
}

export function resetMatchState() {
  state.phase = 'menu';
  state.time = 0;
  state.round = 1;
  state.roundsWon = [0, 0];
  state.lossStreak = [0, 0];
  state.attackerTeam = TEAM.JACKALS;
  state.matchWinner = -1;
  state.killfeed.length = 0;
  state.radio.length = 0;
  state.stats = { shots: 0, hits: 0, headshots: 0, kills: 0, deaths: 0 };
  state.actors.length = 0;
  resetRoundState();
}
