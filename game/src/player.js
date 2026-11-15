// SANDLINE — player.js: the first-person controller.
// Acceleration-based movement with ground friction, jumping, crouching and
// AABB collision; mouse look with yaw/pitch and recoil kick; the camera rig
// (eye height, ADS zoom, landing dip, explosion shake). The sim calls
// stepPlayer once per fixed step; updateCamera runs once per render.

import * as THREE from 'three';
import { MOVE } from './config.js';
import { groundHeightAt, resolveCircle } from './collision.js';
import { consumeLook, input } from './input.js';
import { clamp, damp } from './utils.js';
import { currentWeapon } from './weapons.js';
import { reportNoise } from './bots.js';
import { state } from './state.js';
import { sfx } from './audio.js';

const LOOK_SENS = 0.0023;
const PITCH_LIMIT = 1.45; // ~83 degrees
const _pos = new THREE.Vector3();

let cameraRef = null;
let dip = 0; // landing dip (visual only)
let bobPhase = 0;
let stepAcc = 0;

export function initPlayer(camera) {
  cameraRef = camera;
}

// Aim direction from yaw/pitch plus the weapon's live recoil offsets.
export function aimDirection(actor, out) {
  const w = currentWeapon(actor);
  const recoil = w ? w.recoil : 0;
  const sway = w ? w.sway : 0;
  const pitch = actor.pitch + recoil;
  const yaw = actor.yaw + sway;
  const cp = Math.cos(pitch);
  out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  return out;
}

export function eyeHeight(actor) {
  return actor.crouching ? MOVE.eyeCrouch : MOVE.eyeStand;
}

// One fixed simulation step of player movement + look.
export function stepPlayer(actor, dt, frozen) {
  // --- look ---
  const look = consumeLook();
  actor.yaw -= look.dx * LOOK_SENS;
  actor.pitch = clamp(actor.pitch - look.dy * LOOK_SENS, -PITCH_LIMIT, PITCH_LIMIT);

  if (frozen || !actor.alive) {
    actor.vel.x = 0; actor.vel.z = 0;
    return;
  }

  // --- wish direction from keys, relative to yaw ---
  const fwd = (input.keys.has('KeyW') ? 1 : 0) - (input.keys.has('KeyS') ? 1 : 0);
  const strafe = (input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('KeyA') ? 1 : 0);
  const sin = Math.sin(actor.yaw), cos = Math.cos(actor.yaw);
  let wx = -sin * fwd + cos * strafe;
  let wz = -cos * fwd - sin * strafe;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  actor.crouching = input.keys.has('ControlLeft') || input.keys.has('KeyC');
  const sprinting = input.keys.has('ShiftLeft') && fwd > 0 && !actor.crouching;
  const speed = actor.crouching ? MOVE.crouch : sprinting ? MOVE.sprint : MOVE.walk;

  // --- accelerate toward wish velocity, friction when idle ---
  const accel = actor.onGround ? MOVE.accel : MOVE.airAccel;
  if (wl > 0) {
    actor.vel.x += wx * accel * dt;
    actor.vel.z += wz * accel * dt;
    // Cap horizontal speed (soft: only pull back the excess).
    const sp = Math.hypot(actor.vel.x, actor.vel.z);
    if (sp > speed) {
      const k = speed / sp;
      actor.vel.x *= k; actor.vel.z *= k;
    }
  } else if (actor.onGround) {
    const f = Math.max(0, 1 - MOVE.friction * dt);
    actor.vel.x *= f; actor.vel.z *= f;
  }

  // --- jump / gravity ---
  if (input.keys.has('Space') && actor.onGround) {
    actor.vel.y = MOVE.jump;
    actor.onGround = false;
  }
  actor.vel.y -= MOVE.gravity * dt;

  // --- integrate + collide ---
  actor.pos.x += actor.vel.x * dt;
  actor.pos.z += actor.vel.z * dt;
  actor.pos.y += actor.vel.y * dt;
  _pos.set(actor.pos.x, actor.pos.y, actor.pos.z);
  resolveCircle(_pos, MOVE.radius, MOVE.height);
  actor.pos.x = _pos.x; actor.pos.z = _pos.z;

  const ground = groundHeightAt(actor.pos.x, actor.pos.z, MOVE.radius, actor.pos.y);
  if (actor.pos.y <= ground) {
    if (!actor.onGround && actor.vel.y < -6) dip = Math.min(0.14, -actor.vel.y * 0.012);
    actor.pos.y = ground;
    actor.vel.y = 0;
    actor.onGround = true;
  } else if (actor.pos.y > ground + 0.02) {
    actor.onGround = false;
  }

  // --- footsteps (bots hear them up close — crouch to stay quiet) ---
  const hSpeed = Math.hypot(actor.vel.x, actor.vel.z);
  if (actor.onGround && hSpeed > 1) {
    stepAcc += hSpeed * dt;
    bobPhase += dt * hSpeed * 1.6;
    if (stepAcc > 2.4) {
      stepAcc = 0;
      sfx.step(0);
      if (!actor.crouching) reportNoise(actor.pos.x, actor.pos.z, actor.team, state.time, 'step');
    }
  }
}

// Per-render camera update: eye position, ADS zoom, bob, dip, shake.
export function updateCamera(actor, dt, aiming, shake) {
  if (!cameraRef) return;
  const w = currentWeapon(actor);
  const zoom = aiming && w ? w.def.zoom : 1;
  const targetFov = 75 / zoom;
  cameraRef.fov += (targetFov - cameraRef.fov) * Math.min(1, dt * 14);
  cameraRef.updateProjectionMatrix();

  dip = damp(dip, 0, 8, dt);
  const hSpeed = Math.hypot(actor.vel.x, actor.vel.z);
  const bobY = actor.onGround && hSpeed > 1 ? Math.sin(bobPhase * 2) * 0.014 : 0;
  const bobX = actor.onGround && hSpeed > 1 ? Math.cos(bobPhase) * 0.01 : 0;

  cameraRef.position.set(
    actor.pos.x + bobX * Math.cos(actor.yaw),
    actor.pos.y + eyeHeight(actor) + bobY - dip,
    actor.pos.z - bobX * Math.sin(actor.yaw),
  );
  const recoil = w ? w.recoil : 0;
  const sway = w ? w.sway : 0;
  const shakeX = shake > 0 ? (Math.random() - 0.5) * shake * 0.05 : 0;
  const shakeY = shake > 0 ? (Math.random() - 0.5) * shake * 0.05 : 0;
  cameraRef.rotation.order = 'YXZ';
  cameraRef.rotation.set(actor.pitch + recoil + shakeY, actor.yaw + sway + shakeX, 0);
}

// Spectate camera: watch a teammate from behind and above.
export function updateSpectateCamera(target, dt, time) {
  if (!cameraRef || !target) return;
  cameraRef.fov += (75 - cameraRef.fov) * Math.min(1, dt * 8);
  cameraRef.updateProjectionMatrix();
  const back = 4.5;
  const tx = target.pos.x + Math.sin(target.yaw) * back;
  const tz = target.pos.z + Math.cos(target.yaw) * back;
  cameraRef.position.set(tx, target.pos.y + 2.6, tz);
  cameraRef.lookAt(target.pos.x, target.pos.y + 1.4, target.pos.z);
}
