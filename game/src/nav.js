// SANDLINE — nav.js: A* pathfinding over the waypoint graph.
// Edges are VALIDATED once (a bot capsule must fit along the whole
// segment — no wall, crate or barrel in the way), so a path never leads
// through a wall. A* costs edges by length x danger: recent deaths and
// spotted enemies raise the price, so bots route around hot lanes. The raw
// path is SMOOTHED by string-pulling — any waypoint you can walk straight
// to is skipped, so bots cut corners instead of zig-zagging the graph.

import { WAYPOINTS } from './map.js';
import { boxes } from './collision.js';
import { dist2D } from './utils.js';

const R = 0.42; // bot capsule radius (+ a little slack)
let edges = null; // validated adjacency: edges[i] = [j, ...]
const danger = new Map(); // waypoint id -> { w, until }

// A capsule fits at (x,z) when no blocking box overlaps it. Boxes shorter
// than the step height (platforms) and boxes above head height (lintels,
// roofs) never block.
function pointClear(x, z) {
  for (const b of boxes) {
    if (b.maxY <= 0.65 || b.minY >= 1.75) continue;
    const cx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
    const cz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < R * R) return false;
  }
  return true;
}

// A whole segment is walkable when a capsule fits at every sample along it.
export function edgeClear(a, b) {
  const A = WAYPOINTS[a], B = WAYPOINTS[b];
  const len = dist2D(A.x, A.z, B.x, B.z);
  const n = Math.max(2, Math.ceil(len / 0.8));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!pointClear(A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t)) return false;
  }
  return true;
}

// Build the validated graph once: links are symmetrised (a link either way
// is an edge both ways) and every edge is walkability-checked.
function buildEdges() {
  edges = WAYPOINTS.map(() => []);
  for (let i = 0; i < WAYPOINTS.length; i++) {
    for (const j of WAYPOINTS[i].links) {
      if (j === i || j < 0 || j >= WAYPOINTS.length) continue;
      if (edges[i].includes(j)) continue;
      if (!edgeClear(i, j)) continue;
      edges[i].push(j);
      edges[j].push(i);
    }
  }
}

export function navEdges() {
  if (!edges) buildEdges();
  return edges;
}

export function nearestWaypoint(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i].x - x, dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Mark a spot dangerous for 25s (a teammate died here, an enemy was seen).
export function markDanger(x, z, w, now) {
  const id = nearestWaypoint(x, z);
  const cur = danger.get(id);
  if (!cur || cur.w < w) danger.set(id, { w, until: now + 25 });
}

function dangerAt(id, now) {
  const d = danger.get(id);
  if (!d) return 0;
  if (now > d.until) { danger.delete(id); return 0; }
  return d.w;
}

// A* from waypoint `from` to `to`. Edge cost is length x (1 + danger), so
// routes bend around hot lanes. Returns the SMOOTHED path (see below), or
// [from, to] when no route exists.
export function findPath(from, to, now = 0) {
  if (from === to) return [from];
  const E = navEdges();
  const n = WAYPOINTS.length;
  const g = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const closed = new Array(n).fill(false);
  const h = (i) => dist2D(WAYPOINTS[i].x, WAYPOINTS[i].z, WAYPOINTS[to].x, WAYPOINTS[to].z);
  g[from] = 0;
  const open = [from];
  while (open.length) {
    // Cheapest f-score first (30 nodes: a linear scan beats a heap here).
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if (g[open[i]] + h(open[i]) < g[open[bi]] + h(open[bi])) bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    if (cur === to) break;
    if (closed[cur]) continue;
    closed[cur] = true;
    for (const nb of E[cur]) {
      if (closed[nb]) continue;
      const cost = dist2D(WAYPOINTS[cur].x, WAYPOINTS[cur].z, WAYPOINTS[nb].x, WAYPOINTS[nb].z)
        * (1 + dangerAt(nb, now) * 2);
      if (g[cur] + cost < g[nb]) {
        g[nb] = g[cur] + cost;
        prev[nb] = cur;
        if (!open.includes(nb)) open.push(nb);
      }
    }
  }
  if (prev[to] === -1) return [from, to];
  const path = [to];
  for (let p = prev[to]; p !== -1; p = prev[p]) path.unshift(p);
  return smoothPath(path);
}

// String-pulling: from each waypoint, skip ahead as far as the bot can walk
// in a straight line. Corners get cut, paths get shorter.
export function smoothPath(path) {
  if (path.length < 3) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !edgeClear(path[i], path[j])) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}

// Debug snapshot for the playtest: edge count and connected components.
export function navDebug() {
  const E = navEdges();
  const seen = new Set();
  const comps = [];
  for (let i = 0; i < E.length; i++) {
    if (seen.has(i)) continue;
    const comp = [];
    const q = [i];
    seen.add(i);
    while (q.length) {
      const c = q.pop();
      comp.push(c);
      for (const nb of E[c]) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length); // largest first
  return {
    waypoints: E.length,
    edges: E.reduce((s, l) => s + l.length, 0) / 2,
    components: comps,
  };
}
