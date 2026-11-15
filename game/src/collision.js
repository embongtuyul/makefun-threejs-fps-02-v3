// SANDLINE — collision.js: axis-aligned boxes for the whole map.
// raycastBoxes = nearest solid hit (bullets, sight); resolveCircle pushes
// a capsule out of every box. Both reuse module scratch: no per-call alloc.
export const boxes = [];
export function addBox(minX, minY, minZ, maxX, maxY, maxZ) {
  boxes.push({ minX, minY, minZ, maxX, maxY, maxZ });
  return boxes[boxes.length - 1];
}
export function clearBoxes() { boxes.length = 0; }

function rayBox(ox, oy, oz, dx, dy, dz, b) { // slab method; distance or Infinity
  let tmin = 0, tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < b.minX || ox > b.maxX) return Infinity;
  } else {
    let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < b.minY || oy > b.maxY) return Infinity;
  } else {
    let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < b.minZ || oz > b.maxZ) return Infinity;
  } else {
    let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// Nearest box hit along a ray; `out` receives the hit point. Ground (y=0) counts too.
const _hit = { dist: 0, box: null };
export function raycastBoxes(ox, oy, oz, dx, dy, dz, maxDist, out) {
  let best = Infinity, bestBox = null;
  for (let i = 0; i < boxes.length; i++) {
    const d = rayBox(ox, oy, oz, dx, dy, dz, boxes[i]);
    if (d < best && d <= maxDist) { best = d; bestBox = boxes[i]; }
  }
  if (dy < -1e-9) { // ground plane
    const d = -oy / dy;
    if (d >= 0 && d < best && d <= maxDist) { best = d; bestBox = null; }
  }
  if (best === Infinity) return null;
  if (out) { out.set(ox + dx * best, oy + dy * best, oz + dz * best); }
  _hit.dist = best; _hit.box = bestBox;
  return _hit;
}

export function hasLineOfSight(ax, ay, az, bx, by, bz) { // nothing solid between two points
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return true;
  const hit = raycastBoxes(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05, null);
  return hit === null;
}

// Highest walkable surface under a circle: ground (y=0) or a box top the
// capsule can step onto (at most STEP above its feet).
export const STEP_HEIGHT = 0.65;

export function groundHeightAt(x, z, radius, feetY) {
  let g = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.maxY > feetY + STEP_HEIGHT || b.maxY <= g) continue;
    if (b.minY > feetY + STEP_HEIGHT) continue;
    const cx = Math.max(b.minX, Math.min(x, b.maxX)); // circle vs box overlap in XZ
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz <= radius * radius) g = b.maxY;
  }
  return g;
}

// Push a vertical capsule out of every box it overlaps. Mutates `pos`
// (feet position). Returns true when a push happened. Low boxes (top within
// STEP_HEIGHT of the feet) don't block — player.js steps onto them.
export function resolveCircle(pos, radius, height) {
  let pushed = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (pos.y + height <= b.minY || pos.y + STEP_HEIGHT >= b.maxY) continue;
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 < 1e-8) {
      const pl = pos.x - b.minX, pr = b.maxX - pos.x; // centre inside: push out along smallest axis
      const pn = pos.z - b.minZ, pf = b.maxZ - pos.z;
      const m = Math.min(pl, pr, pn, pf);
      if (m === pl) pos.x = b.minX - radius;
      else if (m === pr) pos.x = b.maxX + radius;
      else if (m === pn) pos.z = b.minZ - radius;
      else pos.z = b.maxZ + radius;
    } else {
      const d = Math.sqrt(d2);
      const push = (radius - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    }
    pushed = true;
  }
  return pushed;
}

// Ray vs a vertical capsule (bot hitbox): cylinder + head sphere.
// Returns { dist, part } ('head' | 'body' | 'legs') or null.
export function rayCapsule(ox, oy, oz, dx, dy, dz, maxDist, cx, cz, feetY, height) {
  const radius = 0.42;
  const ex = ox - cx, ez = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return null;
  const b = 2 * (ex * dx + ez * dz);
  const c = ex * ex + ez * ez - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0 || t > maxDist) return null;
  const hitY = oy + dy * t;
  const rel = hitY - feetY;
  if (rel < 0 || rel > height) {
    return raySphere(ox, oy, oz, dx, dy, dz, maxDist, cx, feetY + height - 0.18, cz, 0.26, 'head'); // over/under: head sphere
  }
  const head = raySphere(ox, oy, oz, dx, dy, dz, maxDist, cx, feetY + height - 0.18, cz, 0.26, 'head'); // head takes priority
  if (head && head.dist <= t + 0.05) return head;
  const part = rel < height * 0.45 ? 'legs' : 'body';
  return { dist: t, part };
}

function raySphere(ox, oy, oz, dx, dy, dz, maxDist, sx, sy, sz, r, part) {
  const ex = ox - sx, ey = oy - sy, ez = oz - sz;
  const b = ex * dx + ey * dy + ez * dz;
  const c = ex * ex + ey * ey + ez * ez - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0 || t > maxDist) return null;
  return { dist: t, part };
}
