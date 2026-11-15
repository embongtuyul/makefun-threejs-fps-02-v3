// SANDLINE — combat.js: resolving shots and damage.
// A shot is a ray from the shooter's eye. The ray is tested against the map
// boxes first, then against every living enemy's capsule (head sphere +
// body cylinder). The nearest hit wins. Damage falls off with range, the
// head multiplies it, legs reduce it, armor absorbs half. Deaths are reported
// to rounds.js through onKill, and the killfeed is fed from here.

import { ARMOR_ABSORB, MOVE } from './config.js';
import { rayCapsule, raycastBoxes } from './collision.js';
import { bloodPuff, impactSparks, tracer } from './effects.js';
import { state } from './state.js';
import { V1 } from './utils.js';

export const PART_MULT = { head: 4, body: 1, legs: 0.75 };

// Distance falloff: full damage inside falloffStart, linear down to 55%
// at falloffEnd, then flat.
export function falloff(def, dist) {
  if (dist <= def.falloffStart) return 1;
  const t = Math.min(1, (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart));
  return 1 - 0.45 * t;
}

export function eyePos(actor, out) {
  out.set(actor.pos.x, actor.pos.y + (actor.crouching ? 1.12 : MOVE.eyeStand), actor.pos.z);
  return out;
}

// Fire one pellet along a direction. Returns the hit record or null.
// onHit(victim, part, damage, headshot) is called for actor hits.
export function shootRay(shooter, dir, def, now, onHit) {
  const ox = shooter.pos.x;
  const oy = shooter.pos.y + (shooter.crouching ? 1.12 : MOVE.eyeStand);
  const oz = shooter.pos.z;
  const maxDist = def.range;

  // Nearest wall hit (the ray never passes through the map).
  const wall = raycastBoxes(ox, oy, oz, dir.x, dir.y, dir.z, maxDist, V1);
  const wallDist = wall ? wall.dist : Infinity;

  // Nearest enemy capsule hit.
  let bestVictim = null, bestPart = null, bestDist = Infinity;
  for (const a of state.actors) {
    if (a === shooter || !a.alive || a.team === shooter.team) continue;
    const hit = rayCapsule(ox, oy, oz, dir.x, dir.y, dir.z, Math.min(maxDist, wallDist), a.pos.x, a.pos.z, a.pos.y, MOVE.height);
    if (hit && hit.dist < bestDist) {
      bestDist = hit.dist; bestVictim = a; bestPart = hit.part;
    }
  }

  // Tracer end point: the wall, the victim, or the range limit.
  const endDist = bestVictim ? bestDist : (wall ? wallDist : maxDist);
  const ex = ox + dir.x * endDist, ey = oy + dir.y * endDist, ez = oz + dir.z * endDist;
  tracer({ x: ox, y: oy, z: oz }, { x: ex, y: ey, z: ez }, now);

  if (bestVictim) {
    const mult = PART_MULT[bestPart] || 1;
    const dmg = def.damage * mult * falloff(def, bestDist);
    bloodPuff({ x: ex, y: ey, z: ez });
    damageActor(bestVictim, dmg, shooter, bestPart === 'head');
    if (onHit) onHit(bestVictim, bestPart, dmg, bestPart === 'head');
    return { victim: bestVictim, part: bestPart, damage: dmg, dist: bestDist };
  }
  if (wall) impactSparks({ x: ex, y: ey, z: ez }, null);
  return null;
}

// Apply damage with armor absorption. Returns true when the victim died.
// Damage is credited to the attacker's scoreboard (dmgDealt), and the
// previous damager is kept as assistId: if a teammate of the killer hurt
// this victim within the last 8 seconds, they earn an assist on the kill.
export function damageActor(victim, amount, attacker, headshot) {
  if (!victim.alive) return false;
  let dmg = amount;
  if (victim.armor > 0) {
    const absorbed = dmg * ARMOR_ABSORB;
    const toArmor = Math.min(victim.armor, absorbed);
    victim.armor -= toArmor;
    dmg -= toArmor;
  }
  if (attacker && attacker !== victim) {
    attacker.dmgDealt += Math.min(dmg, victim.health);
    if (victim.lastDamageFrom >= 0 && victim.lastDamageFrom !== attacker.id
      && state.time - victim.lastDamageAt < 8) {
      victim.assistId = victim.lastDamageFrom;
    }
  }
  victim.health -= dmg;
  victim.lastDamageFrom = attacker ? attacker.id : -1;
  victim.lastDamageAt = state.time;
  if (victim.health <= 0) {
    victim.health = 0;
    victim.alive = false;
    victim.deaths += 1;
    if (attacker && attacker !== victim) attacker.kills += 1;
    if (state.onKill) state.onKill(victim, attacker, headshot);
    return true;
  }
  return false;
}
