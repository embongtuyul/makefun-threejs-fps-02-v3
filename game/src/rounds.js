// SANDLINE — rounds.js: the match director.
// Owns the round state machine (freeze -> live -> over -> next), the bomb
// (plant / fuse / defuse / explode), the economy and every win condition.
// Kill handling plugs in through state.onKill (combat.js calls it).

import {
  ARMOR_PRICE, BOMB_FUSE, DEFUSE_KIT_TIME, DEFUSE_TIME, ECON, FREEZE_TIME,
  GRENADES, INTERMISSION, KIT_PRICE, PLAYERS_PER_TEAM, PLANT_TIME, ROUND_TIME,
  ROUNDS_TO_WIN, SWAP_AFTER_ROUND, TEAM, TEAM_NAME, WEAPONS,
} from './config.js';
import { SITES, SPAWNS } from './map.js';
import { aliveCount, attackingTeam, defendingTeam, makeActor, player, resetMatchState, resetRoundState, state } from './state.js';
import { dist2D, pick } from './utils.js';
import { assignRole, BOT_NAMES, botLoadout, buildBotMesh, radio, reportNoise } from './bots.js';
import { makePlan, onDeath, releaseDelay } from './tactics.js';
import { makeWeapon } from './weapons.js';
import { explosionBurst } from './effects.js';
import { clearGrenades } from './grenades.js';
import { sfx } from './audio.js';

let sceneRef = null;
let onEvent = null; // (type, data) => void — HUD hooks (banner, killfeed, buy)

export function initRounds(scene, eventHandler) {
  sceneRef = scene;
  onEvent = eventHandler;
  state.onKill = handleKill;
}

function emit(type, data) { if (onEvent) onEvent(type, data); }

// ---- match setup ----
export function startMatch() {
  for (const a of state.actors) if (a.mesh) sceneRef.remove(a.mesh); // remove old bot meshes
  resetMatchState();

  const names = [...BOT_NAMES];
  const shuffled = names.sort(() => Math.random() - 0.5);
  state.actors.push(makeActor(0, TEAM.JACKALS, true, 'YOU')); // player is always a Jackal
  let bi = 0;
  for (let t = 0; t < 2; t++) {
    const count = t === TEAM.JACKALS ? PLAYERS_PER_TEAM - 1 : PLAYERS_PER_TEAM;
    for (let i = 0; i < count; i++) {
      const actor = makeActor(state.actors.length, t, false, shuffled[bi++]);
      actor.mesh = buildBotMesh(actor);
      sceneRef.add(actor.mesh);
      state.actors.push(actor);
    }
  }
  startRound();
}

function spawnActor(actor, idx) {
  // Spawn lists are per-SIDE, not per-team: after the swap the Jackals
  // defend from the east spawn. Attackers always start west.
  const list = actor.team === attackingTeam() ? SPAWNS.attackers : SPAWNS.defenders;
  const s = list[idx % list.length];
  actor.pos.x = s.x; actor.pos.y = 0; actor.pos.z = s.z;
  actor.yaw = actor.team === attackingTeam() ? -Math.PI / 2 : Math.PI / 2;
  actor.pitch = 0;
  if (actor.mesh) {
    actor.mesh.position.set(s.x, 0, s.z);
    actor.mesh.rotation.set(0, actor.yaw, 0);
  }
}

function assignRolesAndLoadouts() {
  const attackers = state.actors.filter((a) => a.team === attackingTeam());
  const defenders = state.actors.filter((a) => a.team === defendingTeam());
  // The round plan (tactics.js): a rotating focus site, entry/support/lurk
  // on attack with staggered releases, one holder per site + a rotator on
  // defence. The player gets no role — they play their own game.
  const plan = makePlan(state.round);
  attackers.forEach((a, i) => {
    if (a.isPlayer) return;
    const role = plan.atk[i % plan.atk.length];
    assignRole(a, role, plan.focus);
    a.ai.releaseAt = releaseDelay(role);
    botLoadout(a, state.round); // bots shop; the player buys by hand
  });
  defenders.forEach((a, i) => {
    if (a.isPlayer) return;
    const role = plan.def[i % plan.def.length];
    assignRole(a, role, role === 'rotate' ? 'MID' : plan.focus);
    botLoadout(a, state.round);
  });
  // The player keeps bought weapons between rounds (CS-style); bots re-buy.
  const p = player();
  if (state.round === 1) {
    p.weapons = [makeWeapon('pistol'), makeWeapon('knife')];
    p.current = 0;
    p.grenades = 0; p.smokes = 0; p.flashes = 0;
    p.armor = 0; p.hasKit = false;
  }
}

export function startRound() {
  clearGrenades(); // remove live grenade meshes BEFORE reset wipes the list
  resetRoundState();
  state.phase = 'freeze';
  state.freezeLeft = FREEZE_TIME;
  state.roundTimeLeft = ROUND_TIME;
  if (state.round > 1 && state.round === SWAP_AFTER_ROUND + 1) {
    // Half time: only the SIDE flips. Teams keep their colours and their
    // players — the Jackals (you) attack rounds 1-4 and defend 5-9, so the
    // player gets to plant AND defuse across the match.
    state.attackerTeam = 1 - state.attackerTeam;
    emit('banner', { text: 'SIDES SWAPPED', sub: `${TEAM_NAME[state.attackerTeam]} now attack`, kind: 'info' });
  }
  const perSide = { [TEAM.JACKALS]: 0, [TEAM.FALCONS]: 0 }; // respawn + roles
  for (const a of state.actors) {
    const idx = a.team === attackingTeam() ? perSide[attackingTeam()]++ : perSide[defendingTeam()]++;
    spawnActor(a, idx);
    a.alive = true;
    a.health = 100;
  }
  assignRolesAndLoadouts();
  const attackers = state.actors.filter((a) => a.team === attackingTeam());
  const carrier = state.round === 1 ? player() : pick(attackers); // carrier: player on round 1
  carrier.hasBomb = true;
  state.bomb.carrierId = carrier.id;
  state.bomb.state = 'carried';
  emit('roundStart', { round: state.round });
}

// ---- economy ----
function awardMoney(team, amount) {
  for (const a of state.actors) if (a.team === team) a.money += amount;
}

function endRound(winner, reason) {
  if (state.phase === 'over' || state.phase === 'matchEnd') return;
  state.phase = 'over';
  state.roundWinner = winner;
  state.roundReason = reason;
  state.intermissionLeft = INTERMISSION;
  state.roundsWon[winner]++;
  const loser = 1 - winner;
  awardMoney(winner, ECON.win);
  state.lossStreak[loser]++;
  const lossPay = Math.min(ECON.lossBonusMax, ECON.loss + ECON.lossBonusStep * (state.lossStreak[loser] - 1));
  awardMoney(loser, lossPay);
  state.lossStreak[winner] = 0;
  const p = player();
  const playerWon = winner === p.team;
  emit('banner', {
    text: playerWon ? 'ROUND WON' : 'ROUND LOST',
    sub: reason,
    kind: playerWon ? 'win' : 'lose',
  });
  if (playerWon) sfx.roundWin(); else sfx.roundLose();
  if (state.roundsWon[winner] >= ROUNDS_TO_WIN) {
    state.matchWinner = winner;
  }
}

// ---- kills ----
function handleKill(victim, attacker, headshot) {
  onDeath(victim, attacker, state.time); // trade: nearest mate pushes the killer
  const atkName = attacker ? attacker.name : 'WORLD';
  const weapon = attacker && attacker.weapons[attacker.current]
    ? attacker.weapons[attacker.current].def.name : 'GRENADE';
  state.killfeed.push({
    html: `<b style="color:${attacker && attacker.team === TEAM.JACKALS ? '#ffb648' : '#6fc3ff'}">${atkName}</b> <span class="w">[${weapon}]</span> <b style="color:${victim.team === TEAM.JACKALS ? '#ffb648' : '#6fc3ff'}">${victim.name}</b>${headshot ? ' <span class="hs">HEADSHOT</span>' : ''}`,
    at: state.time,
  });
  if (attacker && attacker !== victim) attacker.money += ECON.kill;
  if (attacker && attacker.isPlayer) { state.stats.kills++; if (headshot) state.stats.headshots++; }
  if (victim.assistId >= 0 && attacker) { // assist: the teammate who hurt the victim just before the kill
    const helper = state.actors[victim.assistId];
    if (helper && helper !== attacker && helper.team === attacker.team && helper.alive) {
      helper.assists += 1;
    }
  }
  victim.assistId = -1;
  if (victim.isPlayer) {
    state.stats.deaths++;
    const mates = state.actors.filter((a) => a.team === victim.team && a.alive && !a.isPlayer);
    state.spectateId = mates.length ? mates[0].id : -1;
  }
  if (victim.hasBomb && state.bomb.state === 'carried') { // carrier's death drops the bomb
    victim.hasBomb = false;
    state.bomb.state = 'dropped';
    state.bomb.pos = { x: victim.pos.x, y: 0.2, z: victim.pos.z };
    emit('bombDrop', { x: victim.pos.x, z: victim.pos.z });
  }
  if (victim.mesh) victim.mesh.rotation.x = 0; // death pose animates in bots.js
}

// ---- bomb ----
function siteAt(x, z) {
  for (const s of SITES) if (dist2D(x, z, s.x, s.z) <= s.r) return s;
  return null;
}

function updateBomb(dt, now, playerHoldingE) {
  const bomb = state.bomb;
  const p = player();

  if (bomb.state === 'dropped') { // pickup: a living attacker walking over it takes it
    for (const a of state.actors) {
      if (a.team === attackingTeam() && a.alive && dist2D(a.pos.x, a.pos.z, bomb.pos.x, bomb.pos.z) < 1.2) {
        a.hasBomb = true;
        bomb.state = 'carried';
        bomb.carrierId = a.id;
        emit('bombPickup', { by: a.name });
        break;
      }
    }
    return;
  }

  if (bomb.state === 'carried') {
    const carrier = state.actors[bomb.carrierId]; // planting: carrier (player holding E, or a bot in plant mode)
    if (!carrier || !carrier.alive) return;
    const site = siteAt(carrier.pos.x, carrier.pos.z);
    if (!site) { bomb.plantProgress = 0; return; }
    const planting = carrier.isPlayer
      ? playerHoldingE
      : (carrier.ai && carrier.ai.mode === 'plant');
    if (planting) {
      bomb.plantProgress += dt;
      bomb.site = site.id;
      if (bomb.plantProgress >= PLANT_TIME) {
        bomb.state = 'planted';
        bomb.fuseLeft = BOMB_FUSE;
        bomb.pos = { x: carrier.pos.x, y: 0.2, z: carrier.pos.z };
        bomb.plantedBy = carrier.id;
        carrier.hasBomb = false;
        carrier.money += ECON.plant;
        reportNoise(bomb.pos.x, bomb.pos.z, carrier.team, now, 'plant'); // the plant is loud: defenders hear it and rotate
        if (!carrier.isPlayer) radio(carrier, `bomb planted at ${site.id}`, now);
        emit('bombPlanted', { site: site.id });
        sfx.plantBeep();
      }
    } else {
      bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 2);
    }
    return;
  }

  if (bomb.state === 'planted') {
    bomb.fuseLeft -= dt;
    if (Math.floor(bomb.fuseLeft * 2) !== Math.floor((bomb.fuseLeft + dt) * 2)) sfx.bombTick(); // beep faster as the fuse runs out
    let defuser = null; // defusing: a defender holding E in the site, or a bot in defuse mode
    for (const a of state.actors) {
      if (a.team !== defendingTeam() || !a.alive) continue;
      if (dist2D(a.pos.x, a.pos.z, bomb.pos.x, bomb.pos.z) > 2.5) continue;
      if (a.isPlayer && playerHoldingE) { defuser = a; break; }
      if (!a.isPlayer && a.ai && a.ai.mode === 'defuse') { defuser = a; break; }
    }
    if (defuser) {
      const need = defuser.hasKit ? DEFUSE_KIT_TIME : DEFUSE_TIME; // a kit cuts the defuse from 5.0s to 3.6s
      bomb.defuseProgress += dt;
      bomb.defuseNeed = need;
      if (Math.floor(bomb.defuseProgress) !== Math.floor(bomb.defuseProgress - dt)) {
        reportNoise(bomb.pos.x, bomb.pos.z, defuser.team, now, 'defuse');
      }
      if (bomb.defuseProgress >= need) {
        bomb.state = 'defused';
        defuser.money += ECON.defuse;
        sfx.defuse();
        endRound(defendingTeam(), 'BOMB DEFUSED');
        return;
      }
    } else {
      bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt * 2);
    }
    if (bomb.fuseLeft <= 0) {
      bomb.state = 'exploded';
      explosionBurst(bomb.pos);
      const pp = player();
      sfx.explosion(dist2D(pp.pos.x, pp.pos.z, bomb.pos.x, bomb.pos.z));
      reportNoise(bomb.pos.x, bomb.pos.z, attackingTeam(), now, 'boom');
      state.shake = 1;
      endRound(attackingTeam(), 'BOMB DETONATED');
    }
  }
}

// ---- buying ----
export const SHOP = [
  { id: 'rifle', kind: 'primary' },
  { id: 'smg', kind: 'primary' },
  { id: 'shotgun', kind: 'primary' },
  { id: 'sniper', kind: 'primary' },
  { id: 'grenade', kind: 'grenade' },
  { id: 'smoke', kind: 'grenade' },
  { id: 'flash', kind: 'grenade' },
  { id: 'armor', kind: 'armor' },
  { id: 'kit', kind: 'kit' },
];

export function canBuy() {
  if (state.phase === 'freeze') return true;
  if (state.phase === 'live' && state.liveElapsed < 12) return true;
  return false;
}

const GRENADE_FIELD = { grenade: 'grenades', smoke: 'smokes', flash: 'flashes' };

export function buyItem(actor, itemId) {
  if (!canBuy() || !actor.alive) return { ok: false, why: 'Buy window closed' };
  if (GRENADE_FIELD[itemId]) {
    const def = GRENADES[itemId === 'grenade' ? 'frag' : itemId];
    const field = GRENADE_FIELD[itemId];
    if (actor[field] >= 2) return { ok: false, why: `Max 2 ${def.name}` };
    if (actor.money < def.price) return { ok: false, why: 'Not enough money' };
    actor.money -= def.price;
    actor[field] += 1;
    sfx.buy();
    return { ok: true };
  }
  if (itemId === 'kit') {
    if (actor.hasKit) return { ok: false, why: 'Already have a kit' };
    if (actor.money < KIT_PRICE) return { ok: false, why: 'Not enough money' };
    actor.money -= KIT_PRICE;
    actor.hasKit = true;
    sfx.buy();
    return { ok: true };
  }
  if (itemId === 'armor') {
    if (actor.armor >= 100) return { ok: false, why: 'Armor full' };
    if (actor.money < ARMOR_PRICE) return { ok: false, why: 'Not enough money' };
    actor.money -= ARMOR_PRICE;
    actor.armor = 100;
    sfx.buy();
    return { ok: true };
  }
  const def = WEAPONS[itemId];
  if (!def || def.slot !== 0) return { ok: false, why: 'Unknown item' };
  if (actor.money < def.price) return { ok: false, why: 'Not enough money' };
  if (actor.weapons.some((w) => w.defId === itemId)) return { ok: false, why: 'Already owned' };
  actor.money -= def.price;
  const w = makeWeapon(itemId);
  const primIdx = actor.weapons.findIndex((x) => x.def.slot === 0);
  if (primIdx >= 0) actor.weapons[primIdx] = w; else actor.weapons.unshift(w);
  actor.current = actor.weapons.indexOf(w);
  sfx.buy();
  return { ok: true };
}

// ---- per-step director ----
export function stepRound(dt, now, playerHoldingE) {
  if (state.phase === 'freeze') {
    state.freezeLeft -= dt;
    if (state.freezeLeft <= 0) {
      state.phase = 'live';
      emit('roundLive', {});
    }
    return;
  }
  if (state.phase === 'live') {
    state.liveElapsed += dt;
    if (state.bomb.state !== 'planted') state.roundTimeLeft -= dt;
    updateBomb(dt, now, playerHoldingE);
    if (state.phase !== 'live') return; // bomb ended the round
    const atkAlive = aliveCount(attackingTeam()); // elimination / timeout
    const defAlive = aliveCount(defendingTeam());
    if (state.bomb.state !== 'planted') {
      if (defAlive === 0) { endRound(attackingTeam(), 'ENEMY TEAM ELIMINATED'); return; }
      if (atkAlive === 0) { endRound(defendingTeam(), 'ENEMY TEAM ELIMINATED'); return; }
      if (state.roundTimeLeft <= 0) { endRound(defendingTeam(), 'TIME EXPIRED'); return; }
    } else {
      if (defAlive === 0) { endRound(attackingTeam(), 'DEFENDERS ELIMINATED'); return; }
      if (atkAlive === 0 && state.bomb.defuseProgress <= 0) {
        // No attackers left and nobody defusing: the fuse still has to blow.
      }
    }
    return;
  }
  if (state.phase === 'over') {
    state.intermissionLeft -= dt;
    if (state.intermissionLeft <= 0) {
      if (state.matchWinner >= 0) {
        state.phase = 'matchEnd';
        emit('matchEnd', { winner: state.matchWinner });
      } else {
        state.round += 1;
        startRound();
      }
    }
  }
}
