// SANDLINE — grenades.js: thrown frag, smoke and flash grenades.
// A grenade is a small physics body: gravity, bounces, then it cooks off.
//   - frag: damages every enemy in radius, linear falloff, no friendly fire
//   - smoke: a 14s cloud bots cannot see through (real geometry — it hides
//     the player too; isSmoked() is checked in bot vision)
//   - flash: blinds actors in radius who face the burst (up to 2.8s);
//     blinded bots stop shooting and the player's screen whites out

import * as THREE from 'three';
import { GRENADES } from './config.js';
import { raycastBoxes } from './collision.js';
import { damageActor } from './combat.js';
import { explosionBurst } from './effects.js';
import { state } from './state.js';
import { sfx } from './audio.js';

const _geo = new THREE.SphereGeometry(0.11, 10, 8);
const _mat = new THREE.MeshStandardMaterial({ color: 0x2e4a2e, roughness: 0.6, metalness: 0.5 });
const _smokeMat = new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 1, transparent: true, opacity: 0.82 });
const _smokeGeo = new THREE.SphereGeometry(1, 10, 8);

let sceneRef = null;

export function initGrenades(scene) {
  sceneRef = scene;
}

function countField(type) { // which actor field counts this grenade type
  return type === 'smoke' ? 'smokes' : type === 'flash' ? 'flashes' : 'grenades';
}

export function throwGrenade(actor, dir, type = 'frag') {
  const def = GRENADES[type] || GRENADES.frag;
  const field = countField(type);
  if (actor[field] <= 0) return false;
  actor[field] -= 1;
  const mesh = new THREE.Mesh(_geo, _mat);
  mesh.castShadow = true;
  mesh.position.set(actor.pos.x, actor.pos.y + 1.5, actor.pos.z);
  sceneRef.add(mesh);
  state.grenades.push({
    mesh, type: def.id,
    pos: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
    vel: {
      x: dir.x * def.throwSpeed + actor.vel.x * 0.5,
      y: dir.y * def.throwSpeed + 3.5,
      z: dir.z * def.throwSpeed + actor.vel.z * 0.5,
    },
    fuse: def.fuse,
    team: actor.team,
    thrower: actor,
    bounced: 0,
  });
  sfx.grenadePin();
  return true;
}

const _hit = new THREE.Vector3();

export function stepGrenades(dt, now) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    if (g.fuse <= 0) { explode(g, now); state.grenades.splice(i, 1); continue; }
    const stepLen = Math.hypot(g.vel.x, g.vel.y, g.vel.z) * dt; // short raycast step: no tunnelling
    const nx = g.pos.x + g.vel.x * dt;
    const ny = g.pos.y + g.vel.y * dt;
    const nz = g.pos.z + g.vel.z * dt;
    if (stepLen > 0.01) {
      const hit = raycastBoxes(g.pos.x, g.pos.y, g.pos.z,
        (nx - g.pos.x) / stepLen, (ny - g.pos.y) / stepLen, (nz - g.pos.z) / stepLen,
        stepLen, _hit);
      if (hit) {
        const dx = Math.abs(_hit.x - g.pos.x), dy = Math.abs(_hit.y - g.pos.y), dz = Math.abs(_hit.z - g.pos.z); // bounce: reverse dominant component
        if (dy >= dx && dy >= dz) { g.vel.y = Math.abs(g.vel.y) * 0.45; }
        else if (dx >= dz) { g.vel.x *= -0.45; }
        else { g.vel.z *= -0.45; }
        g.vel.x *= 0.8; g.vel.z *= 0.8;
        g.pos.x = _hit.x; g.pos.y = _hit.y + 0.05; g.pos.z = _hit.z;
        g.bounced++;
        sfx.bounce();
      } else {
        g.pos.x = nx; g.pos.y = ny; g.pos.z = nz;
      }
    }
    g.vel.y -= 12.5 * dt;
    if (g.pos.y < 0.11) { g.pos.y = 0.11; g.vel.y = Math.abs(g.vel.y) * 0.4; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    g.mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
    g.mesh.rotation.x += dt * 9;
    g.mesh.rotation.z += dt * 5;
  }
}

function explode(g, now) {
  if (g.type === 'smoke') { deploySmoke(g, now); sceneRef.remove(g.mesh); return; }
  if (g.type === 'flash') { detonateFlash(g, now); sceneRef.remove(g.mesh); return; }
  explodeFrag(g, now);
}

function explodeFrag(g, now) {
  const def = GRENADES.frag;
  explosionBurst(g.pos);
  const p = state.actors[0];
  const distP = Math.hypot(g.pos.x - p.pos.x, g.pos.z - p.pos.z);
  sfx.explosion(distP);
  if (distP < def.radius * 1.6) state.shake = Math.max(state.shake, 1 - distP / (def.radius * 1.6));
  for (const a of state.actors) {
    if (!a.alive || a.team === g.team) continue;
    const d = Math.hypot(g.pos.x - a.pos.x, g.pos.y - (a.pos.y + 1), g.pos.z - a.pos.z);
    if (d > def.radius) continue;
    const dmg = def.maxDamage * (1 - d / def.radius);
    damageActor(a, Math.max(8, dmg), g.thrower, false);
  }
  sceneRef.remove(g.mesh);
}

// Smoke: a cluster of translucent spheres, lingering for `duration`, that
// blocks bot vision (isSmoked) and occludes the player's view too.
export function deploySmoke(g, now) {
  const def = GRENADES.smoke;
  const group = new THREE.Group();
  const offs = [[0, 1.1, 0], [1.6, 0.8, 0.6], [-1.5, 0.9, -0.5], [0.5, 1.6, -1.2], [-0.6, 0.7, 1.4], [1.2, 1.8, 1.0], [-1.1, 1.9, 0.9]];
  for (const [ox, oy, oz] of offs) {
    const m = new THREE.Mesh(_smokeGeo, _smokeMat);
    m.position.set(g.pos.x + ox, g.pos.y + oy, g.pos.z + oz);
    m.scale.setScalar(1.1 + Math.random() * 0.7);
    group.add(m);
  }
  sceneRef.add(group);
  state.smokes.push({ x: g.pos.x, z: g.pos.z, r: def.radius, until: now + def.duration, group });
  sfx.smoke();
}

// Flash: everyone in radius who can see the burst (facing it, line of
// sight) is blinded; closer + more head-on = longer blindness.
function detonateFlash(g, now) {
  const def = GRENADES.flash;
  sfx.flash();
  for (const a of state.actors) {
    if (!a.alive) continue;
    const d = Math.hypot(g.pos.x - a.pos.x, g.pos.z - a.pos.z);
    if (d > def.radius) continue;
    const dx = g.pos.x - a.pos.x, dz = g.pos.z - a.pos.z; // facing factor: 1 head-on, ~0.25 behind
    const dl = Math.hypot(dx, dz) || 1;
    const facing = (-Math.sin(a.yaw) * dx + -Math.cos(a.yaw) * dz) / dl;
    const blind = def.duration * (1 - d / def.radius) * (0.25 + 0.75 * Math.max(0, facing));
    if (blind > 0.25) a.flashUntil = Math.max(a.flashUntil, now + blind);
  }
}

// Does the segment pass through a live smoke cloud? Segment-sphere test,
// one sphere per cloud. Bots call this before trusting line of sight.
export function isSmoked(ax, ay, az, bx, by, bz, now) {
  for (const s of state.smokes) {
    if (now > s.until) continue;
    const cx = s.x, cy = 1.2, cz = s.z;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
    if (px * px + py * py + pz * pz < s.r * s.r) return true;
  }
  return false;
}

export function stepSmokes(now) {
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    if (now <= state.smokes[i].until) continue;
    sceneRef.remove(state.smokes[i].group);
    state.smokes.splice(i, 1);
  }
}

export function clearGrenades() {
  for (const g of state.grenades) sceneRef.remove(g.mesh);
  state.grenades.length = 0;
  for (const s of state.smokes) sceneRef.remove(s.group);
  state.smokes.length = 0;
}
