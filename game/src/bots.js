// SANDLINE — bots.js: the other nine fighters.
// Each bot has a small brain: a role from the round plan (entry/support/
// lurk push, hold/rotate defend — tactics.js), an A* path over the
// validated waypoint graph (nav.js: danger bends routes, smoothing cuts
// corners), vision (cone + LOS + reaction delay, blocked by smoke, blinded
// by flash), HEARING with wall muffling and certainty, hold angles with
// peek oscillation, burst fire with aim error, and bomb duties. Bots SHOP
// with their own money and call out contacts on the radio ("contact, MID").

import * as THREE from 'three';
import { BOT, MOVE, TEAM_COLOR } from './config.js';
import { groundHeightAt, hasLineOfSight, resolveCircle } from './collision.js';
import { shootRay } from './combat.js';
import { HOLD_SPOTS, locationAt, SITES, WAYPOINTS } from './map.js';
import { findPath, markDanger, nearestWaypoint } from './nav.js';
import { rotateTo } from './tactics.js';
import { state } from './state.js';
import { clamp, dist2D, pick, rand, randInt, yawTo } from './utils.js';
import { fireBlockReason, makeWeapon, spendRound, startReload, updateReload, updateWeaponFeel } from './weapons.js';
import { isSmoked, throwGrenade } from './grenades.js';
import { sfx } from './audio.js';

// Approach waypoint per site (bots stage here before entering the site).
const SITE_WP = { A: 16, B: 18, C: 23 };

export const BOT_NAMES = ['VIPER', 'GHOST', 'HAVOC', 'NOMAD', 'REAPER', 'SABLE', 'ORION', 'DUSK', 'WRAITH'];

// Team radio: bots call out what they see (HUD shows the last few lines).
export function radio(actor, msg, now) {
  if (now - (actor.ai ? actor.ai.radioAt : 0) < 4 && actor.ai) return;
  if (actor.ai) actor.ai.radioAt = now;
  state.radio.push({ text: `${actor.name}: ${msg}`, at: now, team: actor.team });
  if (state.radio.length > 12) state.radio.shift();
  if (actor.team === state.actors[0].team) sfx.radio();
}

// Sounds bots can hear: { x, z, team, kind, at }. kind: 'shot' | 'step' |
// 'plant' | 'defuse' | 'boom' — each with its own radius (BOT.hear*).
const noises = [];
export function reportNoise(x, z, team, now, kind = 'shot') {
  noises.push({ x, z, team, kind, at: now });
  if (noises.length > 40) noises.shift();
}

const HEAR_RADIUS = {
  shot: BOT.hearRadius, step: BOT.hearStep, plant: BOT.hearPlant,
  defuse: BOT.hearDefuse, boom: BOT.hearBoom,
};

// ---- bot bodies (shared geometry + materials, one group per bot) ----
const _bodyGeo = new THREE.BoxGeometry(0.52, 0.72, 0.3);
const _headGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const _legGeo = new THREE.BoxGeometry(0.2, 0.72, 0.24);
const _armGeo = new THREE.BoxGeometry(0.14, 0.6, 0.18);
const _gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.62);
const _helmetGeo = new THREE.BoxGeometry(0.34, 0.12, 0.34);
const _matCache = new Map();

function teamMats(team) {
  if (!_matCache.has(team)) {
    _matCache.set(team, {
      torso: new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], roughness: 0.8 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2b2823, roughness: 0.9 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.9 }),
    });
  }
  return _matCache.get(team);
}

export function buildBotMesh(actor) {
  const mats = teamMats(actor.team);
  const g = new THREE.Group();
  const torso = new THREE.Mesh(_bodyGeo, mats.torso);
  torso.position.y = 1.12;
  const head = new THREE.Mesh(_headGeo, mats.skin);
  head.position.y = 1.66;
  const helmet = new THREE.Mesh(_helmetGeo, mats.torso);
  helmet.position.y = 1.84;
  const legL = new THREE.Mesh(_legGeo, mats.dark);
  legL.position.set(-0.14, 0.4, 0);
  const legR = new THREE.Mesh(_legGeo, mats.dark);
  legR.position.set(0.14, 0.4, 0);
  const armL = new THREE.Mesh(_armGeo, mats.torso);
  armL.position.set(-0.34, 1.15, 0.1);
  armL.rotation.x = -0.9;
  const armR = new THREE.Mesh(_armGeo, mats.torso);
  armR.position.set(0.34, 1.15, 0.1);
  armR.rotation.x = -0.9;
  const gun = new THREE.Mesh(_gunGeo, mats.dark);
  gun.position.set(0.12, 1.28, -0.42);
  g.add(torso, head, helmet, legL, legR, armL, armR, gun);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  g.userData = { torso, helmet, legL, legR, armL, armR, gun, walkPhase: Math.random() * 6 };
  return g;
}

// ---- brains ----
export function makeBrain(role) {
  return {
    role, // 'entry' | 'support' | 'lurk' | 'holdA/B/C' | 'rotate' (+ legacy push*)
    mode: 'move', // 'move' | 'hold' | 'combat' | 'investigate' | 'plant' | 'defuse'
    path: [], pathIdx: 0,
    targetId: -1,
    lastSeen: null, // { x, z, at }
    reactUntil: 0,
    burstLeft: 0, burstPauseUntil: 0,
    investigate: null,
    holdYaw: 0, scanDir: 1,
    holdSpot: null, // pre-aimed hold angle { x, z, ax, az } (HOLD_SPOTS)
    peekAt: 0, peekUntil: 0, peekDir: 1, // peek oscillation timers
    strafeDir: 1, strafeUntil: 0,
    stuckAt: 0, lastX: 0, lastZ: 0,
    thinkAt: 0, // next perception tick (staggered)
    siteFocus: 'A',
    releaseAt: 0, // staggered execute: seconds after live before leaving spawn
    radioAt: -99, // last radio callout (4s throttle per bot)
    listenUntil: 0,
    pushUntil: 0, // after a combat-stuck: keep routing, don't re-engage far foes
    usedSmoke: false, usedFlash: false, // one utility throw per round each
  };
}

export function assignRole(actor, role, siteFocus) {
  actor.ai = makeBrain(role);
  actor.ai.siteFocus = siteFocus;
}

// Waypoint targets per role. The lurk takes the other site to split the
// defence; the rotator floats mid until tactics.rotateTo pulls it to a site.
function roleDestination(ai) {
  const focusWp = SITE_WP[ai.siteFocus] || 23;
  if (ai.role === 'entry' || ai.role === 'support') return focusWp;
  if (ai.role === 'lurk') return ai.siteFocus === 'A' ? 19 : 17;
  if (ai.role === 'rotate') return ai.siteFocus === 'MID' ? 26 : focusWp;
  if (ai.role === 'pushA') return 17; // legacy roles (still valid)
  if (ai.role === 'pushB') return 19;
  if (ai.role === 'pushMid') return 7;
  if (ai.role === 'holdA') return 16;
  if (ai.role === 'holdB') return 18;
  if (ai.role === 'holdC') return 23;
  if (ai.role === 'holdMid') return 26;
  return 7;
}

// A defender's pre-aimed hold angle: one spot per bot (by actor id).
function pickHoldSpot(actor) {
  const site = actor.ai.role === 'holdA' ? 'A' : actor.ai.role === 'holdB' ? 'B'
    : actor.ai.role === 'holdC' ? 'C' : 'MID';
  const spots = HOLD_SPOTS[site] || HOLD_SPOTS.MID;
  return spots[actor.id % spots.length];
}

function planPath(actor, destWp, now) {
  const from = nearestWaypoint(actor.pos.x, actor.pos.z);
  actor.ai.path = findPath(from, destWp, now);
  actor.ai.pathIdx = 0;
}

// Re-plan only when the bot isn't already heading to destWp.
function ensurePath(actor, destWp, now) {
  const p = actor.ai.path;
  if (p.length === 0 || p[p.length - 1] !== destWp) planPath(actor, destWp, now);
}

function visibleEnemy(actor, now) {
  if (now < actor.flashUntil) { actor.ai.targetId = -1; return null; } // flashed: blind
  // Stagger perception: each bot re-scans on its own 0.15s tick.
  if (now < actor.ai.thinkAt) return actor.ai.targetId >= 0 ? state.actors[actor.ai.targetId] : null;
  actor.ai.thinkAt = now + 0.15;
  const eyeY = actor.pos.y + MOVE.eyeStand;
  let best = null, bestD = Infinity;
  for (const other of state.actors) {
    if (other === actor || !other.alive || other.team === actor.team) continue;
    const d = dist2D(actor.pos.x, actor.pos.z, other.pos.x, other.pos.z);
    if (d > BOT.viewDist || d >= bestD) continue;
    const want = yawTo(actor.pos.x, actor.pos.z, other.pos.x, other.pos.z);
    let diff = Math.abs(((want - actor.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (diff > BOT.viewHalfAngle) continue;
    if (!hasLineOfSight(actor.pos.x, eyeY, actor.pos.z, other.pos.x, other.pos.y + 1.3, other.pos.z)) continue;
    if (isSmoked(actor.pos.x, eyeY, actor.pos.z, other.pos.x, other.pos.y + 1.3, other.pos.z, now)) continue;
    best = other; bestD = d;
  }
  if (best) {
    if (actor.ai.targetId !== best.id) {
      actor.ai.reactUntil = now + rand(BOT.reactionMin, BOT.reactionMax);
      actor.ai.burstLeft = randInt(BOT.burstMin, BOT.burstMax);
      radio(actor, `contact, ${locationAt(best.pos.x, best.pos.z)}`, now);
      markDanger(best.pos.x, best.pos.z, 0.6, now); // hot lane: routes bend away
    }
    actor.ai.targetId = best.id;
    actor.ai.lastSeen = { x: best.pos.x, z: best.pos.z, at: now };
  } else if (actor.ai.targetId >= 0) {
    const ls = actor.ai.lastSeen;
    if (!ls || now - ls.at > 2.5) actor.ai.targetId = -1; // lost sight: forget
  }
  return best;
}

// Aim a shot at the target with bot inaccuracy (worse at range / moving).
const _aim = new THREE.Vector3();
function botAimDir(actor, target, out) {
  const d = dist2D(actor.pos.x, actor.pos.z, target.pos.x, target.pos.z);
  const err = BOT.aimError * (1 + d / 35) * (actor.ai.mode === 'move' ? 1.3 : 1);
  const tx = target.pos.x + (Math.random() - 0.5) * err * d * 2;
  const ty = target.pos.y + 1.25 + (Math.random() - 0.5) * err * d * 2 + (Math.random() < 0.12 ? 0.35 : 0);
  const tz = target.pos.z + (Math.random() - 0.5) * err * d * 2;
  const ex = actor.pos.x, ey = actor.pos.y + MOVE.eyeStand, ez = actor.pos.z;
  out.set(tx - ex, ty - ey, tz - ez).normalize();
  return out;
}

function botFire(actor, target, now) {
  if (now < actor.ai.reactUntil) return;
  if (now < actor.ai.burstPauseUntil) return;
  const w = actor.weapons[actor.current];
  if (!w) return;
  updateReload(actor, now);
  if (w.reloading) return;
  if (w.mag <= 0) { startReload(actor, now); return; }
  if (fireBlockReason(actor, now)) return;
  spendRound(actor, now);
  const def = w.def;
  for (let p = 0; p < def.pellets; p++) {
    shootRay(actor, botAimDir(actor, target, _aim), def, now, null);
  }
  sfx.shoot(def.sound, dist2D(actor.pos.x, actor.pos.z, state.actors[0].pos.x, state.actors[0].pos.z));
  reportNoise(actor.pos.x, actor.pos.z, actor.team, now);
  if (--actor.ai.burstLeft <= 0) {
    actor.ai.burstLeft = randInt(BOT.burstMin, BOT.burstMax);
    actor.ai.burstPauseUntil = now + BOT.burstPause * rand(0.7, 1.4);
  }
}

// Move toward a point at bot speed, with collision. Returns true on arrival.
const _bp = new THREE.Vector3();
function botMoveTo(actor, x, z, dt) {
  const dx = x - actor.pos.x, dz = z - actor.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) return true;
  const sp = BOT.moveSpeed;
  actor.vel.x = (dx / d) * sp;
  actor.vel.z = (dz / d) * sp;
  actor.pos.x += actor.vel.x * dt;
  actor.pos.z += actor.vel.z * dt;
  _bp.set(actor.pos.x, actor.pos.y, actor.pos.z);
  resolveCircle(_bp, MOVE.radius, MOVE.height);
  actor.pos.x = _bp.x; actor.pos.z = _bp.z;
  const ground = groundHeightAt(actor.pos.x, actor.pos.z, MOVE.radius, actor.pos.y);
  actor.pos.y = Math.max(actor.pos.y, ground);
  if (actor.ai.mode !== 'combat') actor.yaw = yawTo(actor.pos.x, actor.pos.z, x, z);
  // Stuck detection: no progress in 1.5s.
  const moved = dist2D(actor.pos.x, actor.pos.z, actor.ai.lastX, actor.ai.lastZ);
  if (moved > 0.5) { actor.ai.lastX = actor.pos.x; actor.ai.lastZ = actor.pos.z; actor.ai.stuckAt = state.time; }
  else if (state.time - actor.ai.stuckAt > 1.5) { actor.ai.stuckAt = state.time; return 'stuck'; }
  return false;
}

// Hearing with wall muffling: a sound's range shrinks through walls, and
// what a bot hears through a wall is vague (low certainty — it turns to
// listen instead of running). Returns { heard, certainty }.
function hearNoise(actor, n) {
  const radius = HEAR_RADIUS[n.kind] || BOT.hearRadius;
  const d = dist2D(actor.pos.x, actor.pos.z, n.x, n.z);
  const close = radius * BOT.hearMuffle;
  if (d < close) return { heard: true, certainty: clamp(1 - d / close, 0.4, 1) };
  if (d >= radius) return { heard: false, certainty: 0 };
  // In the muffled band: only heard with a clear ear-line (no wall).
  if (!hasLineOfSight(actor.pos.x, 1.4, actor.pos.z, n.x, 1.4, n.z)) return { heard: false, certainty: 0 };
  return { heard: true, certainty: clamp(1 - d / radius, 0.15, 0.8) * 0.8 };
}

// Callout propagation: a solid contact is shared with nearby teammates.
function shareSound(actor, n, certainty) {
  if (certainty < 0.6) return;
  for (const mate of state.actors) {
    if (mate === actor || !mate.alive || mate.isPlayer || mate.team !== actor.team || !mate.ai) continue;
    if (!['move', 'hold'].includes(mate.ai.mode)) continue;
    if (dist2D(mate.pos.x, mate.pos.z, actor.pos.x, actor.pos.z) > 25) continue;
    mate.ai.investigate = { x: n.x, z: n.z };
    mate.ai.mode = 'investigate';
  }
}

// Nearest site to a point (which site is threatened?).
function siteNear(x, z) {
  let best = 'A', bd = Infinity;
  for (const s of SITES) {
    const d = dist2D(x, z, s.x, s.z);
    if (d < bd) { bd = d; best = s.id; }
  }
  return best;
}

// One fixed step of one bot's brain.
export function stepBot(actor, dt, now) {
  const ai = actor.ai;
  if (!ai || !actor.alive) return;
  updateWeaponFeel(actor, dt); // decay heat/recoil like the player's gun
  const bomb = state.bomb;

  // Bomb duties override everything else — except a staged bot, which
  // holds its screenshot spot no matter what the bomb is doing.
  if (ai.mode !== 'stage') {
  if (bomb.state === 'planted' && actor.team === state.attackerTeam) {
    // Attackers defend the planted bomb: hold near the site.
    const site = SITES.find((s) => s.id === bomb.site);
    if (dist2D(actor.pos.x, actor.pos.z, site.x, site.z) > 9) {
      ai.mode = 'move';
      ensurePath(actor, SITE_WP[bomb.site] || 16, now);
    } else { ai.mode = 'hold'; }
  } else if (bomb.state === 'planted' && actor.team !== state.attackerTeam) {
    // Defenders rush the bomb itself (defusing needs 2.5 m of the bomb).
    const dBomb = dist2D(actor.pos.x, actor.pos.z, bomb.pos.x, bomb.pos.z);
    if (dBomb < 2.2) {
      if (ai.mode !== 'defuse') radio(actor, 'defusing the bomb', now);
      ai.mode = 'defuse';
    } else if (dBomb < 12) {
      ai.mode = 'defuseRun'; // straight-line run to the bomb
    } else {
      ai.mode = 'move';
      ensurePath(actor, nearestWaypoint(bomb.pos.x, bomb.pos.z), now);
    }
  } else if (actor.hasBomb) {
    // Carrier pushes its focus site and plants when clear.
    const site = SITES.find((s) => s.id === ai.siteFocus);
    if (dist2D(actor.pos.x, actor.pos.z, site.x, site.z) < 3) {
      const near = state.actors.some((o) => o.team !== actor.team && o.alive && dist2D(o.pos.x, o.pos.z, site.x, site.z) < 14);
      if (!near) {
        if (ai.mode !== 'plant') radio(actor, `planting at ${ai.siteFocus}`, now);
        ai.mode = 'plant';
      }
    }
  }
  } // end bomb duties (skipped for staged bots)

  // Perception: a visible enemy IN RANGE means combat. A far foe is not
  // worth chasing across the map — the routed push closes the distance
  // faster than a direct walk into the wall beside a doorway.
  const enemy = visibleEnemy(actor, now);
  const eD = enemy ? dist2D(actor.pos.x, actor.pos.z, enemy.pos.x, enemy.pos.z) : 1e9;
  const near = eD <= 25;
  const pushing = enemy && now < ai.pushUntil && eD > 18;
  if (near && !pushing && ai.mode !== 'plant' && ai.mode !== 'defuse' && ai.mode !== 'stage') ai.mode = 'combat';
  else if (!enemy && ai.mode === 'combat') {
    ai.mode = ai.lastSeen && now - ai.lastSeen.at < 2.5 ? 'investigate' : (ai.role.startsWith('hold') ? 'hold' : 'move');
  } else if (enemy && ai.mode === 'combat') {
    ai.mode = ai.role.startsWith('hold') ? 'hold' : 'move'; // far foe: resume the push
  }

  // Hearing: investigate fresh enemy sounds. Each kind has its own radius
  // (a plant rings across the map, a footstep is local); walls MUFFLE sound
  // and certainty decides the response — a vague sound earns a look, a
  // solid one a run. A plant heard by a defender rotates the team.
  if (!enemy && ai.mode !== 'plant' && ai.mode !== 'defuse' && ai.mode !== 'stage') {
    for (let i = noises.length - 1; i >= 0; i--) {
      const n = noises[i];
      if (now - n.at > 4 || n.team === actor.team) continue;
      const { heard, certainty } = hearNoise(actor, n);
      if (!heard || certainty < 0.35) continue;
      ai.investigate = { x: n.x, z: n.z };
      ai.mode = 'investigate';
      shareSound(actor, n, certainty);
      if (n.kind === 'plant' && actor.team !== state.attackerTeam) {
        radio(actor, 'bomb going down — rotating', now);
        rotateTo(siteNear(n.x, n.z), now);
      }
      break;
    }
  }

  // Utility: smoke the site approach once per round when pushing in, flash
  // a close fight once per round.
  if (ai.mode === 'move' && !ai.usedSmoke && actor.smokes > 0) {
    const site = SITES.find((s) => s.id === ai.siteFocus);
    if (site && dist2D(actor.pos.x, actor.pos.z, site.x, site.z) < 14) {
      ai.usedSmoke = true;
      _aim.set(site.x - actor.pos.x, 2.5, site.z - actor.pos.z).normalize();
      throwGrenade(actor, _aim, 'smoke');
    }
  }
  if (enemy && !ai.usedFlash && actor.flashes > 0
    && dist2D(actor.pos.x, actor.pos.z, enemy.pos.x, enemy.pos.z) < 14) {
    ai.usedFlash = true;
    _aim.set(enemy.pos.x - actor.pos.x, 1.5, enemy.pos.z - actor.pos.z).normalize();
    throwGrenade(actor, _aim, 'flash');
  }

  switch (ai.mode) {
    case 'combat': {
      const t = state.actors[ai.targetId] || enemy;
      if (t) {
        actor.yaw = yawTo(actor.pos.x, actor.pos.z, t.pos.x, t.pos.z);
        const d = dist2D(actor.pos.x, actor.pos.z, t.pos.x, t.pos.z);
        if (d > 18) {
          // Too far to hit reliably: close the distance.
          const r = botMoveTo(actor, t.pos.x, t.pos.z, dt);
          if (r === 'stuck') {
            // A wall blocks the direct line: route around it on the graph,
            // and keep pushing for a few seconds instead of re-engaging.
            ai.mode = 'move';
            ai.pushUntil = now + 4;
            planPath(actor, nearestWaypoint(t.pos.x, t.pos.z), now);
          }
        } else {
          if (now > ai.strafeUntil) {
            ai.strafeDir = Math.random() < 0.5 ? -1 : 1;
            ai.strafeUntil = now + BOT.strafeTime * rand(0.7, 1.3);
          }
          const sx = Math.cos(actor.yaw) * ai.strafeDir;
          const sz = -Math.sin(actor.yaw) * ai.strafeDir;
          const nx = actor.pos.x + sx * BOT.moveSpeed * 0.55 * dt;
          const nz = actor.pos.z + sz * BOT.moveSpeed * 0.55 * dt;
          _bp.set(nx, actor.pos.y, nz);
          if (!resolveCircle(_bp, MOVE.radius, MOVE.height)) { actor.pos.x = nx; actor.pos.z = nz; }
        }
        botFire(actor, t, now);
      }
      break;
    }
    case 'investigate': {
      const goal = ai.investigate || ai.lastSeen;
      if (!goal) { ai.mode = 'move'; break; }
      const arrived = botMoveTo(actor, goal.x, goal.z, dt);
      if (arrived === true || arrived === 'stuck') {
        ai.investigate = null;
        // Listen: stand still and scan for 1.6s before giving up the spot.
        ai.mode = 'listen';
        ai.listenUntil = now + 1.6;
      }
      break;
    }
    case 'listen': {
      ai.holdYaw += ai.scanDir * dt * 0.7;
      if (ai.holdYaw > 0.9) ai.scanDir = -1;
      if (ai.holdYaw < -0.9) ai.scanDir = 1;
      actor.yaw += ai.scanDir * dt * 0.7;
      if (now > ai.listenUntil) {
        ai.mode = ai.role.startsWith('hold') ? 'hold' : 'move';
        planPath(actor, roleDestination(ai), now);
      }
      break;
    }
    case 'hold': {
      // Hold a pre-aimed angle: walk to the spot, lock the aim point, and
      // PEEK the lane — strafe out, hold a beat, slip back. A holder that
      // never peeks never sees the push coming.
      if (!ai.holdSpot) ai.holdSpot = pickHoldSpot(actor);
      const s = ai.holdSpot;
      if (dist2D(actor.pos.x, actor.pos.z, s.x, s.z) > 2.5) { botMoveTo(actor, s.x, s.z, dt); break; }
      actor.yaw = yawTo(actor.pos.x, actor.pos.z, s.ax, s.az);
      if (now < ai.peekUntil) {
        // Mid-peek: strafe along the axis perpendicular to the aim.
        const px = Math.cos(actor.yaw) * ai.peekDir;
        const pz = -Math.sin(actor.yaw) * ai.peekDir;
        _bp.set(actor.pos.x + px * BOT.moveSpeed * 0.5 * dt, actor.pos.y, actor.pos.z + pz * BOT.moveSpeed * 0.5 * dt);
        if (!resolveCircle(_bp, MOVE.radius, MOVE.height)) { actor.pos.x = _bp.x; actor.pos.z = _bp.z; }
      } else if (now >= ai.peekAt) {
        // Start a peek; the next one comes after a gap.
        ai.peekUntil = now + BOT.peekOut;
        ai.peekAt = now + BOT.peekOut + BOT.peekGap * rand(0.7, 1.4);
        ai.peekDir = Math.random() < 0.5 ? -1 : 1;
      } else {
        botMoveTo(actor, s.x, s.z, dt); // between peeks: drift back to the spot
      }
      break;
    }
    case 'plant':
    case 'defuse': {
      // Standing still while the progress bar runs (rounds.js drives it).
      actor.vel.x = 0; actor.vel.z = 0;
      break;
    }
    case 'stage': {
      // Staged for a screenshot (shots.js): hold this spot, aim and fire.
      actor.vel.x = 0; actor.vel.z = 0;
      const t = state.actors[ai.targetId] || enemy;
      if (t) {
        actor.yaw = yawTo(actor.pos.x, actor.pos.z, t.pos.x, t.pos.z);
        botFire(actor, t, now);
      } else {
        actor.yaw += ai.scanDir * dt * 0.3;
      }
      break;
    }
    case 'defuseRun': {
      // Straight-line run to the planted bomb; fall back to the graph if stuck.
      const r = botMoveTo(actor, bomb.pos.x, bomb.pos.z, dt);
      if (r === 'stuck') {
        ai.mode = 'move';
        planPath(actor, nearestWaypoint(bomb.pos.x, bomb.pos.z), now);
      }
      break;
    }
    default: { // 'move'
      // Staggered execute: support/lurk wait at spawn for their release.
      // Perception still runs (combat above can pull them out early).
      if (state.liveElapsed < ai.releaseAt) break;
      if (ai.path.length === 0) planPath(actor, roleDestination(ai), now);
      // Skip waypoints combat carried the bot past — never walk backwards.
      while (ai.pathIdx + 1 < ai.path.length) {
        const c = WAYPOINTS[ai.path[ai.pathIdx]], n = WAYPOINTS[ai.path[ai.pathIdx + 1]];
        if (dist2D(actor.pos.x, actor.pos.z, n.x, n.z) < dist2D(actor.pos.x, actor.pos.z, c.x, c.z)) ai.pathIdx++;
        else break;
      }
      const wp = WAYPOINTS[ai.path[Math.min(ai.pathIdx, ai.path.length - 1)]];
      const r = botMoveTo(actor, wp.x, wp.z, dt);
      if (r === true) {
        ai.pathIdx++;
        if (ai.pathIdx >= ai.path.length) {
          ai.mode = ai.role.startsWith('hold') ? 'hold' : 'move';
          if (ai.role.startsWith('hold')) { ai.holdYaw = 0; }
          else { planPath(actor, roleDestination(ai), now); }
        }
      } else if (r === 'stuck') {
        ai.pathIdx++;
        if (ai.pathIdx >= ai.path.length) planPath(actor, roleDestination(ai), now);
      }
      break;
    }
  }

  // Keep bots inside the map.
  actor.pos.x = clamp(actor.pos.x, -31, 31);
  actor.pos.z = clamp(actor.pos.z, -21, 21);
}

// Per-render bot visuals: position the group, swing legs, death pose.
export function updateBotMesh(actor, dt) {
  const g = actor.mesh;
  if (!g) return;
  if (!actor.alive) {
    if (g.rotation.x > -Math.PI / 2 + 0.05) {
      g.rotation.x = Math.max(-Math.PI / 2, g.rotation.x - dt * 6);
      g.position.y = Math.max(0.25, g.position.y - dt * 1.2);
    }
    return;
  }
  g.position.set(actor.pos.x, actor.pos.y, actor.pos.z);
  g.rotation.y = actor.yaw;
  const moving = Math.hypot(actor.vel.x, actor.vel.z) > 0.5;
  const u = g.userData;
  if (moving) {
    u.walkPhase += dt * 9;
    const s = Math.sin(u.walkPhase) * 0.55;
    u.legL.rotation.x = s;
    u.legR.rotation.x = -s;
  } else {
    u.legL.rotation.x *= 0.8;
    u.legR.rotation.x *= 0.8;
  }
}

// Bot loadout by round: bots SHOP with their own money, like the player.
// Team average under $1,500 means an eco round (pistols only); otherwise
// rifles/SMGs by preference, kevlar when affordable, utility from round 3,
// defuse kits for defenders. Bots earn the same kill/win/loss money as the
// player (rounds.js), so their shopping is real economy, not a script.
export function botLoadout(actor, round) {
  actor.weapons = [makeWeapon('pistol'), makeWeapon('knife')];
  actor.current = 0;
  actor.grenades = 0; actor.smokes = 0; actor.flashes = 0;
  actor.hasKit = false;
  const mates = state.actors.filter((a) => a.team === actor.team);
  const teamMoney = mates.reduce((s, a) => s + a.money, 0) / mates.length;
  const buy = (price) => { if (actor.money >= price) { actor.money -= price; return true; } return false; };
  if (round >= 2 && teamMoney >= 1500) {
    const primary = round >= 3 && actor.id % 4 === 0 ? 'sniper'
      : actor.id % 3 === 0 ? 'smg' : 'rifle';
    const prices = { rifle: 2700, smg: 1200, sniper: 4750 };
    if (buy(prices[primary])) {
      actor.weapons.unshift(makeWeapon(primary));
      actor.current = 0;
    }
    if (actor.money > 1000) { if (buy(650)) actor.armor = 100; }
  }
  if (round >= 2 && teamMoney >= 1500 && actor.team !== state.attackerTeam && actor.id % 2 === 0) {
    if (buy(400)) actor.hasKit = true;
  }
  if (round >= 3) {
    if (actor.id % 3 === 0 && buy(300)) actor.grenades = 1;
    if (actor.id % 3 === 1 && buy(300)) actor.smokes = 1;
    if (actor.id % 3 === 2 && buy(250)) actor.flashes = 1;
  }
}
