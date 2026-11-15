// SANDLINE — hud.js: everything drawn in the DOM, not the 3D scene.
// The HUD is updated from the sim state once per render frame (cheap DOM
// writes, cached where the value did not change). The minimap is a 2D canvas
// that draws the map's colliders top-down plus live player dots.

import { ARMOR_PRICE, BOMB_FUSE, DEFUSE_TIME, GRENADES, KIT_PRICE, PLANT_TIME, PLAYERS_PER_TEAM, ROUNDS_TO_WIN, TEAM_COLOR_CSS, TEAM_NAME, WEAPONS } from './config.js';
import { boxes } from './collision.js';
import { locationAt, SITES } from './map.js';
import { aliveCount, attackingTeam, defendingTeam, player, state } from './state.js';
import { fmtTime } from './utils.js';
import { currentWeapon } from './weapons.js';
import { buyItem, canBuy, SHOP } from './rounds.js';

const $ = (id) => document.getElementById(id);
const els = {};
let minimapCtx = null;
let lastHud = {};
let bannerUntil = 0;
let buyOpen = false;
let centerMsgUntil = 0;
let scoreOpen = false;

export function initHud() {
  for (const id of [
    'hud', 'crosshair', 'hitmarker', 'damage-vignette', 'flash-vignette',
    'round-timer',
    'score-a', 'score-b', 'alive-a', 'alive-b', 'bomb-bar', 'bomb-fill',
    'bomb-label', 'minimap', 'location-label', 'radio-feed', 'killfeed',
    'round-banner', 'center-msg',
    'health-num', 'health-label', 'armor-num', 'interact-prompt',
    'ammo-mag', 'ammo-reserve', 'weapon-name', 'fire-mode', 'money',
    'round-info', 'objective-line', 'spectate-line', 'buy-menu',
    'buy-money', 'buy-list', 'main-menu', 'pause-menu', 'match-end',
    'match-title', 'match-sub', 'match-stats', 'scoreboard',
  ]) els[id] = $(id);
  minimapCtx = els['minimap'].getContext('2d');
  buildBuyMenu();
}

function setText(el, key, value) {
  if (lastHud[key] !== value) { el.textContent = value; lastHud[key] = value; }
}

export function showHud(show) {
  els['hud'].classList.toggle('hidden', !show);
}

export function showMenu(show) {
  els['main-menu'].classList.toggle('hidden', !show);
}

export function showPause(show) {
  els['pause-menu'].classList.toggle('hidden', !show);
}

export function showMatchEnd(winner, stats) {
  const p = player();
  const won = winner === p.team;
  els['match-title'].textContent = won ? 'VICTORY' : 'DEFEAT';
  els['match-title'].style.color = won ? '#7ddb6a' : '#ff5a3c';
  els['match-sub'].textContent = `${TEAM_NAME[winner]} take YARD-7, ${state.roundsWon[winner]}–${state.roundsWon[1 - winner]}.`;
  const acc = stats.shots > 0 ? Math.round((stats.hits / stats.shots) * 100) : 0;
  const mvp = state.actors.filter((a) => a.alive || a.deaths > 0 || a.kills > 0)
    .sort((a, b) => (b.kills * 2 + b.assists - b.deaths) - (a.kills * 2 + a.assists - a.deaths))[0];
  els['match-stats'].innerHTML = [
    ['KILLS', stats.kills], ['DEATHS', stats.deaths],
    ['ACCURACY', `${acc}%`], ['HEADSHOTS', stats.headshots],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('')
    + (mvp ? `<div class="stat mvp"><b>★ ${mvp.name}</b><span>MVP · ${mvp.kills}K ${mvp.assists}A ${mvp.dmgDealt} DMG</span></div>` : '');
  els['match-end'].classList.remove('hidden');
}

export function hideMatchEnd() { els['match-end'].classList.add('hidden'); }

export function showBanner(text, sub, kind) {
  els['round-banner'].innerHTML = `${text}<small>${sub || ''}</small>`;
  els['round-banner'].className = kind === 'win' ? 'win' : kind === 'lose' ? 'lose' : '';
  els['round-banner'].classList.remove('hidden');
  bannerUntil = state.time + 3.2;
}

export function centerMessage(text, dur = 2) {
  els['center-msg'].textContent = text;
  els['center-msg'].classList.remove('hidden');
  centerMsgUntil = state.time + dur;
}

export function clearCenterMessage() {
  els['center-msg'].classList.add('hidden');
  centerMsgUntil = 0;
}

export function flashHitmarker(kill) {
  els['hitmarker'].classList.toggle('kill', !!kill);
  els['hitmarker'].style.opacity = 1;
  setTimeout(() => { els['hitmarker'].style.opacity = 0; }, 90);
}

export function flashDamage() {
  els['damage-vignette'].style.opacity = 1;
  setTimeout(() => { els['damage-vignette'].style.opacity = 0; }, 180);
}

// ---- buy menu ----
function shopDef(item) {
  if (item.kind === 'primary') return WEAPONS[item.id];
  if (item.kind === 'grenade') return GRENADES[item.id === 'grenade' ? 'frag' : item.id];
  if (item.id === 'kit') return { name: 'DEFUSE KIT', price: KIT_PRICE, desc: 'Defuse in 3.6s instead of 5s.' };
  return { name: 'KEVLAR VEST', price: ARMOR_PRICE, desc: 'Absorbs half of incoming damage.' };
}

function buildBuyMenu() {
  els['buy-list'].innerHTML = '';
  SHOP.forEach((item, i) => {
    const def = shopDef(item);
    const div = document.createElement('div');
    div.className = 'buy-item';
    div.dataset.item = item.id;
    div.innerHTML = `<span class="bi-key">${i + 1}</span><span class="bi-name">${def.name}<span class="bi-desc">${def.desc}</span></span><span class="bi-price">$${def.price}</span>`;
    div.addEventListener('click', () => tryBuy(item.id));
    els['buy-list'].appendChild(div);
  });
}

export function tryBuy(itemId) {
  const p = player();
  const r = buyItem(p, itemId);
  if (!r.ok) centerMessage(r.why, 1.5);
  refreshBuyMenu();
}

export function refreshBuyMenu() {
  const p = player();
  setText(els['buy-money'], 'buyMoney', String(p.money));
  for (const div of els['buy-list'].children) {
    const id = div.dataset.item;
    const item = SHOP.find((s) => s.id === id);
    const owned = item.kind === 'primary' && p.weapons.some((w) => w.defId === id)
      || (id === 'kit' && p.hasKit);
    const price = shopDef(item).price;
    div.classList.toggle('owned', owned);
    div.classList.toggle('cant', !owned && (p.money < price || !canBuy()));
  }
}

export function toggleBuyMenu(force) {
  buyOpen = force !== undefined ? force : !buyOpen;
  if (buyOpen && !canBuy()) { buyOpen = false; centerMessage('Buy window closed', 1.5); }
  els['buy-menu'].classList.toggle('hidden', !buyOpen);
  if (buyOpen) refreshBuyMenu();
  return buyOpen;
}
export function isBuyOpen() { return buyOpen; }

// ---- scoreboard (hold TAB) ----
export function toggleScoreboard(force) {
  scoreOpen = force !== undefined ? force : !scoreOpen;
  els['scoreboard'].classList.toggle('hidden', !scoreOpen);
  if (scoreOpen) renderScoreboard();
  return scoreOpen;
}
export function isScoreOpen() { return scoreOpen; }

// Score = 2 per kill + 1 per assist − 1 per death. MVP is the highest
// scorer across both teams. Columns: K / A / D / damage.
function scoreOf(a) { return a.kills * 2 + a.assists - a.deaths; }

function renderScoreboard() {
  const rows = (team) => state.actors
    .filter((a) => a.team === team)
    .sort((a, b) => scoreOf(b) - scoreOf(a) || b.kills - a.kills)
    .map((a) => `<tr class="${a.isPlayer ? 'me' : ''}${!a.alive ? ' dead' : ''}"><td class="sb-name">${a.name}${a.hasBomb ? ' ●' : ''}</td><td>${a.kills}</td><td>${a.assists}</td><td>${a.deaths}</td><td>${a.dmgDealt}</td><td>${scoreOf(a)}</td></tr>`)
    .join('');
  const mvp = [...state.actors].sort((a, b) => scoreOf(b) - scoreOf(a))[0];
  els['scoreboard'].innerHTML = `
    <div class="sb-title">SCOREBOARD <span>ROUND ${state.round} · FIRST TO ${ROUNDS_TO_WIN}</span></div>
    ${[0, 1].map((t) => `
      <div class="sb-team" style="--tc:${TEAM_COLOR_CSS[t]}">
        <div class="sb-team-head">${TEAM_NAME[t]} <b>${state.roundsWon[t]}</b></div>
        <table><tr><th>PLAYER</th><th>K</th><th>A</th><th>D</th><th>DMG</th><th>SCORE</th></tr>${rows(t)}</table>
      </div>`).join('')}
    <div class="sb-mvp">★ MVP — ${mvp ? `${mvp.name} · ${mvp.kills}K ${mvp.assists}A ${mvp.dmgDealt} DMG` : '—'}</div>`;
}

// ---- per-frame HUD ----
export function updateHud(now, spread) {
  const p = player();
  if (!p) return;
  setText(els['score-a'], 'sa', String(state.roundsWon[0]));
  setText(els['score-b'], 'sb', String(state.roundsWon[1]));
  setText(els['alive-a'], 'aa', '●'.repeat(aliveCount(0)) + '○'.repeat(PLAYERS_PER_TEAM - aliveCount(0)));
  setText(els['alive-b'], 'ab', '●'.repeat(aliveCount(1)) + '○'.repeat(PLAYERS_PER_TEAM - aliveCount(1)));

  const timer = state.bomb.state === 'planted'
    ? fmtTime(state.bomb.fuseLeft)
    : state.phase === 'freeze' ? `BUY ${Math.ceil(state.freezeLeft)}` : fmtTime(state.roundTimeLeft);
  setText(els['round-timer'], 'timer', timer);
  els['round-timer'].classList.toggle('low', state.phase === 'live' && state.roundTimeLeft < 15);

  const bomb = state.bomb;
  els['bomb-bar'].classList.toggle('hidden', bomb.state !== 'planted');
  if (bomb.state === 'planted') {
    els['bomb-fill'].style.width = `${(bomb.fuseLeft / BOMB_FUSE) * 100}%`;
    setText(els['bomb-label'], 'bl', `BOMB PLANTED AT ${bomb.site} — ${bomb.fuseLeft.toFixed(1)}s`);
  }

  setText(els['health-num'], 'hp', String(Math.max(0, Math.ceil(p.health))));
  els['health-num'].classList.toggle('low', p.health <= 30);
  setText(els['armor-num'], 'armor', p.armor > 0 ? `ARMOR ${Math.ceil(p.armor)}` : '');
  const w = currentWeapon(p);
  if (w) {
    setText(els['ammo-mag'], 'mag', w.def.melee ? '—' : String(w.mag));
    els['ammo-mag'].classList.toggle('empty', !w.def.melee && w.mag === 0);
    setText(els['ammo-reserve'], 'res', w.def.melee ? '' : `/ ${w.reserve}`);
    setText(els['weapon-name'], 'wn', w.reloading ? 'RELOADING…' : w.def.name);
    const util = [
      p.grenades ? `${p.grenades} FRAG [G]` : '',
      p.smokes ? `${p.smokes} SMOKE [4]` : '',
      p.flashes ? `${p.flashes} FLASH [5]` : '',
    ].filter(Boolean).join(' · ');
    setText(els['fire-mode'], 'fm', `${w.def.melee ? 'MELEE' : w.def.auto ? 'AUTO' : 'SEMI'}${util ? ` · ${util}` : ''}${p.hasBomb ? ' · CARRYING BOMB' : ''}${p.hasKit ? ' · KIT' : ''}`);
  }
  setText(els['money'], 'money', String(p.money));
  const side = p.team === attackingTeam() ? 'ATTACK' : 'DEFEND';
  setText(els['round-info'], 'ri', `ROUND ${state.round} — ${side} · FIRST TO ${ROUNDS_TO_WIN}`);
  const obj = p.team === attackingTeam()
    ? (bomb.state === 'planted' ? `Bomb planted at ${bomb.site} — defend it` : p.hasBomb ? 'You carry the bomb — plant it at A, B or C (hold E)' : 'Plant the bomb at A, B or C — or eliminate the Falcons')
    : (bomb.state === 'planted' ? `Bomb planted at ${bomb.site} — defuse it (hold E)` : 'Defend sites A, B and C — stop the plant');
  setText(els['objective-line'], 'obj', obj);

  // Crosshair gap follows live spread.
  const gap = 8 + spread * 2600;
  els['crosshair'].style.setProperty('--gap', `${Math.min(46, gap).toFixed(0)}px`);

  // Interact prompt (plant / defuse progress).
  const prompt = interactPrompt();
  if (prompt) {
    els['interact-prompt'].classList.remove('hidden');
    els['interact-prompt'].innerHTML = prompt;
  } else {
    els['interact-prompt'].classList.add('hidden');
  }

  // Spectating line.
  if (!p.alive && state.spectateId >= 0) {
    const t = state.actors[state.spectateId];
    els['spectate-line'].classList.remove('hidden');
    setText(els['spectate-line'], 'spec', t ? `SPECTATING ${t.name} — your team fights on` : '');
  } else {
    els['spectate-line'].classList.add('hidden');
  }

  if (now > bannerUntil) els['round-banner'].classList.add('hidden');
  if (now > centerMsgUntil) els['center-msg'].classList.add('hidden');

  // Killfeed: last 5, expire after 5s.
  const recent = state.killfeed.filter((k) => now - k.at < 5).slice(-5);
  const html = recent.map((k) => `<div class="kill-line">${k.html}</div>`).join('');
  if (lastHud.kf !== html) { els['killfeed'].innerHTML = html; lastHud.kf = html; }

  // Radio: last 4 team callouts, expire after 6s.
  const chatter = state.radio.filter((r) => now - r.at < 6 && r.team === p.team).slice(-4);
  const radioHtml = chatter.map((r) => `<div class="radio-line"><b>▸</b> ${r.text}</div>`).join('');
  if (lastHud.radio !== radioHtml) { els['radio-feed'].innerHTML = radioHtml; lastHud.radio = radioHtml; }

  // Flash blindness: white screen that fades as flashUntil approaches.
  const blind = p.flashUntil > now ? Math.min(1, (p.flashUntil - now) * 1.4) : 0;
  if (lastHud.blind !== blind) {
    els['flash-vignette'].style.opacity = blind.toFixed(2);
    lastHud.blind = blind;
  }

  // Location callout under the minimap.
  setText(els['location-label'], 'loc', locationAt(p.pos.x, p.pos.z));

  if (scoreOpen) renderScoreboard();
  drawMinimap();
}

function interactPrompt() {
  const p = player();
  const bomb = state.bomb;
  if (!p.alive) return null;
  if (bomb.state === 'carried' && p.hasBomb) {
    for (const s of SITES) {
      if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) <= s.r) {
        const pct = Math.round((bomb.plantProgress / PLANT_TIME) * 100);
        return `HOLD <b>E</b> TO PLANT AT ${s.id}<div class="bar"><i style="width:${pct}%"></i></div>`;
      }
    }
  }
  if (bomb.state === 'planted' && p.team === defendingTeam()) {
    if (Math.hypot(p.pos.x - bomb.pos.x, p.pos.z - bomb.pos.z) <= 2.5) {
      const need = bomb.defuseNeed || DEFUSE_TIME;
      const pct = Math.round((bomb.defuseProgress / need) * 100);
      return `HOLD <b>E</b> TO DEFUSE${p.hasKit ? ' (KIT)' : ''}<div class="bar"><i style="width:${pct}%"></i></div>`;
    }
  }
  if (bomb.state === 'dropped' && p.team === attackingTeam()) {
    if (Math.hypot(p.pos.x - bomb.pos.x, p.pos.z - bomb.pos.z) < 4) {
      return 'Walk over the bomb to pick it up';
    }
  }
  return null;
}

// ---- minimap ----
function drawMinimap() {
  const g = minimapCtx;
  if (!g) return;
  const W = 176, H = 128;
  const sx = W / 64, sz = H / 44;
  const X = (x) => (x + 32) * sx;
  const Z = (z) => (z + 22) * sz;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(20,16,12,0.85)';
  g.fillRect(0, 0, W, H);
  // Walls / boxes.
  g.fillStyle = 'rgba(242,234,217,0.55)';
  for (const b of boxes) {
    if (b.maxY < 1.5) continue; // low crates don't show
    g.fillRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * sx, (b.maxZ - b.minZ) * sz);
  }
  // Sites.
  for (const s of SITES) {
    g.fillStyle = state.bomb.site === s.id && state.bomb.state === 'planted' ? '#ff5a3c' : 'rgba(255,182,72,0.8)';
    g.beginPath();
    g.arc(X(s.x), Z(s.z), s.r * sx * 0.8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#14100c';
    g.font = 'bold 9px sans-serif';
    g.textAlign = 'center';
    g.fillText(s.id, X(s.x), Z(s.z) + 3);
  }
  // Dropped bomb.
  if (state.bomb.state === 'dropped') {
    g.fillStyle = '#ff5a3c';
    g.fillRect(X(state.bomb.pos.x) - 3, Z(state.bomb.pos.z) - 3, 6, 6);
  }
  // Actors: player white, teammates green-ish, enemies only when recently seen.
  for (const a of state.actors) {
    if (!a.alive) continue;
    if (a.isPlayer) g.fillStyle = '#ffffff';
    else if (a.team === player().team) g.fillStyle = '#7ddb6a';
    else continue; // enemies stay hidden — no wallhack minimap
    g.beginPath();
    g.arc(X(a.pos.x), Z(a.pos.z), a.isPlayer ? 3.5 : 2.5, 0, Math.PI * 2);
    g.fill();
    if (a.isPlayer) {
      g.strokeStyle = '#fff';
      g.beginPath();
      g.moveTo(X(a.pos.x), Z(a.pos.z));
      g.lineTo(X(a.pos.x) - Math.sin(a.yaw) * 9, Z(a.pos.z) - Math.cos(a.yaw) * 9);
      g.stroke();
    }
  }
}
