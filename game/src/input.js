// SANDLINE — input.js: keyboard, mouse and pointer lock.
// One object holds the live input state; the simulation reads it each step.
// Pointer lock is requested on the canvas; mouse deltas accumulate here and
// are consumed once per fixed step, so look sensitivity is frame-rate free.

export const input = {
  keys: new Set(), // currently held KeyboardEvent.code values
  mouseDX: 0, mouseDY: 0, // accumulated look deltas since last consume
  firing: false, // left button held
  aiming: false, // right button held
  locked: false,
  pressed: new Set(), // codes pressed since last step (edge-triggered)
  clicked: false, // left button pressed since last step (semi-auto fire)
};

let canvasEl = null;
let onLockChange = null;
let onUnlock = null;

export function initInput(canvas, callbacks = {}) {
  canvasEl = canvas;
  onLockChange = callbacks.onLockChange || null;
  onUnlock = callbacks.onUnlock || null;

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys.add(e.code);
    input.pressed.add(e.code);
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault(); // Tab = scoreboard
  });
  document.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.firing = false;
    input.aiming = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });
  document.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) { input.firing = true; input.clicked = true; }
    if (e.button === 2) input.aiming = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvasEl;
    if (!input.locked) {
      input.firing = false;
      input.aiming = false;
      if (onUnlock) onUnlock();
    }
    if (onLockChange) onLockChange(input.locked);
  });
}

export function requestLock() {
  if (canvasEl && document.pointerLockElement !== canvasEl) {
    canvasEl.requestPointerLock();
  }
}

export function releaseLock() {
  if (document.pointerLockElement) document.exitPointerLock();
}

// Consume the look deltas accumulated since the last call.
export function consumeLook() {
  const dx = input.mouseDX, dy = input.mouseDY;
  input.mouseDX = 0; input.mouseDY = 0;
  return { dx, dy };
}

// Edge-triggered key: true once per press, consumed by the caller.
export function wasPressed(code) {
  if (input.pressed.has(code)) { input.pressed.delete(code); return true; }
  return false;
}

export function endStep() {
  // Keys pressed during a step stay available until read; clear the click.
  input.clicked = false;
}

export function clearPressed() { input.pressed.clear(); }
