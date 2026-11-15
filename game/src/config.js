// SANDLINE — config.js: every tunable number in one place.
// Weapons, economy, round flow, movement and bot tuning live here so the
// simulation modules never hard-code magic numbers.

export const TEAM = { JACKALS: 0, FALCONS: 1 };
export const TEAM_NAME = ['JACKALS', 'FALCONS'];
export const TEAM_COLOR = [0xffb648, 0x6fc3ff]; // Jackals amber, Falcons blue
export const TEAM_COLOR_CSS = ['#ffb648', '#6fc3ff'];

// Match / round flow (seconds unless noted).
export const ROUNDS_TO_WIN = 5;
export const SWAP_AFTER_ROUND = 4; // sides swap after round 4
export const FREEZE_TIME = 4.0; // buy phase at round start
export const BUY_GRACE = 12.0; // buying stays open this long into the round
export const ROUND_TIME = 100.0;
export const BOMB_FUSE = 30.0;
export const PLANT_TIME = 3.0;
export const DEFUSE_TIME = 5.0;
export const DEFUSE_KIT_TIME = 3.6; // with a defuse kit ($400, buy menu)
export const INTERMISSION = 4.5;
export const PLAYERS_PER_TEAM = 5; // player + 4 bots vs 5 bots

// Economy (dollars).
export const ECON = {
  start: 800,
  kill: 300,
  win: 3250,
  loss: 1400,
  lossBonusStep: 500,
  lossBonusMax: 3400,
  plant: 300,
  defuse: 300,
};

// Movement (m/s, tuned so crossing mid takes ~7s at a walk).
export const MOVE = {
  walk: 4.4,
  sprint: 6.1,
  crouch: 2.3,
  accel: 34, // ground acceleration
  airAccel: 6,
  friction: 10.5,
  jump: 4.6,
  gravity: 12.5,
  eyeStand: 1.62,
  eyeCrouch: 1.12,
  radius: 0.36,
  height: 1.75,
};

// Weapon table. damage = torso damage at point blank; falloff starts at
// falloffStart metres and scales linearly to falloffEnd (min 55% damage).
// spread is radians of cone at rest; moveSpread multiplies it at full speed.
// pattern is the LEARNABLE recoil pattern: each shot in a burst kicks the aim
// by the next [pitch, yaw] pair, in a fixed order that repeats — a player
// can learn to pull against it. The pattern resets after SPRAY_RESET seconds
// without firing (see weapons.js).
export const SPRAY_RESET = 0.32;
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 SIDEARM', slot: 1, price: 0, auto: false,
    damage: 34, headMult: 4, rof: 320, mag: 12, reserve: 48, reload: 1.5,
    spread: 0.011, moveSpread: 2.2, recoil: 0.011, kick: 0.010, range: 60,
    falloffStart: 12, falloffEnd: 40, pellets: 1, zoom: 1.15, sound: 'pistol',
    pattern: [[0.011, 0.002], [0.012, -0.003], [0.011, 0.003], [0.012, -0.002]],
    desc: 'Reliable sidearm. Free, always with you.',
  },
  rifle: {
    id: 'rifle', name: 'VK-47 RIFLE', slot: 0, price: 2700, auto: true,
    damage: 36, headMult: 4, rof: 600, mag: 30, reserve: 90, reload: 2.4,
    spread: 0.009, moveSpread: 3.0, recoil: 0.014, kick: 0.012, range: 90,
    falloffStart: 18, falloffEnd: 55, pellets: 1, zoom: 1.25, sound: 'rifle',
    pattern: [[0.014, 0], [0.015, 0.004], [0.015, 0.006], [0.016, -0.002], [0.016, -0.007], [0.015, -0.005], [0.016, 0.003], [0.017, 0.008], [0.016, 0.004], [0.017, -0.004]],
    desc: 'Full-auto workhorse. Fixed recoil pattern — learn it, pull against it.',
  },
  smg: {
    id: 'smg', name: 'KX-9 SMG', slot: 0, price: 1200, auto: true,
    damage: 26, headMult: 4, rof: 800, mag: 32, reserve: 96, reload: 2.1,
    spread: 0.016, moveSpread: 2.0, recoil: 0.010, kick: 0.008, range: 45,
    falloffStart: 10, falloffEnd: 30, pellets: 1, zoom: 1.15, sound: 'smg',
    pattern: [[0.010, 0.003], [0.011, -0.004], [0.010, 0.005], [0.011, 0.002], [0.010, -0.005], [0.011, 0.004], [0.010, -0.003], [0.011, 0.001]],
    desc: 'Sprays fast up close. Falls off at range.',
  },
  shotgun: {
    id: 'shotgun', name: 'M870 BREACHER', slot: 0, price: 1500, auto: false,
    damage: 12, headMult: 3, rof: 70, mag: 8, reserve: 32, reload: 2.9,
    spread: 0.055, moveSpread: 1.6, recoil: 0.05, kick: 0.045, range: 25,
    falloffStart: 6, falloffEnd: 18, pellets: 8, zoom: 1.1, sound: 'shotgun',
    pattern: [[0.05, 0.004], [0.052, -0.005]],
    desc: 'Eight pellets per shell. Devastating in doorways.',
  },
  sniper: {
    id: 'sniper', name: 'LW-50 LONGSHOT', slot: 0, price: 4750, auto: false,
    damage: 110, headMult: 2, rof: 42, mag: 5, reserve: 20, reload: 3.4,
    spread: 0.0015, moveSpread: 8.0, recoil: 0.075, kick: 0.06, range: 140,
    falloffStart: 30, falloffEnd: 120, pellets: 1, zoom: 3.2, sound: 'sniper',
    pattern: [[0.075, 0.002], [0.078, -0.003]],
    desc: 'One shot, one kill — if you hold still and scope in.',
  },
  knife: {
    id: 'knife', name: 'COMBAT KNIFE', slot: 2, price: 0, auto: false, melee: true,
    damage: 65, headMult: 1, rof: 150, mag: 999, reserve: 0, reload: 0,
    spread: 0, moveSpread: 1, recoil: 0, kick: 0, range: 2.4,
    falloffStart: 0, falloffEnd: 1, pellets: 1, zoom: 1, sound: 'knife',
    pattern: [[0, 0]],
    desc: 'Silent, fast, free. Slot 3 — humiliation included.',
  },
};

// Grenades: three kinds, bought separately. Frag kills, smoke blocks sight
// (bots cannot see through a cloud), flash blinds anyone facing it.
export const GRENADES = {
  frag: { id: 'frag', key: 'G', name: 'FRAG GRENADE', price: 300, fuse: 1.6, radius: 7.5, maxDamage: 120, throwSpeed: 15.5, desc: 'Cooks 1.6s. Clears rooms and corners.' },
  smoke: { id: 'smoke', key: '4', name: 'SMOKE GRENADE', price: 300, fuse: 1.4, radius: 4.5, duration: 14, throwSpeed: 15.5, desc: 'Blocks sight for 14s. Bots cannot see through it.' },
  flash: { id: 'flash', key: '5', name: 'FLASHBANG', price: 250, fuse: 1.4, radius: 16, duration: 2.8, throwSpeed: 15.5, desc: 'Blinds anyone facing it for up to 2.8s.' },
};
export const GRENADE = GRENADES.frag; // legacy alias (frag is the default)
export const KIT_PRICE = 400;
export const ARMOR_PRICE = 650;
export const ARMOR_ABSORB = 0.5; // half of incoming damage goes to armor

// Bot tuning.
export const BOT = {
  reactionMin: 0.35, reactionMax: 0.85, // seconds to open fire after spotting
  aimError: 0.020, // radians of angular error, worse at range
  burstMin: 3, burstMax: 6, // shots per burst, then a pause
  burstPause: 0.55,
  hearRadius: 26, // gunfire heard this far draws investigation
  hearStep: 10, hearPlant: 30, hearDefuse: 30, hearBoom: 35, // per-event ears
  hearMuffle: 0.45, // through a wall, a sound's radius shrinks to this fraction
  peekGap: 2.6, peekOut: 0.8, // hold-angle peek: seconds between / out per peek
  tradeRange: 20, // a death is traded only by a mate within this range (m)
  viewDist: 55,
  viewHalfAngle: 1.15, // ~66 degrees
  moveSpeed: 3.9,
  strafeTime: 1.4,
};

// Fixed simulation step (seconds). Rendering interpolates nothing: the sim
// runs at 60 Hz and the renderer draws the latest state.
export const FIXED_DT = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5;

// Map bounds (metres). The yard is 64 x 44, origin at its centre.
export const MAP = { halfX: 32, halfZ: 22 };
