// SANDLINE — map.js: builds YARD-7, an original desert freight depot.
// 64 x 44 m, three bomb sites, three lanes (A Long, Mid, B Tunnel). Every
// solid structure registers an AABB collider in collision.js; meshes and
// colliders are created together so they can never drift apart. Textures are
// procedural canvas art (no external assets, no network).

import * as THREE from 'three';
import { addBox } from './collision.js';
import { mulberry32 } from './utils.js';

export const SITES = [
  { id: 'A', name: 'WAREHOUSE', x: 24, z: -14, r: 5.5 },
  { id: 'B', name: 'DEPOT', x: 24, z: 14, r: 5.5, ringY: 0.65 }, // ring sits on the platform
  { id: 'C', name: 'CRANE', x: 14, z: 0, r: 5.5 },
];

// Pre-aimed hold angles for defenders: a spot + the point it covers. A
// holder walks to its spot, aims at the point and PEEKS the lane (bots.js).
// One spot per bot, picked by actor id, so holders never stack.
export const HOLD_SPOTS = {
  A: [{ x: 19, z: -11, ax: 8, az: -14 }, { x: 20, z: -17, ax: 12, az: -16 }],
  B: [{ x: 19, z: 11, ax: 8, az: 14 }, { x: 20, z: 17, ax: 12, az: 16 }],
  C: [{ x: 17, z: -3, ax: 6, az: 0 }, { x: 17, z: 3, ax: 6, az: 0 }],
  MID: [{ x: 24, z: 0, ax: 6, az: 0 }],
};

// Named callout zones (rectangles, checked in order): the minimap shows
// the player's current callout; bot radio names locations ("contact, MID").
export const CALLOUTS = [
  { name: 'SITE A', x0: 15, z0: -20, x1: 32, z1: -8 },
  { name: 'SITE B', x0: 15, z0: 8, x1: 32, z1: 20 },
  { name: 'SITE C', x0: 8, z0: -7, x1: 20, z1: 7 },
  { name: 'A LONG', x0: -32, z0: -22, x1: 15, z1: -12 },
  { name: 'B TUNNEL', x0: -32, z0: 12, x1: 15, z1: 22 },
  { name: 'MID', x0: -8, z0: -12, x1: 15, z1: 12 },
  { name: 'ATTACK SPAWN', x0: -32, z0: -12, x1: -8, z1: 12 },
  { name: 'DEFEND SPAWN', x0: 15, z0: -8, x1: 32, z1: 8 },
  { name: 'YARD-7', x0: -32, z0: -22, x1: 32, z1: 22 },
];

export function locationAt(x, z) {
  for (const c of CALLOUTS) {
    if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return c.name;
  }
  return 'YARD-7';
}

export const SPAWNS = {
  attackers: [
    { x: -28, z: -4 }, { x: -28.5, z: 0 }, { x: -28, z: 4 }, { x: -26, z: -1 }, { x: -26, z: 8 },
  ],
  defenders: [
    { x: 28, z: -4 }, { x: 28.5, z: 0 }, { x: 28, z: 4 }, { x: 26, z: 1 }, { x: 26, z: -8 },
  ],
};

// Waypoint graph: bots walk these routes. Links are neighbour indices;
// nav.js symmetrises them and VALIDATES every edge (a bot capsule must fit
// along it), so links that cross a wall are pruned at build time. The two
// mid doors (28, 29) are the only east-west crossings — every lane funnels
// through them, which is what makes mid worth fighting over.
export const WAYPOINTS = [
  // id: 0-3 attacker spawn area
  { x: -28, z: 0, links: [3, 8] },
  { x: -26, z: -8, links: [0, 5] },
  { x: -22, z: 10, links: [0, 12] },
  { x: -22, z: 0, links: [0, 1] },
  // mid lane (west)
  { x: -16, z: 0, links: [6] },
  { x: -8, z: -3, links: [1, 6, 10] },
  { x: -3, z: 0, links: [4, 5, 28, 29] }, // mid doors west mouth
  { x: 6, z: 0, links: [11, 28, 29] }, // mid doors east mouth
  // A long (north) — a dead-end spur
  { x: -20, z: -14, links: [1, 9] },
  { x: -7, z: -13, links: [8, 5, 10] },
  { x: -3, z: -13, links: [9, 5] },
  { x: 8, z: -13, links: [7, 16, 17] },
  // B tunnel (south) — also a spur
  { x: -20, z: 13, links: [2, 4] },
  { x: -10, z: 18, links: [12] },
  { x: -8, z: 12, links: [13] },
  { x: 8, z: 10, links: [7, 21] },
  // site approaches + sites
  { x: 17, z: -12, links: [11, 17] },
  { x: 22, z: -14, links: [16] }, // site A
  { x: 17, z: 12, links: [15] },
  { x: 22, z: 14, links: [18] }, // site B
  { x: 26, z: -6, links: [26] },
  { x: 26, z: 8, links: [19, 25, 26] },
  { x: 28, z: 0, links: [20, 21] }, // defender spawn
  { x: 14, z: 0, links: [7] }, // site C / mid-east connector
  { x: 18, z: -6, links: [27] },
  { x: 18, z: 6, links: [18] },
  { x: 24, z: 0, links: [20, 21] }, // defender mid hold
  { x: 12, z: -8, links: [11, 24] },
  // mid doors: the east-west crossings (gaps in the x=0 wall)
  { x: 0, z: -6, links: [5, 6, 7, 23] }, // north door
  { x: 0, z: 6, links: [6, 7, 25] }, // south door
];

// ---- procedural canvas textures (seeded, identical every load) ----
function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function groundTexture() {
  return canvasTexture(512, (g, s) => {
    const rnd = mulberry32(7);
    g.fillStyle = '#b89a6b';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? 'rgba(120,90,50,0.16)' : 'rgba(230,205,160,0.14)';
      g.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    g.strokeStyle = 'rgba(90,66,36,0.35)'; // tyre tracks
    g.lineWidth = 9;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      const y = rnd() * s;
      g.moveTo(0, y);
      g.bezierCurveTo(s * 0.3, y + rnd() * 60 - 30, s * 0.7, y + rnd() * 60 - 30, s, y);
      g.stroke();
    }
    g.fillStyle = 'rgba(220,150,40,0.5)'; // painted hazard stripe
    g.fillRect(0, s * 0.48, s, 6);
  }, 8);
}

function wallTexture(base, line) {
  return canvasTexture(256, (g, s) => {
    const rnd = mulberry32(21);
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`;
      g.fillRect(rnd() * s, rnd() * s, 2 + rnd() * 6, 2 + rnd() * 6);
    }
    g.strokeStyle = line;
    g.lineWidth = 3;
    g.strokeRect(2, 2, s - 4, s - 4);
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.stroke();
  }, 2);
}

function makeTextSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.font = '900 84px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, 128, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.set(4, 2, 1);
  return s;
}

// ---- map build ----
const _boxGeo = new THREE.BoxGeometry(1, 1, 1);

export function buildMap(scene) {
  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTexture('#8d8578', 'rgba(0,0,0,0.25)'), roughness: 0.95 }),
    wallDark: new THREE.MeshStandardMaterial({ map: wallTexture('#6e675c', 'rgba(0,0,0,0.3)'), roughness: 0.95 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x9a4a28, roughness: 0.8, metalness: 0.35 }),
    teal: new THREE.MeshStandardMaterial({ color: 0x2e7f86, roughness: 0.7, metalness: 0.4 }),
    sandbag: new THREE.MeshStandardMaterial({ color: 0xa88f5e, roughness: 1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a352e, roughness: 0.9 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xe8912d, roughness: 0.6, metalness: 0.2 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd977, emissiveIntensity: 2.2 }),
  };

  // One helper for every solid: mesh + matching collider, never drifting.
  function solid(mat, cx, cy, cz, sx, sy, sz, collider = true) {
    const m = new THREE.Mesh(_boxGeo, mat);
    m.position.set(cx, cy, cz);
    m.scale.set(sx, sy, sz);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    if (collider) addBox(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2);
    return m;
  }

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  solid(mats.wall, 0, 2, -22, 64, 4, 1); // perimeter walls (height 4)
  solid(mats.wall, 0, 2, 22, 64, 4, 1);
  solid(mats.wall, -32, 2, 0, 1, 4, 44);
  solid(mats.wall, 32, 2, 0, 1, 4, 44);

  // Mid wall (x = 0) with two door gaps at z = -6 and z = +6, plus a window.
  solid(mats.wallDark, 0, 2, -15.5, 1, 4, 13);
  solid(mats.wallDark, 0, 2, 15.5, 1, 4, 13);
  solid(mats.wallDark, 0, 2, 0, 1, 4, 7);
  solid(mats.wallDark, 0, 3.4, -6, 1, 1.2, 3); // lintel over north door
  solid(mats.wallDark, 0, 3.4, 6, 1, 1.2, 3); // lintel over south door

  // Site A — warehouse: three walls + roof, open to the west.
  solid(mats.wall, 26.5, 2.5, -14, 1, 5, 12);
  solid(mats.wall, 21, 2.5, -19.5, 12, 5, 1);
  solid(mats.wall, 21, 2.5, -8.5, 12, 5, 1);
  solid(mats.wallDark, 21, 5.2, -14, 12, 0.4, 12, false);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.6, 20), mats.teal); // fuel tank prop
  tank.position.set(26, 1.3, -17.5); tank.castShadow = true; scene.add(tank);
  addBox(24.4, 0, -19.1, 27.6, 2.6, -15.9);

  // Site B — depot: raised platform + container stack, open to the west.
  solid(mats.wallDark, 24, 0.3, 14, 12, 0.6, 11); // step-on platform
  solid(mats.rust, 28.5, 1.9, 14, 1.2, 2.6, 8);
  solid(mats.teal, 24, 1.9, 18.5, 8, 2.6, 1.2);

  // Site C — crane yard: a gantry frame, flanking containers and sandbags
  // on open mid-east ground. The plant circle itself stays clear.
  solid(mats.dark, 10, 2.5, -4.5, 0.5, 5, 0.5);
  solid(mats.dark, 10, 2.5, 4.5, 0.5, 5, 0.5);
  solid(mats.amber, 10, 5.2, 0, 0.5, 0.5, 9.5, false); // gantry beam, no collider
  solid(mats.teal, 21, 1.3, -9, 2.4, 2.6, 6);
  solid(mats.rust, 20, 1.3, 2, 2.4, 2.6, 6);
  solid(mats.sandbag, 11, 0.55, -4, 2.4, 1.1, 0.8);
  solid(mats.sandbag, 11, 0.55, 4, 2.4, 1.1, 0.8);

  // Containers as lane cover (6 x 2.6 x 2.4).
  const containers = [
    [-14, -10, 0], [-14, 10, 0], [4, -12, 1], [4, 12, 1],
    [-6, -18, 0], [12, -17, 1], [-6, 18, 1], [12, 17, 0],
    [-20, 0, 1], [18, 0, 0],
  ];
  for (const [x, z, rot] of containers) {
    // rot = 1 turns the container 90 degrees: swap its footprint so the
    // collider matches the mesh (no rotated colliders anywhere).
    const sx = rot ? 2.4 : 6, sz = rot ? 6 : 2.4;
    solid(rot ? mats.teal : mats.rust, x, 1.3, z, sx, 2.6, sz);
  }

  const crates = [ // 1.2 m cubes, step-on height for vantage
    [-10, -6], [-9, -5], [-10, 6], [8, -4], [8, 4], [20, -10],
    [20, 10], [-2, -14], [-2, 14], [26, -11], [26, 11], [-24, -12],
    [-24, 12], [14, -3], [14, 3],
  ];
  for (const [x, z] of crates) {
    solid(mats.sandbag, x, 0.6, z, 1.2, 1.2, 1.2);
    if ((x * 7 + z * 13) % 3 === 0) solid(mats.sandbag, x + 0.2, 1.8, z + 0.1, 1.2, 1.2, 1.2);
  }

  for (const [x, z] of [[-4, -6], [-4, 6], [16, -8], [16, 8], [-18, -16], [-18, 16]]) { // sandbag lines at lane mouths
    solid(mats.sandbag, x, 0.55, z, 2.4, 1.1, 0.8);
  }

  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12); // barrels
  for (const [x, z] of [[-12, -2], [-11, -1], [10, -8], [10, 8], [26, 0], [-26, 6]]) {
    const b = new THREE.Mesh(barrelGeo, mats.rust);
    b.position.set(x, 0.55, z); b.castShadow = true; scene.add(b);
    addBox(x - 0.45, 0, z - 0.45, x + 0.45, 1.1, z + 0.45);
  }

  const poleGeo = new THREE.CylinderGeometry(0.09, 0.09, 5.5, 8); // light poles with glowing lamps
  for (const [x, z] of [[-16, -12], [-16, 12], [8, -14], [8, 14], [24, -4], [24, 4]]) {
    const p = new THREE.Mesh(poleGeo, mats.dark);
    p.position.set(x, 2.75, z); scene.add(p);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), mats.lamp);
    lamp.position.set(x, 5.6, z); scene.add(lamp);
    addBox(x - 0.1, 0, z - 0.1, x + 0.1, 5.5, z + 0.1);
  }

  // Site markers: glowing ring + floating letter.
  for (const site of SITES) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.25, site.r, 48),
      new THREE.MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, site.ringY || 0.05, site.z);
    scene.add(ring);
    const sprite = makeTextSprite(site.id, '#ffb648');
    sprite.position.set(site.x, 4.6, site.z);
    scene.add(sprite);
    const board = makeTextSprite(site.name, '#f2ead9'); // site name board
    board.scale.set(6, 1.2, 1);
    board.position.set(site.x, 3.4, site.z);
    scene.add(board);
  }

  const skyGeo = new THREE.SphereGeometry(180, 16, 12); // sky dome gradient
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x7fa8c9) },
      mid: { value: new THREE.Color(0xd8b98a) },
      bot: { value: new THREE.Color(0x8a6f4d) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot; void main(){ float h = normalize(vP).y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(bot, mid, smoothstep(-0.1, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  const sun = new THREE.DirectionalLight(0xffd9a0, 2.6); // golden-hour lighting
  sun.position.set(-30, 42, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9db8d6, 0x8a6f4d, 0.9));
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.5);
  fill.position.set(30, 20, 20);
  scene.add(fill);

  scene.fog = new THREE.Fog(0xd8b98a, 55, 130);

  const duneMat = new THREE.MeshStandardMaterial({ color: 0xa8895c, roughness: 1 }); // distant dunes + water tower
  for (let i = 0; i < 7; i++) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(18 + i * 3, 12, 8), duneMat);
    d.scale.y = 0.22;
    d.position.set(-60 + i * 22, -1, -45 - (i % 3) * 8);
    scene.add(d);
  }
  const tower = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 12, 6), mats.dark);
  legs.position.y = 6; tower.add(legs);
  const tankTop = new THREE.Mesh(new THREE.SphereGeometry(3.2, 14, 10), mats.rust);
  tankTop.position.y = 13; tankTop.scale.y = 0.8; tower.add(tankTop);
  tower.position.set(48, 0, -30);
  scene.add(tower);
}

