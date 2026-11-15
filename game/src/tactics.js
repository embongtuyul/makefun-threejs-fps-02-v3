// SANDLINE — tactics.js: round plans and team play.
// Each round the attackers get a PLAN: a focus site (rotating A/B/C),
// roles — ENTRY goes first through the main lane, SUPPORT follows 2s later,
// the LURK slips the other way 6s in to catch rotators — and a STAGGERED
// execute so the team arrives as a wave, not a trickle. Defenders hold a
// site each plus a ROTATOR who floats mid and swings to the first real
// contact. When a teammate dies, the nearest mate TRADES: they push the
// killer's last-seen spot instead of scattering.

import { BOT } from './config.js';
import { SITES } from './map.js';
import { markDanger } from './nav.js';
import { state } from './state.js';
import { dist2D } from './utils.js';

let lastFocus = 'C';

// The round plan: focus site + a role per bot slot. The focus rotates so
// no two rounds in a row hit the same site.
export function makePlan(round) {
  const ids = SITES.map((s) => s.id);
  let focus = ids[(round - 1) % ids.length];
  if (focus === lastFocus) focus = ids[round % ids.length];
  lastFocus = focus;
  return {
    focus,
    atk: ['entry', 'support', 'lurk', 'support'],
    def: ['holdA', 'holdB', 'holdC', 'rotate'],
  };
}

// Seconds after the round goes live before this role may leave spawn.
export function releaseDelay(role) {
  return role === 'support' ? 2 : role === 'lurk' ? 6 : 0;
}

// A teammate just died: mark the spot dangerous (routes bend around it)
// and send the nearest living mate to TRADE the kill.
export function onDeath(victim, killer, now) {
  markDanger(victim.pos.x, victim.pos.z, 1.5, now);
  const kx = killer ? killer.pos.x : victim.pos.x;
  const kz = killer ? killer.pos.z : victim.pos.z;
  let best = null, bd = BOT.tradeRange;
  for (const a of state.actors) {
    if (a === victim || !a.alive || a.isPlayer || a.team !== victim.team) continue;
    const d = dist2D(a.pos.x, a.pos.z, victim.pos.x, victim.pos.z);
    if (d < bd) { bd = d; best = a; }
  }
  if (!best || !best.ai) return;
  best.ai.investigate = { x: kx, z: kz };
  if (!['combat', 'plant', 'defuse', 'stage'].includes(best.ai.mode)) best.ai.mode = 'investigate';
  state.radio.push({ text: `${best.name}: trading ${victim.name}`, at: now, team: victim.team });
  if (state.radio.length > 12) state.radio.shift();
}

// Rotate the team's ROTATOR to a threatened site (called when a plant or a
// solid contact is heard there).
export function rotateTo(site, now) {
  let rotator = null;
  for (const a of state.actors) {
    if (!a.ai || !a.alive || a.ai.role !== 'rotate') continue;
    if (['combat', 'plant', 'defuse', 'stage'].includes(a.ai.mode)) continue;
    a.ai.siteFocus = site;
    a.ai.path = [];
    a.ai.mode = 'move';
    rotator = a;
  }
  if (rotator) {
    state.radio.push({ text: `${rotator.name}: rotating to ${site}`, at: now, team: rotator.team });
    if (state.radio.length > 12) state.radio.shift();
  }
}
