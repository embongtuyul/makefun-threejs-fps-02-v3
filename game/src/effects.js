// SANDLINE — effects.js: tracers, impact sparks, blood puffs, explosions.
// Everything is pooled: tracers are a fixed set of line segments, particles
// live in one THREE.Points buffer. No object is created during play.

import * as THREE from 'three';

const MAX_TRACERS = 24;
const MAX_PARTICLES = 400;

let tracerPool = [];
let tracerIdx = 0;
let points = null;
let pPos = null; // Float32Array(MAX_PARTICLES * 3)
let pCol = null;
let pVel = null;
let pLife = null; // seconds remaining per particle
let pNext = 0;
let flashLight = null;
let flashUntil = 0;

const _v = new THREE.Vector3();

export function initEffects(scene) {
  // Tracer pool: thin bright lines, hidden until fired.
  const mat = new THREE.LineBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.85 });
  for (let i = 0; i < MAX_TRACERS; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, until: 0 });
  }
  // Particle pool: one Points cloud, dead particles parked at y = -100.
  pPos = new Float32Array(MAX_PARTICLES * 3);
  pCol = new Float32Array(MAX_PARTICLES * 3);
  pVel = new Float32Array(MAX_PARTICLES * 3);
  pLife = new Float32Array(MAX_PARTICLES);
  for (let i = 0; i < MAX_PARTICLES; i++) pPos[i * 3 + 1] = -100;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
    depthWrite: false, sizeAttenuation: true,
  }));
  points.frustumCulled = false;
  scene.add(points);
  // Muzzle flash light (one light, reused).
  flashLight = new THREE.PointLight(0xffc266, 0, 9, 1.8);
  scene.add(flashLight);
}

export function tracer(from, to, now) {
  const t = tracerPool[tracerIdx];
  tracerIdx = (tracerIdx + 1) % MAX_TRACERS;
  const attr = t.line.geometry.getAttribute('position');
  attr.setXYZ(0, from.x, from.y, from.z);
  attr.setXYZ(1, to.x, to.y, to.z);
  attr.needsUpdate = true;
  t.line.visible = true;
  t.until = now + 0.06;
}

function spawn(x, y, z, vx, vy, vz, life, r, g, b) {
  const i = pNext;
  pNext = (pNext + 1) % MAX_PARTICLES;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pCol[i * 3] = r; pCol[i * 3 + 1] = g; pCol[i * 3 + 2] = b;
  pLife[i] = life;
}

export function impactSparks(p, normal) {
  for (let i = 0; i < 8; i++) {
    _v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 3);
    if (normal) { _v.x += normal.x * 1.5; _v.y += normal.y * 1.5; _v.z += normal.z * 1.5; }
    spawn(p.x, p.y, p.z, _v.x, _v.y + 2, _v.z, 0.3 + Math.random() * 0.3, 1, 0.85, 0.5);
  }
}

export function bloodPuff(p) {
  for (let i = 0; i < 10; i++) {
    spawn(p.x, p.y, p.z,
      (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2,
      0.35 + Math.random() * 0.25, 0.55, 0.05, 0.05);
  }
}

export function explosionBurst(p) {
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const up = Math.random() * 7 + 2;
    const out = Math.random() * 5 + 1;
    spawn(p.x, p.y + 0.3, p.z,
      Math.cos(a) * out, up, Math.sin(a) * out,
      0.5 + Math.random() * 0.7,
      1, 0.5 + Math.random() * 0.4, 0.15);
  }
  for (let i = 0; i < 24; i++) {
    spawn(p.x + (Math.random() - 0.5) * 2, p.y + Math.random() * 2, p.z + (Math.random() - 0.5) * 2,
      (Math.random() - 0.5), 1 + Math.random(), (Math.random() - 0.5),
      1 + Math.random(), 0.25, 0.22, 0.2);
  }
}

export function muzzleFlash(pos, now) {
  flashLight.position.copy(pos);
  flashLight.intensity = 14;
  flashUntil = now + 0.05;
}

// Per-frame update: age tracers and particles, fade the flash light.
export function updateEffects(now, dt) {
  for (const t of tracerPool) {
    if (t.line.visible && now >= t.until) t.line.visible = false;
  }
  if (flashLight.intensity > 0 && now >= flashUntil) flashLight.intensity = 0;
  let dirty = false;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -100; dirty = true; continue; }
    pVel[i * 3 + 1] -= 9.8 * dt;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    if (pPos[i * 3 + 1] < 0.03) { pPos[i * 3 + 1] = 0.03; pVel[i * 3 + 1] *= -0.3; }
    dirty = true;
  }
  if (dirty) {
    points.geometry.getAttribute('position').needsUpdate = true;
    points.geometry.getAttribute('color').needsUpdate = true;
  }
}
