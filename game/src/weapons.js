// SANDLINE — weapons.js: weapon instances and the gunplay model.
// A weapon instance is plain data (def, mag, reserve, timers). Spread and
// recoil live here: spread grows with speed, air time and sustained fire
// (heat), shrinks when crouching or aiming down sights; recoil follows a
// FIXED pattern per weapon (config.js) — spray control is a learnable skill.

import * as THREE from 'three';
import { SPRAY_RESET, WEAPONS } from './config.js';
import { clamp } from './utils.js';

export function makeWeapon(defId) {
  const def = WEAPONS[defId];
  return {
    def, defId,
    mag: def.mag, reserve: def.reserve,
    reloading: false, reloadEnd: 0,
    nextShotAt: 0, // sim time when the trigger may fire again
    heat: 0, // sustained-fire bloom, 0..1
    recoil: 0, // accumulated vertical kick (radians), decays to 0
    sway: 0, // horizontal drift from recoil
    shotIdx: 0, // position in the fixed recoil pattern
    lastShotAt: -99, // sim time of the last shot (pattern reset clock)
  };
}

export function currentWeapon(actor) {
  return actor.weapons[actor.current];
}

export function switchTo(actor, index) {
  if (index < 0 || index >= actor.weapons.length || index === actor.current) return false;
  const w = currentWeapon(actor);
  if (w) w.reloading = false;
  actor.current = index;
  return true;
}

export function speedOf(actor) { // horizontal speed in m/s
  return Math.hypot(actor.vel.x, actor.vel.z);
}

export function currentSpread(actor, aiming) { // current cone spread in radians
  const w = currentWeapon(actor);
  const d = w.def;
  let s = d.spread;
  const speed = speedOf(actor);
  s *= 1 + (d.moveSpread - 1) * clamp(speed / 4.4, 0, 1.4);
  if (!actor.onGround) s *= 2.5;
  if (actor.crouching) s *= 0.7;
  if (aiming) s *= 0.45;
  if (d.id === 'sniper' && !aiming) s *= 3; // hip-firing a sniper is a prayer
  s *= 1 + w.heat * 1.6;
  return s;
}

export function fireBlockReason(actor, now) { // can the trigger fire? reason string or null
  const w = currentWeapon(actor);
  if (!w) return 'none';
  if (w.reloading) return 'reloading';
  if (now < w.nextShotAt) return 'cooling';
  if (w.mag <= 0) return 'empty';
  return null;
}

// Spend one round and apply recoil/heat (call only after fireBlockReason
// returns null). Recoil is NOT random: the kick comes from the weapon's
// fixed pattern (def.pattern[shotIdx]); it resets after SPRAY_RESET idle.
export function spendRound(actor, now) {
  const w = currentWeapon(actor);
  w.mag -= 1;
  w.nextShotAt = now + 60 / w.def.rof;
  w.heat = clamp(w.heat + (w.def.auto ? 0.13 : 0.22), 0, 1);
  if (now - w.lastShotAt > SPRAY_RESET) w.shotIdx = 0;
  w.lastShotAt = now;
  const pat = w.def.pattern;
  const step = pat[w.shotIdx % pat.length];
  w.shotIdx++;
  w.recoil += step[0];
  w.sway += step[1];
  return w;
}

export function startReload(actor, now) {
  const w = currentWeapon(actor);
  if (!w || w.reloading || w.mag >= w.def.mag || w.reserve <= 0) return false;
  w.reloading = true;
  w.reloadEnd = now + w.def.reload;
  return true;
}

export function updateReload(actor, now) { // finish a reload whose timer expired
  const w = currentWeapon(actor);
  if (!w || !w.reloading || now < w.reloadEnd) return false;
  const need = w.def.mag - w.mag;
  const take = Math.min(need, w.reserve);
  w.mag += take;
  w.reserve -= take;
  w.reloading = false;
  return true;
}

export function updateWeaponFeel(actor, dt) { // per-step decay of heat and recoil
  const w = currentWeapon(actor);
  if (!w) return;
  w.heat = Math.max(0, w.heat - dt * 1.4);
  w.recoil = Math.max(0, w.recoil - dt * 0.09);
  w.sway *= Math.max(0, 1 - dt * 6);
}

// ---- viewmodel: the gun the player sees, attached to the camera ----
let vmGroup = null;
let vmBody = null;
let vmBarrel = null;
let vmAccent = null;
let vmBobPhase = 0;
let vmKick = 0; // firing kick, decays to 0 between shots

export function buildViewmodel(camera) {
  vmGroup = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x24211d, roughness: 0.6, metalness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.9 });
  vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.42), dark);
  vmBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8), dark);
  vmBarrel.rotation.x = Math.PI / 2;
  vmBarrel.position.set(0, 0.02, -0.32);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.18), grip);
  stock.position.set(0, -0.01, 0.26);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), grip);
  mag.position.set(0, -0.13, -0.02);
  mag.rotation.x = 0.15;
  vmAccent = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.2), new THREE.MeshStandardMaterial({ color: 0xe8912d, roughness: 0.5, metalness: 0.4 }));
  vmAccent.position.set(0, 0.075, -0.05);
  vmGroup.add(vmBody, vmBarrel, stock, mag, vmAccent);
  vmGroup.position.set(0.24, -0.22, -0.45);
  camera.add(vmGroup);
}

export function styleViewmodel(defId) {
  if (!vmGroup) return;
  const d = WEAPONS[defId];
  if (d.melee) { // knife: short blade, no barrel; sniper gets a long barrel, SMG short
    vmBarrel.visible = false;
    vmBody.scale.set(0.5, 0.5, 1.1);
    vmAccent.material.color.setHex(0xc9c9c9);
    return;
  }
  vmBarrel.visible = true;
  vmBody.scale.set(1, 1, d.id === 'pistol' ? 0.6 : 1);
  vmBarrel.scale.z = d.id === 'sniper' ? 1.9 : d.id === 'smg' ? 0.7 : d.id === 'shotgun' ? 1.4 : 1;
  vmBarrel.position.z = d.id === 'sniper' ? -0.45 : -0.32;
  vmAccent.material.color.setHex(
    d.id === 'sniper' ? 0x6fc3ff : d.id === 'shotgun' ? 0xff5a3c : d.id === 'smg' ? 0x7ddb6a : 0xe8912d,
  );
}

export function updateViewmodel(dt, moving, firing, aiming) { // bob and sway: dips with each step, kicks on fire
  if (!vmGroup) return;
  if (firing) vmKick = 1;
  vmKick = Math.max(0, vmKick - dt * 9);
  vmBobPhase += dt * (moving ? 9 : 3);
  const bob = moving ? 0.008 : 0.002;
  const tx = aiming ? 0 : 0.24;
  const ty = aiming ? -0.185 : -0.22 + Math.sin(vmBobPhase * 2) * bob;
  const tz = aiming ? -0.35 : -0.45;
  vmGroup.position.x += (tx - vmGroup.position.x) * Math.min(1, dt * 14);
  vmGroup.position.y += (ty - vmGroup.position.y) * Math.min(1, dt * 14);
  vmGroup.position.z += (tz - vmGroup.position.z) * Math.min(1, dt * 14);
  vmGroup.rotation.x = vmKick * 0.06;
  vmGroup.rotation.z = Math.sin(vmBobPhase) * (moving ? 0.012 : 0.002);
}
