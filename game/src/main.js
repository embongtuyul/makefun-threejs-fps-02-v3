// SANDLINE — main.js: boot, the fixed-step loop and the glue.
// Fixed 60 Hz simulation, decoupled from rendering: the accumulator steps
// the world while the renderer draws the latest state once per frame.
//
// SOURCE MAP (one module per job; dossier order: index.html, then DFS
// imports from here, then the rest by path):
//   config.js — tunables: weapons (fixed learnable recoil patterns),
//     economy, grenades (frag/smoke/flash), bot tuning
//   state.js — the single game state object; nothing keeps a second copy
//   map.js — YARD-7 geometry, colliders, waypoints, 3 sites, callout zones
//   nav.js — A*: validated waypoint edges, smoothing, danger map
//   tactics.js — round plans (entry/support/lurk, rotator), trades, rotations
//   collision.js — AABB raycasts, capsule resolution, ground height
//   player.js — first-person controller: movement, look, camera rig
//   weapons.js — weapon instances, spread/recoil model, viewmodel
//   combat.js — raycast hits, hitboxes (head x4), damage, armor, assists
//   bots.js — bot AI: roles, A* routes, hold angles + peek, vision
//     (smoke/flash aware), muffled 5-kind hearing, burst fire, bomb
//     duties, SHOPPING, radio
//   grenades.js — frag/smoke/flash physics, smoke clouds, flash blindness
//   rounds.js — round machine, bomb, economy, buy menu, win rules
//   effects.js — pooled tracers, particles, muzzle flash (no per-frame alloc)
//   audio.js — synthesized WebAudio sound, no audio files shipped
//   hud.js — DOM HUD, buy menu, killfeed, radio feed, minimap, scoreboard
//   input.js — keyboard, mouse, pointer lock
//   shots.js — staged scenes (?shot=...) for screenshots: real renders
//   utils.js — math helpers and preallocated scratch vectors

import * as THREE from 'three';
import { findPath, navDebug, edgeClear } from './nav.js';
import { BOMB_FUSE, FIXED_DT, MAX_STEPS_PER_FRAME, TEAM_NAME } from './config.js';
import { buildMap, SITES } from './map.js';
import { initEffects, muzzleFlash, updateEffects } from './effects.js';
import { initGrenades, stepGrenades, stepSmokes, throwGrenade } from './grenades.js';
import { endStep, initInput, input, releaseLock, requestLock, wasPressed } from './input.js';
import { initPlayer, stepPlayer, updateCamera, updateSpectateCamera, aimDirection, eyeHeight } from './player.js';
import { initRounds, startMatch, stepRound } from './rounds.js';
import { reportNoise, stepBot, updateBotMesh } from './bots.js';
import { shootRay } from './combat.js';
import { state, player, attackingTeam } from './state.js';
import { currentSpread, currentWeapon, fireBlockReason, spendRound, startReload, styleViewmodel, switchTo, updateReload, updateViewmodel, updateWeaponFeel, buildViewmodel } from './weapons.js';
import { initAudio, sfx } from './audio.js';
import { seedFeed, stageShot } from './shots.js';
import {
  centerMessage, flashDamage, flashHitmarker, hideMatchEnd, initHud,
  isBuyOpen, isScoreOpen, refreshBuyMenu, showBanner, showHud, showMatchEnd, showMenu,
  showPause, toggleBuyMenu, toggleScoreboard, tryBuy, updateHud,
} from './hud.js';

const params = new URLSearchParams(location.search);
state.demo = params.has('demo');

let renderer, scene, camera;
let lastNow = 0;
let acc = 0;
let lastHealth = 100;
let expectUnlock = false; // opening the buy menu releases the lock on purpose
let demoYaw = 0;
let demoMode = params.get('demo') || '';

const _aim = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const BUY_HOTKEYS = ['rifle', 'smg', 'shotgun', 'sniper', 'grenade', 'smoke', 'flash', 'armor', 'kit'];
const shotMode = params.get('shot') || '';

init();

function init() {
  const canvas = document.getElementById('game');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const lowQuality = new URLSearchParams(location.search).has('low');
  renderer.setPixelRatio(lowQuality ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !lowQuality;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 300);
  scene.add(camera);

  buildMap(scene);
  initEffects(scene);
  initGrenades(scene);
  initPlayer(camera);
  buildViewmodel(camera);
  initHud();
  initRounds(scene, onRoundEvent);
  initInput(canvas, {
    onUnlock: () => {
      if (expectUnlock) { expectUnlock = false; return; }
      if ((state.phase === 'live' || state.phase === 'freeze') && !isBuyOpen()) {
        showPause(true);
      }
    },
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  document.getElementById('btn-deploy').addEventListener('click', deploy);
  document.getElementById('btn-resume').addEventListener('click', resume);
  document.getElementById('btn-quit').addEventListener('click', quitToMenu);
  document.getElementById('btn-rematch').addEventListener('click', rematch);
  document.getElementById('btn-menu2').addEventListener('click', quitToMenu);

  // Menu cinematic camera: slow orbit over the yard.
  camera.position.set(0, 16, 26);
  camera.lookAt(0, 0, 0);

  document.getElementById('loading').style.display = 'none';

  window.__sandline = { state, input, seedFeed, stageShot, navDebug, findPath, edgeClear, SITES }; // dev/test hook

  if (state.demo) {
    showMenu(false);
    deploy();
    if (demoMode === 'buy') setTimeout(() => openBuy(), 400);
  }

  if (shotMode) {
    // Staged screenshot scene (?shot=firefight|buy|defuse|board): real
    // renders of this same code, framed deterministically.
    showMenu(false);
    deploy();
    setTimeout(() => stageShot(shotMode), 300);
  }

  requestAnimationFrame(frame);
}

function deploy() {
  initAudio();
  showMenu(false);
  hideMatchEnd();
  showHud(true);
  startMatch();
  lastHealth = 100;
  if (!state.demo) openBuy(); // freeze time: buy first, lock on close
}

function resume() {
  showPause(false);
  requestLock();
}

function quitToMenu() {
  showPause(false);
  hideMatchEnd();
  showHud(false);
  toggleBuyMenu(false);
  releaseLock();
  state.phase = 'menu';
  showMenu(true);
}

function rematch() {
  hideMatchEnd();
  showHud(true);
  startMatch();
  lastHealth = 100;
  if (!state.demo) openBuy();
}

function openBuy() {
  if (toggleBuyMenu(true)) {
    expectUnlock = true;
    releaseLock();
    refreshBuyMenu();
  }
}

function closeBuy() {
  if (isBuyOpen()) {
    toggleBuyMenu(false);
    if (state.phase !== 'menu' && !state.demo) requestLock();
  }
}

// ---- round events from rounds.js ----
function onRoundEvent(type, data) {
  if (type === 'banner') {
    showBanner(data.text, data.sub, data.kind);
  } else if (type === 'roundStart') {
    const p = player();
    const side = p.team === attackingTeam() ? 'ATTACK' : 'DEFEND';
    centerMessage(`ROUND ${data.round} — ${side}`, 2.5);
    if (state.phase === 'freeze' && !state.demo) openBuy();
  } else if (type === 'roundLive') {
    if (isBuyOpen()) closeBuy();
    centerMessage('GO GO GO', 1.2);
  } else if (type === 'bombPlanted') {
    showBanner('BOMB PLANTED', `Site ${data.site} — ${BOMB_FUSE} seconds`, 'info');
  } else if (type === 'bombDrop') {
    centerMessage('The bomb was dropped', 2);
  } else if (type === 'bombPickup') {
    centerMessage(`${data.by} picked up the bomb`, 2);
  } else if (type === 'matchEnd') {
    releaseLock();
    showMatchEnd(data.winner, state.stats);
  }
}

// ---- shooting ----
function playerShoot(now) {
  const p = player();
  if (!p.alive || state.phase !== 'live') return;
  const w = currentWeapon(p);
  if (!w) return;
  const wantFire = w.def.auto ? input.firing : input.clicked;
  if (!wantFire) return;
  const blocked = fireBlockReason(p, now);
  if (blocked === 'empty') {
    if (input.clicked) { sfx.dryFire(); startReload(p, now); }
    return;
  }
  if (blocked) return;
  spendRound(p, now);
  state.stats.shots += w.def.pellets;
  const spread = currentSpread(p, input.aiming);
  for (let i = 0; i < w.def.pellets; i++) {
    aimDirection(p, _aim);
    // Random point in the spread cone (gaussian-ish via two uniforms).
    const a = Math.random() * Math.PI * 2;
    const r = spread * Math.sqrt(Math.random());
    const perpX = Math.cos(p.yaw);
    const perpZ = -Math.sin(p.yaw);
    _aim.x += Math.cos(a) * r * perpX;
    _aim.y += Math.sin(a) * r;
    _aim.z += Math.cos(a) * r * perpZ;
    _aim.normalize();
    shootRay(p, _aim, w.def, now, (victim, part, dmg, headshot) => {
      state.stats.hits += 1;
      if (headshot) state.stats.headshots += 1;
      flashHitmarker(!victim.alive);
      sfx.hit(headshot);
      if (!victim.alive) sfx.kill();
    });
  }
  // Muzzle flash at the gun tip, tracer origin at the eye. A knife swing
  // has no flash and no gunshot — just a swish.
  if (w.def.melee) {
    sfx.knife();
  } else {
    eyeMuzzle(p, _muzzle);
    muzzleFlash(_muzzle, now);
    sfx.shoot(w.def.sound, 0);
  }
  reportNoise(p.pos.x, p.pos.z, p.team, now);
  updateViewmodel(0, false, true, input.aiming);
}

function eyeMuzzle(p, out) {
  aimDirection(p, out);
  out.multiplyScalar(0.6);
  out.x += p.pos.x;
  out.y += p.pos.y + eyeHeight(p);
  out.z += p.pos.z;
  return out;
}

// ---- fixed simulation step ----
function step(dt) {
  state.time += dt;
  const now = state.time;
  const p = player();
  if (!p) return;

  const holdingE = input.keys.has('KeyE');

  if (wasPressed('KeyB')) {
    if (isBuyOpen()) closeBuy();
    else if (state.phase === 'freeze' || state.phase === 'live') openBuy();
  }
  if (wasPressed('Tab')) {
    if ((state.phase === 'live' || state.phase === 'freeze' || state.phase === 'over') && !isBuyOpen()) {
      toggleScoreboard();
    }
  }
  if (wasPressed('KeyR')) { if (startReload(p, now)) sfx.reload(); }
  // Number keys buy while the menu is open; otherwise they throw grenades
  // (4 = smoke, 5 = flash) or switch weapons (1/2/3). G throws frag.
  if (isBuyOpen()) {
    for (let i = 0; i < BUY_HOTKEYS.length; i++) {
      if (wasPressed(`Digit${i + 1}`)) tryBuy(BUY_HOTKEYS[i]);
    }
  } else {
    const throwKey = wasPressed('KeyG') ? 'frag' : wasPressed('Digit4') ? 'smoke' : wasPressed('Digit5') ? 'flash' : null;
    if (throwKey && state.phase === 'live' && p.alive) {
      aimDirection(p, _aim);
      throwGrenade(p, _aim, throwKey);
    }
    if (wasPressed('Digit1')) { if (switchTo(p, 0)) styleViewmodel(currentWeapon(p).defId); }
    if (wasPressed('Digit2')) { if (switchTo(p, 1)) styleViewmodel(currentWeapon(p).defId); }
    if (wasPressed('Digit3')) { if (switchTo(p, 2)) styleViewmodel(currentWeapon(p).defId); }
  }

  if (state.phase === 'freeze' || state.phase === 'live' || state.phase === 'over') {
    stepPlayer(p, dt, state.phase !== 'live');
    updateReload(p, now);
    updateWeaponFeel(p, dt);
    playerShoot(now);
    if (state.phase === 'live') {
      for (const a of state.actors) {
        if (!a.isPlayer) stepBot(a, dt, now);
      }
      stepGrenades(dt, now);
      stepSmokes(now);
    }
    stepRound(dt, now, holdingE);
    if (p.health < lastHealth) { flashDamage(); sfx.hurt(); } // damage feedback
    lastHealth = p.health;
    state.shake = Math.max(0, state.shake - dt * 2.2);
  }
  endStep();
}

// ---- render frame ----
function frame(t) {
  requestAnimationFrame(frame);
  const nowMs = t / 1000;
  let frameDt = Math.min(0.1, nowMs - (lastNow || nowMs));
  lastNow = nowMs;

  if (state.phase === 'menu') {
    const a = nowMs * 0.05; // cinematic orbit behind the main menu
    camera.position.set(Math.sin(a) * 26, 15, Math.cos(a) * 26);
    camera.lookAt(0, 0, 0);
    updateEffects(nowMs, frameDt);
    renderer.render(scene, camera);
    return;
  }

  acc += frameDt; // fixed-step accumulator
  let steps = 0;
  while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    step(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_STEPS_PER_FRAME) acc = 0;

  const p = player();
  updateEffects(state.time, frameDt);
  for (const a of state.actors) {
    if (!a.isPlayer) updateBotMesh(a, frameDt);
  }
  if (p) {
    if (p.alive) {
      updateCamera(p, frameDt, input.aiming && state.phase === 'live', state.shake);
      const moving = Math.hypot(p.vel.x, p.vel.z) > 0.5;
      updateViewmodel(frameDt, moving, false, input.aiming);
      if (state.demo) {
        demoYaw += frameDt * 0.07; // slow panoramic look from the spawn
        p.yaw = -Math.PI / 2 + Math.sin(demoYaw) * 0.6;
        p.pitch = 0.02 + Math.sin(demoYaw * 0.6) * 0.05;
      }
    } else if (state.spectateId >= 0) {
      updateSpectateCamera(state.actors[state.spectateId], frameDt, nowMs);
    }
    updateHud(state.time, currentSpread(p, input.aiming));
  }

  renderer.render(scene, camera);
}
