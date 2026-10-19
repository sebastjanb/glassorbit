/* Glass Orbit — anti-gravity racing for Meta Ray-Ban Display glasses.
   WebGL circuits hung in space: glowing edges, red-and-white barriers,
   gantries, speed pads, and a planet, a ring station or an asteroid belt
   around them. Five rivals drive a racing line.
     Left / Right   move across the track (or tilt / turn your head)
     Up             boost (uses a third of the energy bar)
     Down           airbrake: tighter turns, less speed
     Pinch          pause, menus
   Three laps; a top-three finish opens the next circuit. Time trial keeps a
   best lap per circuit. */

import { THREE, makeRenderer, canvasTexture, glowSprite, starfield, buildTrack, along, trackPoint, trackStrip, trackMatrix, leftOf, chaseCamera, frameClock, hudText } from './kit3d.js';

const VERSION = '3.0.0';
const { g, label, clamp, lerp, rand, beep, noise, head, store } = GK;

const HW = 9;                 // half track width, m
const MAX = 108;              // top speed, m/s (≈ 390 km/h on the readout)
const ACCEL = 34, BRAKE = 60;
const GRIP = 52;              // sideways acceleration the ship holds without drifting wide, m/s²
const LAPS = 3, RIVALS = 5;
const TEAMS = [
  { tag: 'YOU', body: 0xf2f4f8, trim: 0xe0301e, bar: '#ff5a3a' },
  { tag: 'VOL', body: 0xff8a2a, trim: 0x222222, bar: '#ff8a2a' },
  { tag: 'MER', body: 0x3a6aff, trim: 0xffffff, bar: '#5a8aff' },
  { tag: 'VER', body: 0x2ad07a, trim: 0x0a3a20, bar: '#3ae08a' },
  { tag: 'HAL', body: 0xff4ab0, trim: 0x2a0a20, bar: '#ff6ac0' },
  { tag: 'OBS', body: 0xffd23a, trim: 0x3a2a00, bar: '#ffd34d' },
];

/* -------------------------------------------------------------- circuits */

// Control points [x, z, height] in metres; each circuit has a scene around it.
const CIRCUITS = [
  { name: 'Lunar Loop', theme: 'moon', edge: 0x4ab4ff, skill: 0.9,
    pts: [[0, 0, 0], [420, -40, 10], [640, 140, 30], [560, 420, 20], [300, 470, -10], [120, 640, 0], [-200, 600, 25], [-330, 330, 10], [-260, 90, -5]] },
  { name: 'Ring Station', theme: 'ring', edge: 0xc07aff, skill: 0.93,
    pts: [[0, 0, 0], [380, 0, 0], [560, 180, 40], [400, 360, 60], [520, 560, 30], [260, 700, 0], [-60, 560, -20], [-120, 300, 10], [-300, 160, 30], [-180, -40, 10]] },
  { name: 'Asteroid Belt', theme: 'rocks', edge: 0xffa04a, skill: 0.96,
    pts: [[0, 0, 0], [300, 60, 20], [520, -60, 50], [700, 160, 20], [560, 380, -10], [700, 600, 20], [420, 720, 40], [180, 520, 10], [-60, 640, -20], [-280, 420, 0], [-180, 160, 20]] },
  { name: 'Gas Giant', theme: 'giant', edge: 0x3affc8, skill: 0.99,
    pts: [[0, 0, 0], [460, 40, 30], [700, 300, 60], [480, 520, 20], [620, 760, 0], [300, 860, 40], [40, 620, 10], [-260, 760, -20], [-420, 480, 20], [-200, 220, 40]] },
  { name: 'Solar Rim', theme: 'sun', edge: 0xff6a3a, skill: 1.02,
    pts: [[0, 0, 0], [360, -80, 20], [580, 120, 0], [420, 300, 40], [640, 520, 20], [400, 700, -10], [100, 560, 30], [-140, 740, 10], [-380, 520, 40], [-260, 240, 0]] },
  { name: 'Deep Nebula', theme: 'nebula', edge: 0xff4ad0, skill: 1.05,
    pts: [[0, 0, 0], [300, 80, 30], [520, -40, 70], [760, 200, 30], [600, 420, 0], [760, 640, 40], [480, 820, 70], [200, 640, 20], [-40, 820, 0], [-320, 620, 40], [-260, 340, 60], [-420, 120, 20]] },
];

/* -------------------------------------------------------------- renderer */

const renderer = makeRenderer();
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 300, 1400);
const camera = new THREE.PerspectiveCamera(68, 1, 0.5, 9000);
const chase = chaseCamera(camera);
const clock = frameClock();
scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x202030, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(300, 500, 200);
scene.add(sun);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const stars = starfield(1400, 4000, 0xdfe8ff, 1.6);
scene.add(stars);

// Painted sky: soft nebula clouds and a dense star field on a dome that travels with the camera.
const NEB = {
  moon: ['#0a1838', '#2a3a7a', '#5a7ac8'], ring: ['#160a30', '#4a2a8a', '#9a6ad8'], rocks: ['#200e08', '#6a3418', '#c87a3a'],
  giant: ['#04181c', '#0e5a5a', '#4ac8aa'], sun: ['#200806', '#7a2010', '#ff9a4a'], nebula: ['#180626', '#7a1a7a', '#ff5ad8'],
};
function nebulaTexture(cols) {
  return canvasTexture(1024, 512, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * w, y = h * (0.15 + Math.random() * 0.7), r = 60 + Math.random() * 220;
      const grd = c.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, cols[i % 3]); grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = 0.12 + Math.random() * 0.18; c.fillStyle = grd; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 3500; i++) { const b = Math.random(); c.fillStyle = `rgba(255,255,255,${b * b})`; c.fillRect(Math.random() * w, Math.random() * h, b > 0.95 ? 2 : 1, b > 0.95 ? 2 : 1); }
  });
}
const dome = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false }));
scene.add(dome);

// Speed streaks: thin lines that rush past the camera at high speed.
const STREAKS = 70;
const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.012, 2.5), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), STREAKS);
streaks.frustumCulled = false;
scene.add(streaks);
const streakPos = [];
for (let i = 0; i < STREAKS; i++) { const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 10; streakPos.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.7, -Math.random() * 60)); }

// Engine trails: fading ribbons behind every ship.
class Trail {
  constructor(colour, width) {
    this.n = 28; this.width = width; this.pts = [];
    const g2 = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 2 * 3); this.col = new Float32Array(this.n * 2 * 3);
    g2.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g2.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx = [];
    for (let i = 0; i < this.n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g2.setIndex(idx);
    this.mesh = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.c = new THREE.Color(colour);
    scene.add(this.mesh);
  }
  push(p, side) {
    this.pts.unshift([p.x, p.y, p.z, side.x, side.y, side.z]);
    if (this.pts.length > this.n) this.pts.pop();
    for (let i = 0; i < this.n; i++) {
      const q = this.pts[Math.min(i, this.pts.length - 1)] || [p.x, p.y, p.z, 0, 0, 0];
      const f = 1 - i / this.n, w = this.width * (0.3 + f * 0.7);
      this.pos.set([q[0] + q[3] * w, q[1] + q[4] * w, q[2] + q[5] * w, q[0] - q[3] * w, q[1] - q[4] * w, q[2] - q[5] * w], i * 6);
      const k = f * f * 0.45;
      this.col.set([this.c.r * k, this.c.g * k, this.c.b * k, this.c.r * k, this.c.g * k, this.c.b * k], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
  reset() { this.pts.length = 0; }
}

/* -------------------------------------------------------------- textures */

const surfaceTex = canvasTexture(256, 256, (c, w, h) => {
  c.fillStyle = '#1b1e26'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 2;
  for (let y = 0; y < h; y += 64) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.fillStyle = 'rgba(255,255,255,.55)';
  for (const x of [w / 3, (2 * w) / 3]) for (let y = 8; y < h; y += 64) c.fillRect(x - 2, y, 4, 28);
}, true);

const barrierTex = canvasTexture(256, 32, (c, w, h) => {
  c.fillStyle = '#f2f2f2'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#e0301e';
  for (let x = -h; x < w; x += 32) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 16, h); c.lineTo(x + 16 + h, 0); c.lineTo(x + h, 0); c.closePath(); c.fill(); }
}, true);

const padTex = canvasTexture(64, 128, (c, w, h) => {
  c.fillStyle = 'rgba(0,0,0,0)'; c.clearRect(0, 0, w, h);
  c.fillStyle = '#7cffe0';
  for (let i = 0; i < 3; i++) { const y = 10 + i * 38; c.beginPath(); c.moveTo(6, y + 30); c.lineTo(32, y); c.lineTo(58, y + 30); c.lineTo(48, y + 30); c.lineTo(32, y + 12); c.lineTo(16, y + 30); c.closePath(); c.fill(); }
});

const chequerTex = canvasTexture(64, 16, (c) => {
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) { c.fillStyle = (x + y) % 2 ? '#111' : '#f2f2f2'; c.fillRect(x * 8, y * 8, 8, 8); }
});

/* ----------------------------------------------------------------- ships */

function makeShip(team) {
  const ship = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: team.body, metalness: 0.5, roughness: 0.35, emissive: team.body, emissiveIntensity: 0.12 });
  const trim = new THREE.MeshStandardMaterial({ color: team.trim, metalness: 0.4, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x182030, metalness: 0.8, roughness: 0.1 });
  // Hull: a low wedge seen from the side, extruded across the width.
  const side = new THREE.Shape();
  [[-2.4, 0.15], [-2.5, 0.6], [-1.2, 0.75], [1.6, 0.42], [2.8, 0.18], [2.6, 0.05], [-2.2, 0.0]].forEach(([z, y], i) => (i ? side.lineTo(z, y) : side.moveTo(z, y)));
  const hullG = new THREE.ExtrudeGeometry(side, { depth: 1.5, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 2 });
  hullG.translate(0, 0, -0.75); hullG.rotateY(-Math.PI / 2);
  ship.add(new THREE.Mesh(hullG, body));
  // Wings: flat swept plates with the team's trim colour on the tips.
  const wing = new THREE.Shape();
  [[0, 0.8], [2.2, -1.4], [2.2, -2.3], [0, -1.8]].forEach(([x, z], i) => (i ? wing.lineTo(x, z) : wing.moveTo(x, z)));
  const wingG = new THREE.ExtrudeGeometry(wing, { depth: 0.12, bevelEnabled: false });
  wingG.rotateX(Math.PI / 2);
  for (const sx of [1, -1]) {
    const w = new THREE.Mesh(wingG, body); w.scale.x = sx; w.position.set(sx * 0.6, 0.32, 0); ship.add(w);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 1.2), trim); tip.position.set(sx * 2.75, 0.55, -1.8); ship.add(tip);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 1.1), trim); fin.position.set(sx * 0.55, 1.05, -1.9); fin.rotation.x = -0.35; ship.add(fin);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 3.4), trim); stripe.position.set(0, 0.78, 0.2); stripe.rotation.x = 0.1; ship.add(stripe);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(1, 0.9, 1.6); canopy.position.set(0, 0.7, -0.6); ship.add(canopy);
  // Engine: white-hot nozzle and a glow that grows with the throttle.
  const nozzle = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.35, 0.12), new THREE.MeshBasicMaterial({ color: 0xe8f6ff }));
  nozzle.position.set(0, 0.42, -2.55); ship.add(nozzle);
  ship.flame = glowSprite(0x9ad8ff, 3.2); ship.flame.position.set(0, 0.42, -2.9); ship.add(ship.flame);
  // Hover glow under the hull.
  const under = glowSprite(team.body, 4); under.position.set(0, -0.2, 0); under.material.opacity = 0.35; ship.add(under);
  scene.add(ship);
  return ship;
}

/* ----------------------------------------------------------------- world */

let T = null, world = null, circuit = CIRCUITS[0], pads = [], edgeLights = null, edgeLightN = 0;
const signMats = {};
function signMat(c) {
  if (signMats[c.name]) return signMats[c.name];
  const tex = canvasTexture(512, 76, (x, w, h) => {
    x.fillStyle = '#0a0e16'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#' + new THREE.Color(c.edge).getHexString(); x.fillRect(0, 0, w, 5); x.fillRect(0, h - 5, w, 5);
    x.font = 'italic 900 40px Helvetica, Arial'; x.textAlign = 'left'; x.fillStyle = '#fff'; x.fillText('ORB', 20, 54); x.fillStyle = '#ff5a3a'; x.fillText('IT', 104, 54);
    x.font = '800 30px Helvetica, Arial'; x.textAlign = 'right'; x.fillStyle = '#' + new THREE.Color(c.edge).getHexString(); x.fillText(c.name.toUpperCase(), w - 20, 50);
  });
  return (signMats[c.name] = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
}

function buildWorld(c) {
  if (world) { scene.remove(world); world.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  circuit = c;
  T = buildTrack(c.pts.map(([x, z, y]) => [x, z, y]), 3, 22);
  world = new THREE.Group();
  const N = T.N;
  const surf = new THREE.Mesh(trackStrip(T, HW, -HW, 0, 0, 24), new THREE.MeshLambertMaterial({ map: surfaceTex, side: THREE.DoubleSide }));
  world.add(surf);
  // Thickness under the deck, so it reads as a floating slab.
  world.add(new THREE.Mesh(trackStrip(T, HW + 1, -HW - 1, -1.2, -1.2), new THREE.MeshLambertMaterial({ color: 0x0c0e14, side: THREE.DoubleSide })));
  for (const side of [1, -1]) {
    world.add(new THREE.Mesh(trackStrip(T, side * HW, side * HW, 0, -1.2), new THREE.MeshLambertMaterial({ color: 0x14161c, side: THREE.DoubleSide })));
    // Glowing edge line and the barrier wall.
    world.add(new THREE.Mesh(trackStrip(T, side * (HW - 0.2), side * (HW - 0.9), 0.03, 0.03), new THREE.MeshBasicMaterial({ color: c.edge, side: THREE.DoubleSide })));
    const wall = new THREE.Mesh(trackStrip(T, side * (HW + 0.4), side * (HW + 0.4), 0, 1.3, 16), new THREE.MeshBasicMaterial({ map: barrierTex, side: THREE.DoubleSide }));
    world.add(wall);
    world.add(new THREE.Mesh(trackStrip(T, side * (HW + 0.4), side * (HW + 0.4), 1.3, 1.45), new THREE.MeshBasicMaterial({ color: c.edge, side: THREE.DoubleSide })));
  }
  // Gantries over the track every 240 m, with a bright strip and lamps.
  const gantryMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.6, roughness: 0.4 });
  const stripMat = new THREE.MeshBasicMaterial({ color: c.edge });
  for (let s = 60; s < T.len; s += 240) {
    const grp = new THREE.Group();
    for (const side of [1, -1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 12, 0.8), gantryMat); post.position.set(side * (HW + 1.4), 6, 0); grp.add(post); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * HW + 3.6, 1.2, 1.2), gantryMat); beam.position.y = 12; grp.add(beam);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2 * HW + 3.6, 0.25, 0.2), stripMat); strip.position.set(0, 11.3, -0.62); grp.add(strip);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.8), signMat(c)); sign.position.set(0, 13.5, -0.7); sign.rotation.y = Math.PI; grp.add(sign);
    const signBack = sign.clone(); signBack.position.z = 0.7; signBack.rotation.y = 0; grp.add(signBack);
    const box = new THREE.Mesh(new THREE.BoxGeometry(12.4, 2.2, 1.2), gantryMat); box.position.y = 13.5; grp.add(box);
    grp.applyMatrix4(trackMatrix(T, s, 0));
    world.add(grp);
  }
  // Truss under the deck: a lower chord either side and diagonal struts, lit from below.
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a3040, metalness: 0.7, roughness: 0.4 });
  for (const side of [1, -1]) world.add(new THREE.Mesh(trackStrip(T, side * (HW - 1), side * (HW - 1.6), -6, -6.6), steel));
  const strutN = Math.ceil(T.len / 12) * 2;
  const struts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 6.4, 0.35), steel, strutN);
  let sc = 0;
  for (let s = 0; s < T.len; s += 12) for (const side of [1, -1]) {
    const m = trackMatrix(T, s, side * (HW - 1.2), -3.6).clone().multiply(new THREE.Matrix4().makeRotationX((Math.floor(s / 12) % 2 ? 1 : -1) * 0.75));
    struts.setMatrixAt(sc++, m);
  }
  struts.count = sc; world.add(struts);
  const underGlow = new THREE.Mesh(trackStrip(T, HW - 1, -HW + 1, -6.7, -6.7), new THREE.MeshBasicMaterial({ color: c.edge, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  world.add(underGlow);
  // Tall pylons now and then, down into space.
  const pylon = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 80, 1.4), steel, Math.ceil(T.len / 270) * 2);
  let pc = 0;
  for (let s = 0; s < T.len; s += 270) for (const side of [1, -1]) { const p = trackPoint(T, s, side * (HW - 2), -46); pylon.setMatrixAt(pc++, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)); }
  pylon.count = pc; world.add(pylon);
  // Chasing lights set into both edges of the deck.
  edgeLightN = Math.floor(T.len / 8) * 2;
  edgeLights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.1, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff }), edgeLightN);
  let ec = 0;
  for (let s = 0; s < T.len - 4; s += 8) for (const side of [1, -1]) { edgeLights.setMatrixAt(ec, trackMatrix(T, s, side * (HW - 0.55), 0.08)); edgeLights.setColorAt(ec, new THREE.Color(c.edge)); ec++; }
  edgeLights.count = edgeLightN = ec;
  world.add(edgeLights);
  // Speed pads: glowing arrows on a third of the track width.
  pads = [];
  const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  for (let s = 400; s < T.len - 100; s += 520) {
    const lane = ((s / 520) | 0) % 3 - 1;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 10), padMat);
    m.rotation.x = -Math.PI / 2;
    const grp = new THREE.Group(); grp.add(m); grp.position.y = 0.06;
    grp.applyMatrix4(trackMatrix(T, s, lane * 6));
    world.add(grp);
    pads.push({ s, off: lane * 6 });
  }
  const start = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, 2.5), new THREE.MeshBasicMaterial({ map: chequerTex, side: THREE.DoubleSide }));
  start.rotation.x = -Math.PI / 2;
  const sg = new THREE.Group(); sg.add(start); sg.position.y = 0.05; sg.applyMatrix4(trackMatrix(T, 0, 0)); world.add(sg);
  buildTheme(c);
  dome.material.map = nebulaTexture(NEB[c.theme]); dome.material.needsUpdate = true;
  scene.add(world);
}

function planetTexture(cols) {
  return canvasTexture(512, 256, (c, w, h) => {
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const k = Math.floor((t * cols.length * 2 + Math.sin(t * 40) * 0.6)) % cols.length;
      c.fillStyle = cols[(k + cols.length) % cols.length]; c.fillRect(0, y, w, 1);
    }
    for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`; c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 6 + Math.random() * 30, 2 + Math.random() * 5, 0, 0, Math.PI * 2); c.fill(); }
  });
}

function buildTheme(c) {
  const before = world.children.length;
  themeObjects(c);
  // Backdrop pieces are far beyond the fog: they must ignore it or they vanish.
  for (const o of world.children.slice(before)) o.traverse((m) => { if (m.material) m.material.fog = false; });
}

function themeObjects(c) {
  const cx = 200, cz = 380;
  const t = c.theme;
  if (t === 'moon' || t === 'giant') {
    const tex = t === 'moon' ? planetTexture(['#8a96a8', '#6a7688', '#a8b2c0', '#5a6476']) : planetTexture(['#2a8a7a', '#3ab89a', '#1a5a5a', '#5ad0b0', '#2a6a6a']);
    const planet = new THREE.Mesh(new THREE.SphereGeometry(t === 'moon' ? 700 : 1500, 48, 32), new THREE.MeshLambertMaterial({ map: tex }));
    planet.position.set(cx + 900, -700, cz + 4200);
    world.add(planet);
    const atm = glowSprite(t === 'moon' ? 0x8ab0ff : 0x5affd0, (t === 'moon' ? 700 : 1500) * 2.7); atm.material.opacity = 0.55; atm.position.copy(planet.position); world.add(atm);
    if (t === 'giant') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(1900, 2600, 96), new THREE.MeshBasicMaterial({ color: 0x8ad8c8, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      ring.position.copy(planet.position); ring.rotation.x = -1.35; world.add(ring);
    }
  } else if (t === 'ring') {
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1400, 90, 16, 120), new THREE.MeshStandardMaterial({ color: 0x8a90a8, metalness: 0.7, roughness: 0.4 }));
    torus.position.set(cx, 300, cz); torus.rotation.x = 1.35; world.add(torus);
    const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(30, 8, 8), new THREE.MeshBasicMaterial({ color: 0xc07aff }), 120);
    for (let i = 0; i < 120; i++) { const a = i / 120 * Math.PI * 2; const v = new THREE.Vector3(Math.cos(a) * 1400, Math.sin(a) * 1400, 92).applyEuler(torus.rotation).add(torus.position); lights.setMatrixAt(i, new THREE.Matrix4().makeTranslation(v.x, v.y, v.z)); }
    world.add(lights);
    const planet = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 24), new THREE.MeshLambertMaterial({ map: planetTexture(['#3a5a9a', '#2a4a7a', '#5a7aba']) }));
    planet.position.set(cx - 2200, -400, cz + 3600); world.add(planet);
    const atm = glowSprite(0x6a9aff, 1350); atm.material.opacity = 0.55; atm.position.copy(planet.position); world.add(atm);
  } else if (t === 'rocks') {
    const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x6a5a48 }), 420);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 420; i++) {
      const a = Math.random() * Math.PI * 2, r = 700 + Math.random() * 1600;
      const sz = 6 + Math.random() * 60;
      e.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); q.setFromEuler(e);
      m.compose(new THREE.Vector3(cx + Math.cos(a) * r, -80 + (Math.random() - 0.5) * 400, cz + Math.sin(a) * r), q, new THREE.Vector3(sz, sz * (0.6 + Math.random() * 0.6), sz));
      rock.setMatrixAt(i, m);
    }
    world.add(rock);
    const planet = new THREE.Mesh(new THREE.SphereGeometry(900, 40, 28), new THREE.MeshLambertMaterial({ map: planetTexture(['#b07040', '#8a5030', '#c89060', '#704020']) }));
    planet.position.set(cx + 2600, -200, cz - 3200); world.add(planet);
    const atm = glowSprite(0xffb070, 2400); atm.material.opacity = 0.5; atm.position.copy(planet.position); world.add(atm);
  } else if (t === 'sun') {
    const s = glowSprite(0xffa04a, 2600); s.position.set(cx + 1200, 400, cz + 2600); world.add(s);
    const core = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 24), new THREE.MeshBasicMaterial({ color: 0xffd28a, fog: false }));
    core.position.copy(s.position); world.add(core);
  } else if (t === 'nebula') {
    for (const [x, y, z, col, sz] of [[1200, 300, 2400, 0xff4ad0, 3000], [-1400, 500, 1800, 0x6a4aff, 2600], [300, 900, -2200, 0x3ac8ff, 2400]]) {
      const s = glowSprite(col, sz); s.material.opacity = 0.45; s.position.set(cx + x, y, cz + z); world.add(s);
    }
  }
}

/* ------------------------------------------------------------------ race */

let state = 'title';     // title | menu | count | race | pause | done
let mode = 'race', pick = 0, ship, rivals = [], raceTime = 0, lapStart = 0, countdown = 0, finishOrder = [], msg = '', msgT = 0;
let unlocked = store.get('orbit.unlocked', 1);
let steerMode = store.get('orbit.steer', 0);           // 0 swipe, 1 tilt, 2 turn
let bestLaps = store.get('orbit.best', {});
const playerMesh = makeShip(TEAMS[0]);
const rivalMeshes = TEAMS.slice(1).map(makeShip);
const trails = [new Trail(0x8ad8ff, 0.16)].concat(TEAMS.slice(1).map((t) => new Trail(t.body, 0.13)));

function newShip() { return { s: 0, x: 0, target: 0, speed: 0, energy: 1, boost: 0, brake: 0, lap: 1, lapTimes: [], bumped: 0, tilt: 0, done: false }; }

function startRace(m) {
  mode = m;
  buildWorld(CIRCUITS[pick]);
  ship = newShip();
  ship.s = -30;
  rivals = [];
  if (mode === 'race') {
    for (let i = 0; i < RIVALS; i++) rivals.push({ s: (i + 1) * 14 - 30, x: i % 2 ? -0.45 : 0.45, speed: 0, lap: 1, team: TEAMS[i + 1], mesh: rivalMeshes[i],
      skill: circuit.skill * (0.92 + i * 0.025), wobble: rand(0, 6), done: false });
  }
  rivalMeshes.forEach((r, i) => (r.visible = mode === 'race'));
  raceTime = 0; lapStart = 0; countdown = 3.2; finishOrder = []; msg = ''; msgT = 0;
  chase.reset();
  state = 'count';
  if (steerMode) GK.recentre();
}

function say(t, s = 1.6) { msg = t; msgT = s; }
const dist = (o) => (o.lap - 1) * T.len + o.s;
function place() { let p = 1; const me = dist(ship); for (const r of rivals) if (r.done || dist(r) > me) p++; return p; }
function curveAhead(s, n) { let k = 0; for (let i = 0; i < n; i++) k += along(T, s + i * 6).k; return k / n; }

function tickShip(dt) {
  const s = ship, p = along(T, s.s), pct = s.speed / MAX;
  if (steerMode === 1 && GK.headLive()) s.target = clamp(-head.roll / 20, -1, 1) * 0.95;
  else if (steerMode === 2 && GK.headLive()) s.target = clamp(-head.yaw / 22, -1, 1) * 0.95;
  // Steering toward the target line, against the pull of the bend.
  const steer = clamp((s.target - s.x) * 4, -2.4, 2.4);
  s.tilt = lerp(s.tilt, steer, dt * 6);
  s.x += steer * dt * 0.9;
  const need = s.speed * s.speed * Math.abs(p.k);
  const grip = GRIP * (s.brake > 0 ? 1.45 : 1);
  if (need > grip) {
    s.x -= Math.sign(p.k) * (need - grip) / grip * dt * 1.4;   // runs wide toward the outside
    const vmax = Math.sqrt(grip / Math.abs(p.k)) * 1.08;
    if (s.speed > vmax) s.speed -= (s.speed - vmax) * 1.3 * dt;   // and scrubs speed
  }
  let top = MAX;
  if (s.boost > 0) { s.boost -= dt; top = MAX * 1.22; }
  if (Math.abs(s.x) > 0.98) {
    s.x = Math.sign(s.x) * 0.98; s.speed *= 1 - dt * 1.8;
    if (!s.scrape) { noise(0.2, 0.4, 700); s.scrape = 0.4; }
  }
  s.scrape = Math.max(0, (s.scrape || 0) - dt);
  if (s.brake > 0) { s.brake -= dt; s.speed = Math.max(0, s.speed - BRAKE * dt * 0.5); top *= 0.82; }
  if (s.speed < top) s.speed = Math.min(top, s.speed + ACCEL * dt * (1.2 - pct * 0.6));
  else s.speed = Math.max(top, s.speed - ACCEL * 1.5 * dt);
  s.energy = Math.min(1, s.energy + dt * 0.04);
  for (const pad of pads) {
    if (Math.abs(s.s - pad.s) < 5 && Math.abs(s.x * HW - pad.off) < 3) {
      if (s.boost < 0.8) { beep(880, 0.15, 'sawtooth', 0.3, 600); say('SPEED PAD'); }
      s.boost = Math.max(s.boost, 1.3);
    }
  }
  const before = s.s;
  s.s += s.speed * dt;
  if (before < T.len && s.s >= T.len) {
    s.s -= T.len;
    if (raceTime > 3) {
      const lt = raceTime - lapStart;
      s.lapTimes.push(lt); lapStart = raceTime;
      if (!bestLaps[circuit.name] || lt < bestLaps[circuit.name]) { bestLaps[circuit.name] = lt; store.set('orbit.best', bestLaps); say('BEST LAP ' + GK.fmtTime(lt)); }
      else say('LAP ' + GK.fmtTime(lt));
      beep(660, 0.12, 'triangle', 0.4);
      if (s.lap >= LAPS) return finish();
      s.lap++;
    }
  }
  // Bumping rivals: slow down and slide aside.
  for (const r of rivals) {
    if (r.done) continue;               // finished ships pull off into the pit lane
    let dz = r.s - s.s;
    if (dz > T.len / 2) dz -= T.len; if (dz < -T.len / 2) dz += T.len;
    if (Math.abs(dz) < 5 && Math.abs(r.x - s.x) * HW < 2.6) {
      if (dz > 0 && s.speed > r.speed) s.speed = r.speed * 0.93;
      const push = s.x < r.x ? -1 : 1;
      s.x += push * 0.05; s.target = clamp(s.target + push * 0.15, -1, 1); r.x -= push * 0.03;
      if (s.bumped <= 0) { noise(0.12, 0.3, 1400); s.bumped = 0.4; }
    }
  }
  s.bumped -= dt;
}

function tickRivals(dt) {
  for (const r of rivals) {
    if (r.done) { r.speed = Math.max(MAX * 0.5, r.speed - 20 * dt); r.s = (r.s + r.speed * dt) % T.len; continue; }
    // Racing line: the inside of the bend ahead, wide on the way in.
    const near = curveAhead(r.s, 8), far = curveAhead(r.s + 50, 10);
    let want = clamp(near * 120 - far * 40, -0.75, 0.75) + Math.sin(raceTime * 0.5 + r.wobble) * 0.06;
    for (const o of rivals.concat([ship])) {
      if (o === r) continue;
      let dz = o.s - r.s; if (dz < -T.len / 2) dz += T.len;
      if (dz > 0 && dz < 25 && Math.abs(o.x - r.x) < 0.3 && o.speed < r.speed) want = o.x > 0 ? o.x - 0.45 : o.x + 0.45;
    }
    r.x += clamp(want - r.x, -1, 1) * dt * 1.5;
    r.x = clamp(r.x, -0.85, 0.85);
    // Rivals brake for the bend ahead like a good driver: the grip limit, plus a little skill.
    const kk = Math.max(Math.abs(along(T, r.s).k), Math.abs(along(T, r.s + 40).k), 1e-4);
    const top = Math.min(MAX * r.skill, Math.sqrt(GRIP * 1.3 / kk) * r.skill);
    r.speed = r.speed < top ? Math.min(top, r.speed + ACCEL * 0.9 * dt) : Math.max(top, r.speed - BRAKE * 0.4 * dt);
    const before = r.s;
    r.s += r.speed * dt;
    if (before < T.len && r.s >= T.len) {
      r.s -= T.len;
      if (raceTime > 3) { if (r.lap >= LAPS) { r.done = true; finishOrder.push(r); } else r.lap++; }
    }
  }
}

function finish() {
  state = 'done';
  ship.place = mode === 'race' ? 1 + finishOrder.length : 1;
  ship.total = raceTime;
  if (mode === 'race' && ship.place <= 3 && pick + 1 >= unlocked && unlocked < CIRCUITS.length) { unlocked = pick + 2; store.set('orbit.unlocked', unlocked); ship.unlock = CIRCUITS[pick + 1].name; }
  beep(523, 0.15, 'triangle', 0.4); setTimeout(() => beep(784, 0.3, 'triangle', 0.4), 160);
}

function tick(dt) {
  msgT -= dt;
  if (state === 'count') {
    const before = Math.ceil(countdown);
    countdown -= dt;
    if (Math.ceil(countdown) !== before && countdown > 0) beep(440, 0.12, 'triangle', 0.4);
    if (countdown <= 0) { state = 'race'; beep(880, 0.25, 'triangle', 0.5); }
    return;
  }
  if (state !== 'race') return;
  raceTime += dt;
  tickShip(dt);
  if (state === 'race') tickRivals(dt);
}

/* --------------------------------------------------------------- drawing */

let menuS = 0;
const want = new THREE.Vector3(), at = new THREE.Vector3();

function placeShip(mesh, s, x, tilt, now, flame) {
  const p = trackPoint(T, s, x * HW, 1.1 + Math.sin(now / 260 + s) * 0.12);
  mesh.position.set(p.x, p.y, p.z);
  mesh.rotation.set(0, p.h, 0, 'YXZ');
  mesh.rotation.z = -p.bank + tilt * 0.25;
  mesh.flame.scale.setScalar(2 + flame * 3);
  return p;
}

function render3d(now) {
  const dt = clock(now);
  if (!T) buildWorld(CIRCUITS[pick]);
  let s = ship;
  if (state === 'title' || state === 'menu' || !s) { menuS += dt * 60; s = { s: menuS % T.len, x: Math.sin(menuS / 300) * 0.4, tilt: 0, speed: 60, boost: 0 }; rivalMeshes.forEach((m) => (m.visible = false)); }
  const p = placeShip(playerMesh, s.s, s.x, -s.tilt, now, (s.speed || 0) / MAX + (s.boost > 0 ? 0.8 : 0));
  for (const r of rivals) { r.mesh.visible = !r.done; placeShip(r.mesh, r.s, r.x, 0, now, r.speed / MAX); }
  // Chase camera behind along the track, banking a little with it.
  const back = trackPoint(T, s.s - 7.5, s.x * HW * 0.85, 3.1), ahead = trackPoint(T, s.s + 22, s.x * HW * 0.6, 1.0);
  want.set(back.x, back.y, back.z); at.set(ahead.x, ahead.y, ahead.z);
  // Stiff follow: at 100 m/s a soft spring would leave the ship tiny in the distance.
  chase.update(want, at, dt, 30, -p.bank * 0.5);
  stars.position.copy(camera.position);
  dome.position.copy(camera.position);
  // Engine trails from each ship's nozzle.
  const shipsNow = [[playerMesh, 0]].concat(rivals.map((r, i) => [r.mesh, i + 1]));
  for (const [m, i] of shipsNow) {
    if (!m.visible) { trails[i].reset(); trails[i].mesh.visible = false; continue; }
    trails[i].mesh.visible = true;
    m.updateMatrixWorld();
    const nz = new THREE.Vector3(0, 0.42, -2.7).applyMatrix4(m.matrixWorld), sd = new THREE.Vector3(1, 0, 0).applyQuaternion(m.quaternion);
    trails[i].push(nz, sd);
  }
  for (let i = shipsNow.length; i < trails.length; i++) trails[i].mesh.visible = false;
  // Edge lights: a wave of brightness running forward along the deck.
  if (edgeLights) {
    const base = new THREE.Color(circuit.edge), cc = new THREE.Color();
    for (let i = 0; i < edgeLightN; i++) {
      const sPos = (i >> 1) * 8;
      const w = Math.pow(Math.max(0, Math.sin(sPos * 0.035 - now / 90)), 10);
      edgeLights.setColorAt(i, cc.copy(base).multiplyScalar(0.35 + w * 1.6));
    }
    edgeLights.instanceColor.needsUpdate = true;
  }
  // Speed streaks in camera space.
  const sp = clamp(((s.speed || 0) - MAX * 0.55) / (MAX * 0.6), 0, 1) + (s.boost > 0 ? 0.5 : 0);
  streaks.material.opacity = Math.min(0.45, sp * 0.4);
  const mm = new THREE.Matrix4();
  camera.updateMatrixWorld();
  for (let i = 0; i < STREAKS; i++) {
    const q = streakPos[i];
    q.z += (s.speed || 0) * dt * 1.3;
    if (q.z > 2) q.z -= 62;
    streaks.setMatrixAt(i, mm.makeTranslation(q.x, q.y, q.z).premultiply(camera.matrixWorld));
  }
  streaks.instanceMatrix.needsUpdate = true;
  camera.fov = 64 + clamp(((s.speed || 0) - 60) / MAX, 0, 1) * 8 + (s.boost > 0 ? 6 : 0);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

function hud(now) {
  // Standings: position, team colour, tag, gap to the leader.
  const all = [{ tag: 'YOU', bar: TEAMS[0].bar, d: dist(ship), me: true }].concat(rivals.map((r) => ({ tag: r.team.tag, bar: r.team.bar, d: r.done ? 1e9 + r.s : dist(r) })));
  all.sort((a, b) => b.d - a.d);
  label('LAP', 28, 38, 18, '#fff', 'left', 800);
  hudText(g, Math.min(ship.lap, LAPS) + '', 74, 38, 20, 'left', '#ff5a3a');
  label('/ ' + LAPS, 92, 38, 18, '#fff', 'left', 800);
  if (mode === 'race') {
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(20, 48, 200, all.length * 22 + 6);
    const leaderD = all[0].d;
    all.forEach((o, i) => {
      const y = 66 + i * 22;
      if (o.me) { g.fillStyle = '#ff5a3a'; g.beginPath(); g.moveTo(14, y - 10); g.lineTo(20, y - 5); g.lineTo(14, y); g.fill(); }
      label(String(i + 1), 40, y, 15, o.me ? '#ff8a6a' : '#e8eef6', 'right', 700);
      g.fillStyle = o.bar; g.fillRect(46, y - 12, 4, 14);
      label(o.tag, 56, y, 15, o.me ? '#ff8a6a' : '#e8eef6', 'left', 700);
      label(i === 0 ? 'LEAD' : '+' + Math.max(0, (leaderD - o.d) / Math.max(30, ship.speed)).toFixed(2), 210, y, 14, '#c3c7cd', 'right', 600);
    });
  }
  label('LAP TIME', 576, 34, 15, '#e8eef6', 'right', 700);
  hudText(g, GK.fmtTime(raceTime - lapStart), 576, 68, 32, 'right', '#fff');
  label('BEST ' + GK.fmtTime(bestLaps[circuit.name]), 576, 92, 14, '#c3c7cd', 'right', 700);
  minimap(500, 150);
  // Speed arc and number.
  const sp = ship.speed / MAX;
  g.lineWidth = 6;
  for (let i = 0; i < 24; i++) {
    const a0 = Math.PI * (0.95 + i / 24 * 0.8), on = i / 24 < sp;
    g.strokeStyle = on ? (i > 18 ? '#7cd0ff' : '#ffffff') : 'rgba(255,255,255,.18)';
    g.beginPath(); g.arc(500, 560, 80, a0, a0 + Math.PI * 0.025); g.stroke();
  }
  hudText(g, String(Math.round(ship.speed * 3.6)), 500, 548, 46, 'center');
  label('KM/H', 500, 572, 14, '#e8eef6', 'center', 800);
  if (ship.brake > 0) label('AIRBRAKE', 560, 470, 15, '#ffb35c', 'right', 800);
  // Energy.
  label('ENERGY', 28, 582, 13, '#e8eef6', 'left', 800);
  for (let i = 0; i < 12; i++) { g.fillStyle = i / 12 < ship.energy ? '#7cd0ff' : 'rgba(255,255,255,.15)'; g.fillRect(96 + i * 11, 572, 9, 10); }
  label(String(Math.round(ship.energy * 100)), 236, 582, 13, '#e8eef6', 'left', 700);
  if (msgT > 0) hudText(g, msg, 300, 200, 26, 'center', '#7cffe0');
  if (steerMode && !GK.headLive() && GK.blink(now, 800)) label('Head steering waiting — swipes work', 300, 240, 15, '#ffb35c', 'center', 700);
}

function minimap(cx, cy) {
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  for (const p of T.pts) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z); }
  const sc = 64 / Math.max(mxx - mnx, mxz - mnz);
  const X = (p) => cx - (p.x - (mnx + mxx) / 2) * sc, Y = (p) => cy - (p.z - (mnz + mxz) / 2) * sc;
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 3; g.beginPath();
  for (let i = 0; i <= T.N; i += 4) { const p = T.pts[i % T.N]; if (i) g.lineTo(X(p), Y(p)); else g.moveTo(X(p), Y(p)); }
  g.stroke();
  for (const r of rivals) { const p = along(T, r.s); g.fillStyle = r.team.bar; g.beginPath(); g.arc(X(p), Y(p), 3, 0, Math.PI * 2); g.fill(); }
  const p = along(T, ship.s); g.fillStyle = '#ff5a3a'; g.beginPath(); g.arc(X(p), Y(p), 5, 0, Math.PI * 2); g.fill();
}

function titleScreen(now) {
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, 600, 600);
  hudText(g, 'ORB', 330, 150, 96, 'right', '#ffffff', true, 900);
  hudText(g, 'IT', 330, 150, 96, 'left', '#ff5a3a', true, 900);
  g.fillStyle = 'rgba(255,90,58,.8)'; g.fillRect(150, 172, 300, 3);
  label('A N T I - G R A V I T Y   R A C I N G', 300, 204, 15, '#e8eef6', 'center', 700);
  g.strokeStyle = '#ff5a3a'; g.lineWidth = 2; g.fillStyle = 'rgba(14,16,20,.85)';
  g.fillRect(190, 470, 220, 62); g.strokeRect(190, 470, 220, 62);
  label('PINCH TO RACE', 300, 508, 20, '#fff', 'center', 800);
}

const MENU = () => [
  { text: 'QUICK RACE', sub: () => CIRCUITS[pick].name + (pick + 1 > unlocked ? ' · locked' : ' · ' + unlocked + ' / 6 open'), act: () => { if (pick + 1 <= unlocked) startRace('race'); else beep(160, 0.2); } },
  { text: 'TIME TRIAL', sub: () => 'Best lap ' + GK.fmtTime(bestLaps[CIRCUITS[pick].name]), act: () => { if (pick + 1 <= unlocked) startRace('trial'); else beep(160, 0.2); } },
  { text: 'STEERING', sub: () => ['Swipe to nudge your line', 'Tilt your head to steer', 'Turn your head to steer'][steerMode], act: () => { steerMode = (steerMode + 1) % 3; store.set('orbit.steer', steerMode); if (steerMode) GK.askHead(); } },
  { text: 'SOUND', sub: () => (GK.sound.on ? 'On' : 'Off'), act: () => GK.setSound(!GK.sound.on) },
];
let menuI = 0;

function menuScreen(now) {
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, 600, 600);
  hudText(g, 'ORB', 28, 48, 26, 'left', '#fff', true, 900); hudText(g, 'IT', 90, 48, 26, 'left', '#ff5a3a', true, 900);
  label('CIRCUIT  ‹ ' + CIRCUITS[pick].name.toUpperCase() + ' ›', 576, 46, 15, '#ffd34d', 'right', 800);
  const items = MENU();
  items.forEach((it, i) => {
    const y = 250 + i * 82, on = i === menuI;
    g.fillStyle = 'rgba(14,16,20,.9)'; g.fillRect(on ? 24 : 34, y, on ? 552 : 532, 68);
    if (on) { g.fillStyle = '#ff5a3a'; g.fillRect(24, y, 4, 68); }
    label(it.text, on ? 46 : 52, y + 32, 24, on ? '#fff' : '#c3c7cd', 'left', 800);
    label(it.sub(), on ? 46 : 52, y + 56, 15, '#a9adb3', 'left', 600);
  });
  label('Up / Down choose · Left / Right circuit · Pinch go', 300, 588, 13, '#a9adb3', 'center', 600);
}

function panel(now, title, lines, prompt, colour = '#ff5a3a') {
  g.fillStyle = 'rgba(14,16,20,.92)'; g.fillRect(70, 190, 460, 110 + lines.length * 28);
  g.fillStyle = colour; g.fillRect(70, 190, 4, 110 + lines.length * 28);
  hudText(g, title, 300, 244, 40, 'center', '#fff', true, 900);
  lines.forEach((t, i) => label(t, 300, 280 + i * 28, 18, '#e8eef6', 'center', 600));
  if (GK.blink(now)) label(prompt, 300, 280 + lines.length * 28 + 16, 17, colour, 'center', 800);
}

function render(now) {
  render3d(now);
  g.clearRect(0, 0, 600, 600);
  if (state === 'title') return titleScreen(now);
  if (state === 'menu') return menuScreen(now);
  hud(now);
  if (state === 'count') { const n = Math.ceil(countdown); hudText(g, n > 0 ? String(n) : 'GO', 300, 320, 110, 'center', n > 0 ? '#ffffff' : '#7cffe0', true, 900); }
  if (state === 'pause') panel(now, 'PAUSED', ['Down: back to the menu'], 'Pinch to continue');
  if (state === 'done') {
    const lines = ['Time ' + GK.fmtTime(ship.total) + '   ·   best lap ' + GK.fmtTime(Math.min(...ship.lapTimes))];
    if (ship.unlock) lines.push('Unlocked: ' + ship.unlock);
    const title = mode === 'race' ? ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'][ship.place - 1] + ' PLACE' : 'FINISH';
    panel(now, title, lines, 'Pinch for the menu', ship.place <= 3 ? '#ffd34d' : '#ff5a3a');
  }
}

/* ----------------------------------------------------------------- input */

GK.input.onKey = (k) => {
  if (state === 'title') { if (k === 'Enter') { state = 'menu'; if (steerMode) GK.askHead(); } return; }
  if (state === 'menu') {
    const items = MENU();
    if (k === 'ArrowUp') menuI = (menuI + items.length - 1) % items.length;
    else if (k === 'ArrowDown') menuI = (menuI + 1) % items.length;
    else if (k === 'ArrowLeft') { pick = (pick + CIRCUITS.length - 1) % CIRCUITS.length; buildWorld(CIRCUITS[pick]); }
    else if (k === 'ArrowRight') { pick = (pick + 1) % CIRCUITS.length; buildWorld(CIRCUITS[pick]); }
    else if (k === 'Enter') items[menuI].act();
    beep(560, 0.03);
    return;
  }
  if (k === 'Enter') {
    if (state === 'race' || state === 'count') state = 'pause';
    else if (state === 'pause') state = countdown > 0 ? 'count' : 'race';
    else if (state === 'done') state = 'menu';
    return;
  }
  if (state === 'pause' && k === 'ArrowDown') { state = 'menu'; return; }
  if (state !== 'race' && state !== 'count') return;
  // Swipes nudge the line in thirds of the track; screen left is +x on the track.
  if (k === 'ArrowLeft') ship.target = clamp(Math.round((ship.target + 0.45) / 0.45) * 0.45, -0.9, 0.9);
  else if (k === 'ArrowRight') ship.target = clamp(Math.round((ship.target - 0.45) / 0.45) * 0.45, -0.9, 0.9);
  else if (k === 'ArrowUp' && state === 'race') {
    if (ship.energy >= 0.33) { ship.energy -= 0.33; ship.boost = 1.8; beep(300, 0.4, 'sawtooth', 0.3, 500); } else beep(160, 0.1);
  } else if (k === 'ArrowDown') ship.brake = 0.6;
};

GK.loop.onHidden = () => { if (state === 'race' || state === 'count') state = 'pause'; };
GK.run(tick, render);

window.orbit = { get state() { return state; }, set state(v) { state = v; }, get ship() { return ship; }, get rivals() { return rivals; }, startRace, tick, curveAhead, set pick(v) { pick = v; }, CIRCUITS, get T() { return T; }, along: (s) => along(T, s), HW, MAX, GRIP, VERSION };
