// SANDLINE — utils.js: small math helpers shared by every module.
// Preallocated scratch vectors live here: hot loops must never `new` a
// Vector3 per frame, so callers reuse these temporaries.

import * as THREE from 'three';

export const V1 = new THREE.Vector3();
export const V2 = new THREE.Vector3();
export const V3 = new THREE.Vector3();
export const V4 = new THREE.Vector3();
export const V5 = new THREE.Vector3();

export function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }

// Frame-rate independent exponential approach for angles.
export function dampAngle(a, b, lambda, dt) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-lambda * dt));
}

export function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
export function randInt(lo, hi) { return Math.floor(rand(lo, hi + 1)); }
export function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

// Distance on the ground plane (ignores y).
export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
}

// Yaw (radians) that looks from (ax,az) toward (bx,bz). Yaw 0 faces -Z.
export function yawTo(ax, az, bx, bz) {
  return Math.atan2(-(bx - ax), -(bz - az));
}

// Seeded RNG (mulberry32) for map decoration, so the map is identical
// every load while gameplay randomness stays unseeded.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
