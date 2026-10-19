'use strict';

/* Glass Orbit — anti-gravity racing for Meta Ray-Ban Display glasses.
   Pseudo-3D road made of segments (each with a curve and a height), six closed
   circuits with their own sky, five rivals that drive a racing line.
     Left / Right   move the ship across the track (swipe steering), or
                    tilt / turn your head when head steering is on
     Up             boost (uses energy)      Down   air brake
     Pinch          pause, menus
   Three laps per race; finishing in the top three unlocks the next circuit. */

const VERSION = '1.0.0';
const { g, label, plate, banner, clamp, lerp, rand, beep, noise, head, store } = GK;

const SEG = 200;            // segment length, world units
const ROAD = 2000;          // half road width
const CAM_H = 1000;         // camera height
const DEPTH = 1 / Math.tan((100 / 2) * Math.PI / 180);   // field of view 100°
const DRAW = 180;           // segments drawn ahead
const MAX = 13000;          // top speed, units/s (≈ 230 km/h on the readout)
const ACCEL = MAX / 2.6, DECEL_OFF = MAX / 1.2, BRAKE = MAX / 1.3;
const CENTRIFUGAL = 0.12;   // sideways push per unit of curve at top speed, track widths per second
const LAPS = 3;
const RIVALS = 5;

/* ---------------------------------------------------------------- circuits */

// Each circuit: sky theme, colours and a list of sections [length, curve, hill].
// Curves are in "road units per segment"; hills in segments of height.
const CIRCUITS = [
  { name: 'Lunar Loop', sky: 'moon', road: '#2a3550', edge: '#7fd8ff', line: '#d8f4ff', side: '#0f2236', skill: 0.90,
    track: [[60, 0, 0], [80, 3, 0], [50, 0, 20], [90, -4, 0], [60, 0, -20], [70, 5, 10], [60, 0, -10], [100, -2, 0], [60, 0, 0], [80, 4, 0]] },
  { name: 'Ring Station', sky: 'ring', road: '#3b2c4d', edge: '#c79bff', line: '#f0e2ff', side: '#1c1230', skill: 0.93,
    track: [[50, 0, 0], [60, -5, 0], [40, 0, 30], [60, 5, -30], [80, 0, 0], [50, -6, 0], [50, 6, 0], [70, 0, 25], [60, -3, -25], [90, 3, 0], [50, 0, 0]] },
  { name: 'Asteroid Belt', sky: 'rocks', road: '#3f3427', edge: '#ffb35c', line: '#fff0d6', side: '#21180e', skill: 0.96,
    track: [[40, 0, 0], [70, 6, 15], [40, -6, -15], [60, 0, 0], [80, -4, 30], [50, 0, -30], [60, 7, 0], [40, -7, 0], [70, 2, 20], [60, 0, -20], [70, -3, 0]] },
  { name: 'Gas Giant', sky: 'giant', road: '#1f3b3a', edge: '#5dffd0', line: '#dafff6', side: '#0b2120', skill: 0.99,
    track: [[60, 0, 0], [100, 4, 40], [60, 0, -40], [60, -7, 0], [40, 0, 0], [60, 7, 0], [80, -2, 30], [80, 2, -30], [50, -5, 0], [70, 0, 0], [60, 5, 0]] },
  { name: 'Solar Rim', sky: 'sun', road: '#4a2a22', edge: '#ff7a4d', line: '#fff0e0', side: '#26100b', skill: 1.02,
    track: [[50, 0, 0], [50, 8, 0], [30, 0, 30], [50, -8, -30], [60, 0, 0], [70, 5, 40], [70, -5, -40], [40, 0, 0], [60, 7, 0], [60, -7, 0], [80, 0, 0]] },
  { name: 'Deep Nebula', sky: 'nebula', road: '#30244a', edge: '#ff5cc8', line: '#ffe0f6', side: '#160d26', skill: 1.05,
    track: [[40, 0, 0], [60, -7, 30], [40, 7, -30], [60, 0, 40], [60, 0, -40], [50, 8, 0], [50, -8, 0], [70, 4, 20], [70, -4, -20], [40, 0, 0], [60, 6, 0], [60, -2, 0]] },
];

let segs = [], trackLen = 0, circuit = CIRCUITS[0];

const easeIn = (a, b, t) => a + (b - a) * t * t;
const easeInOut = (a, b, t) => a + (b - a) * ((-Math.cos(t * Math.PI) / 2) + 0.5);

function build(c) {
  circuit = c;
  segs = [];
  let y = 0;
  const add = (curve, yTo) => {
    const n = segs.length;
    segs.push({ i: n, curve, y1: y, y2: yTo, deco: null, pad: false });
    y = yTo;
  };
  for (const [short, curve, hill] of c.track) {
    const len = Math.round(short * 2.5);   // the tables are written short; laps run about 40 s
    const enter = Math.floor(len * 0.25), leave = enter, hold = len - enter - leave;
    const start = y, end = y + hill * SEG;
    const total = len;
    let k = 0;
    for (let n = 0; n < enter; n++, k++) add(easeIn(0, curve, n / enter), easeInOut(start, end, k / total));
    for (let n = 0; n < hold; n++, k++) add(curve, easeInOut(start, end, k / total));
    for (let n = 0; n < leave; n++, k++) add(easeInOut(curve, 0, n / leave), easeInOut(start, end, k / total));
  }
  // Close the loop in height: spread any leftover drop over the whole lap.
  const err = y;
  segs.forEach((s, i) => { s.y1 -= err * i / segs.length; s.y2 -= err * (i + 1) / segs.length; });
  trackLen = segs.length * SEG;
  // Roadside pylons, speed pads and the start line.
  for (const s of segs) {
    if (s.i % 8 === 0) s.deco = { side: s.i % 16 === 0 ? -1.25 : 1.25, kind: 'pylon' };
    if (s.i % 37 === 11 && Math.abs(s.curve) < 3) s.deco = { side: s.i % 2 ? -1.6 : 1.6, kind: 'rock' };
    if (s.i > 20 && s.i % 97 === 50) s.pad = (s.i % 3) - 1;   // pad across a third of the road
  }
}

const segAt = (z) => segs[Math.floor(((z % trackLen) + trackLen) % trackLen / SEG) % segs.length];

/* ------------------------------------------------------------------- race */

let state = 'menu';       // menu | count | race | pause | done
let mode = 'race';        // race | trial
let ship, rivals, lapStart, raceTime, bestLaps, countdown, finishOrder, msg, msgT, ghost;
let skyX = 0;
let unlocked = store.get('orbit.unlocked', 1);
const steerModes = ['Swipe', 'Tilt head', 'Turn head'];
let steerMode = store.get('orbit.steer', 0);
let pick = 0;

function newShip() {
  return { z: 0, x: 0, target: 0, speed: 0, energy: 1, boost: 0, brake: 0, lap: 1, lapTimes: [], bumped: 0, tilt: 0 };
}

function startRace(m) {
  mode = m;
  build(CIRCUITS[pick]);
  ship = newShip();
  rivals = [];
  if (mode === 'race') {
    const colours = ['#ff6b6b', '#ffd34d', '#5dffb4', '#ff9be0', '#b7a3ff'];
    for (let i = 0; i < RIVALS; i++) {
      rivals.push({
        z: (i + 1) * SEG * 3, x: i % 2 ? -0.45 : 0.45, speed: 0, lap: 1, colour: colours[i],
        skill: circuit.skill * (0.94 + i * 0.03), wobble: rand(0, 6), done: 0,
      });
    }
  }
  bestLaps = store.get('orbit.best', {});
  ghost = null;
  raceTime = 0; lapStart = 0; countdown = 3.2; finishOrder = []; skyX = 0; msg = ''; msgT = 0;
  state = 'count';
  if (steerMode) GK.recentre();
}

function place() {
  const me = (ship.lap - 1) * trackLen + ship.z;
  let pos = 1;
  for (const r of rivals) if ((r.lap - 1) * trackLen + r.z > me) pos++;
  return pos;
}

function say(text) { msg = text; msgT = 1.6; }

function curveAhead(z, n) {
  let s = 0;
  const base = segAt(z).i;
  for (let i = 0; i < n; i++) s += segs[(base + i) % segs.length].curve;
  return s / n;
}

function tickShip(dt) {
  const s = ship;
  const seg = segAt(s.z);
  const pct = s.speed / MAX;

  // Steering target: discrete for swipes, continuous for the head.
  if (steerMode === 1 && GK.headLive()) s.target = clamp(head.roll / 20, -1, 1) * 1.05;
  else if (steerMode === 2 && GK.headLive()) s.target = clamp(head.yaw / 22, -1, 1) * 1.05;
  const steer = clamp((s.target - s.x) * 4.2, -2.2, 2.2);
  s.tilt = lerp(s.tilt, steer, dt * 6);
  s.x += steer * dt * (0.6 + pct * 0.9);
  // The curve throws the ship outward with speed.
  s.x -= seg.curve * pct * pct * CENTRIFUGAL * dt;

  let top = MAX;
  if (s.boost > 0) { s.boost -= dt; top = MAX * 1.22; }
  if (Math.abs(s.x) > 1.05) top = MAX * 0.55;   // over the track edge: drag
  if (Math.abs(s.x) > 1.45) {                    // barrier: bounce back in
    s.x = Math.sign(s.x) * 1.45;
    s.target = Math.sign(s.x) * 0.9;
    s.speed *= 0.82;
    noise(0.15, 0.4, 600);
  }
  if (s.brake > 0) { s.brake -= dt; s.speed = Math.max(0, s.speed - BRAKE * dt); }
  else if (s.speed < top) s.speed = Math.min(top, s.speed + ACCEL * dt * (1.15 - pct * 0.5));
  else s.speed = Math.max(top, s.speed - DECEL_OFF * dt);

  s.energy = Math.min(1, s.energy + dt * 0.05);
  if (seg.pad !== false && Math.abs(s.x - seg.pad * 0.66) < 0.33) {
    if (s.boost < 0.9) { beep(880, 0.15, 'sawtooth', 0.3, 600); say('BOOST PAD'); }
    s.boost = Math.max(s.boost, 1.2);
  }

  const before = s.z;
  s.z += s.speed * dt;
  if (s.z >= trackLen) {
    s.z -= trackLen;
    const lapTime = raceTime - lapStart;
    s.lapTimes.push(lapTime);
    lapStart = raceTime;
    const key = circuit.name;
    if (!bestLaps[key] || lapTime < bestLaps[key]) { bestLaps[key] = lapTime; store.set('orbit.best', bestLaps); say('BEST LAP ' + GK.fmtTime(lapTime)); }
    else say('LAP ' + GK.fmtTime(lapTime));
    beep(660, 0.12, 'triangle', 0.4); beep(990, 0.18, 'triangle', 0.3);
    if (s.lap >= LAPS && mode === 'race') return finish();
    if (mode === 'trial' && s.lap >= LAPS) return finish();
    s.lap++;
  }
  void before;

  // Bumping a rival: lose speed, slide aside.
  for (const r of rivals) {
    let dz = r.z - s.z;
    if (dz > trackLen / 2) dz -= trackLen;
    if (dz < -trackLen / 2) dz += trackLen;
    if (Math.abs(dz) < SEG * 0.9 && Math.abs(r.x - s.x) < 0.32) {
      if (dz > 0 && s.speed > r.speed) s.speed = r.speed * 0.92;
      const push = s.x < r.x ? -1 : 1;
      s.x += push * 0.06; s.target = clamp(s.target + push * 0.2, -1, 1);
      r.x -= push * 0.03;
      if (s.bumped <= 0) { noise(0.1, 0.3, 1400); s.bumped = 0.4; }
    }
  }
  s.bumped -= dt;
}

function tickRivals(dt) {
  for (const r of rivals) {
    if (r.done) { r.speed = Math.max(MAX * 0.5, r.speed - MAX * dt * 0.3); r.z = (r.z + r.speed * dt) % trackLen; continue; }
    // Racing line: drift toward the inside of the curve ahead, wide on entry.
    const near = curveAhead(r.z, 12), far = curveAhead(r.z + SEG * 12, 24);
    let want = clamp(near * 0.22 - far * 0.06, -0.75, 0.75) + Math.sin(raceTime * 0.5 + r.wobble) * 0.08;
    // Move aside for anyone just ahead on the same line.
    for (const o of rivals.concat([ship])) {
      if (o === r) continue;
      let dz = o.z - r.z; if (dz < -trackLen / 2) dz += trackLen;
      if (dz > 0 && dz < SEG * 4 && Math.abs(o.x - r.x) < 0.35 && (o.speed || 0) < r.speed) want = o.x > 0 ? o.x - 0.55 : o.x + 0.55;
    }
    r.x += clamp(want - r.x, -1, 1) * dt * 1.6;
    r.x = clamp(r.x, -0.85, 0.85);
    const corner = Math.abs(near);
    const top = MAX * r.skill * (1 - clamp(corner * 0.035, 0, 0.18));
    r.speed = r.speed < top ? Math.min(top, r.speed + ACCEL * 0.9 * dt) : Math.max(top, r.speed - BRAKE * 0.5 * dt);
    r.z += r.speed * dt;
    if (r.z >= trackLen) {
      r.z -= trackLen;
      if (r.lap >= LAPS) { r.done = 1; finishOrder.push(r); } else r.lap++;
    }
  }
}

function finish() {
  state = 'done';
  // Rivals that crossed the line before us; place() would misread our wrapped distance.
  ship.place = mode === 'race' ? 1 + finishOrder.length : 1;
  ship.total = raceTime;
  if (mode === 'race' && ship.place <= 3 && pick + 1 >= unlocked && unlocked < CIRCUITS.length) {
    unlocked = pick + 2;
    store.set('orbit.unlocked', unlocked);
    ship.unlock = CIRCUITS[pick + 1].name;
  }
  const key = 'orbit.podium.' + circuit.name;
  if (mode === 'race') { const prev = store.get(key, 9); if (ship.place < prev) store.set(key, ship.place); }
  beep(523, 0.15, 'triangle', 0.4); setTimeout(() => beep(784, 0.3, 'triangle', 0.4), 160);
}

function tick(dt) {
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
  if (state !== 'race') return;
  tickRivals(dt);
  skyX += segAt(ship.z).curve * (ship.speed / MAX) * dt * 0.6;
  msgT -= dt;
}

/* --------------------------------------------------------------- drawing */

function project(p, camX, camY, camZ) {
  const cx = p.wx - camX, cy = p.wy - camY, cz = p.wz - camZ;
  p.scale = DEPTH / cz;
  p.sx = 300 + p.scale * cx * 300;
  p.sy = 330 - p.scale * cy * 300;
  p.sw = p.scale * ROAD * 300;
}

function quad(x1, y1, w1, x2, y2, w2, colour) {
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(x1 - w1, y1); g.lineTo(x2 - w2, y2); g.lineTo(x2 + w2, y2); g.lineTo(x1 + w1, y1);
  g.closePath(); g.fill();
}

function drawSky(now) {
  const sx = (skyX * 160) % 600;
  // Star field drifts with the turns.
  g.fillStyle = '#9fb3d6';
  for (let i = 0; i < 60; i++) {
    const x = (((i * 137.5) % 600) - sx * 0.4 + 1200) % 600;
    const y = (i * 73.3) % 300;
    g.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }
  const px = ((420 - sx) % 900 + 900) % 900 - 150;
  const t = circuit.sky;
  if (t === 'moon') {
    g.fillStyle = '#2d4a6b'; g.beginPath(); g.arc(px, 150, 90, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3d6390';
    for (const [dx, dy, r] of [[-30, -20, 18], [25, 15, 12], [-5, 40, 9], [40, -35, 8]]) { g.beginPath(); g.arc(px + dx, 150 + dy, r, 0, Math.PI * 2); g.fill(); }
  } else if (t === 'ring') {
    g.strokeStyle = '#6b4f8f'; g.lineWidth = 10;
    g.beginPath(); g.ellipse(px, 150, 170, 40, -0.2, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#4b3570'; g.beginPath(); g.arc(px, 150, 42, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c79bff';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + now / 4000; g.fillRect(px + Math.cos(a) * 170 - 3, 150 + Math.sin(a) * 40 - 3 - Math.cos(a) * 34 * 0.2, 6, 6); }
  } else if (t === 'rocks') {
    g.fillStyle = '#5a4630';
    for (let i = 0; i < 14; i++) {
      const x = ((i * 97 - sx * (0.6 + (i % 3) * 0.2)) % 700 + 700) % 700 - 50, y = 60 + (i * 53) % 200, r = 6 + (i * 7) % 22;
      g.beginPath(); g.ellipse(x, y, r, r * 0.7, i, 0, Math.PI * 2); g.fill();
    }
  } else if (t === 'giant') {
    const grd = g.createLinearGradient(0, 40, 0, 300);
    grd.addColorStop(0, '#1f5c58'); grd.addColorStop(0.5, '#2f7a5f'); grd.addColorStop(1, '#174a46');
    g.fillStyle = grd; g.beginPath(); g.arc(px, 260, 200, Math.PI, 0); g.fill();
    g.strokeStyle = 'rgba(93,255,208,.35)'; g.lineWidth = 6;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(px, 260, 200, 30 + i * 30, 0, Math.PI, 0); g.stroke(); }
  } else if (t === 'sun') {
    const grd = g.createRadialGradient(px, 170, 10, px, 170, 140);
    grd.addColorStop(0, '#ffd27a'); grd.addColorStop(0.35, '#ff7a3d'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(px - 150, 20, 300, 300);
  } else if (t === 'nebula') {
    for (const [dx, dy, r, c] of [[-80, 0, 150, 'rgba(255,92,200,.22)'], [60, 40, 130, 'rgba(120,90,255,.22)'], [0, -40, 100, 'rgba(92,220,255,.16)']]) {
      const grd = g.createRadialGradient(px + dx, 150 + dy, 0, px + dx, 150 + dy, r);
      grd.addColorStop(0, c); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(px + dx - r, 150 + dy - r, r * 2, r * 2);
    }
  }
}

function drawShip(x, y, w, colour, tilt, glow) {
  // Wedge hull, twin engines, a canopy. w is the half width in px.
  g.save();
  g.translate(x, y);
  g.rotate(clamp(tilt, -1, 1) * 0.18);
  const h = w * 0.55;
  if (glow) {
    g.fillStyle = 'rgba(127,216,255,.55)';
    g.beginPath(); g.ellipse(-w * 0.45, h * 0.15, w * 0.18, h * 0.32 * glow, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(w * 0.45, h * 0.15, w * 0.18, h * 0.32 * glow, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = colour;
  g.beginPath();
  g.moveTo(-w, h * 0.1); g.lineTo(-w * 0.25, -h); g.lineTo(w * 0.25, -h); g.lineTo(w, h * 0.1);
  g.lineTo(w * 0.7, h * 0.35); g.lineTo(-w * 0.7, h * 0.35); g.closePath(); g.fill();
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(-w * 0.7, h * 0.12, w * 1.4, h * 0.23);
  g.fillStyle = '#e8f6ff';
  g.beginPath(); g.ellipse(0, -h * 0.45, w * 0.22, h * 0.28, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.fillRect(-w * 0.62, h * 0.18, w * 0.3, h * 0.1); g.fillRect(w * 0.32, h * 0.18, w * 0.3, h * 0.1);
  g.restore();
}

function render(now) {
  g.fillStyle = '#000'; g.fillRect(0, 0, 600, 600);
  if (!segs.length) build(CIRCUITS[pick]);
  const s = ship || newShip();
  drawSky(now);

  const base = segAt(s.z);
  const pct = (s.z % SEG) / SEG;
  const camY = CAM_H + lerp(base.y1, base.y2, pct);
  const camZ = s.z - SEG * 2.2;    // camera sits behind the ship
  let x = 0, dx = -base.curve * pct;
  let maxY = 600;
  const list = [];
  for (let n = 0; n < DRAW; n++) {
    const seg = segs[(base.i + n) % segs.length];
    const loop = seg.i < base.i ? trackLen : 0;
    const p1 = { wx: -x, wy: seg.y1, wz: seg.i * SEG + loop };
    const p2 = { wx: -x - dx, wy: seg.y2, wz: (seg.i + 1) * SEG + loop };
    const camX = s.x * ROAD;
    project(p1, camX, camY, camZ); project(p2, camX, camY, camZ);
    x += dx; dx += seg.curve;
    seg.clip = maxY; seg.p1 = p1; seg.p2 = p2;
    list.push(seg);
    if (p1.wz - camZ <= 1 || p2.sy >= p1.sy || p2.sy >= maxY) continue;
    const fog = 1 - n / DRAW;
    g.globalAlpha = Math.min(1, fog * 1.6);
    const stripe = Math.floor(seg.i / 3) % 2;
    quad(p1.sx, p1.sy, p1.sw * 1.5, p2.sx, p2.sy, p2.sw * 1.5, circuit.side);
    quad(p1.sx, p1.sy, p1.sw * 1.12, p2.sx, p2.sy, p2.sw * 1.12, stripe ? circuit.edge : '#20283a');
    quad(p1.sx, p1.sy, p1.sw, p2.sx, p2.sy, p2.sw, circuit.road);
    if (stripe) {
      quad(p1.sx, p1.sy, p1.sw * 0.02, p2.sx, p2.sy, p2.sw * 0.02, circuit.line);
      quad(p1.sx - p1.sw * 0.5, p1.sy, p1.sw * 0.012, p2.sx - p2.sw * 0.5, p2.sy, p2.sw * 0.012, 'rgba(255,255,255,.35)');
      quad(p1.sx + p1.sw * 0.5, p1.sy, p1.sw * 0.012, p2.sx + p2.sw * 0.5, p2.sy, p2.sw * 0.012, 'rgba(255,255,255,.35)');
    }
    if (seg.pad !== false) {
      const o = seg.pad * 0.66;
      quad(p1.sx + p1.sw * o, p1.sy, p1.sw * 0.3, p2.sx + p2.sw * o, p2.sy, p2.sw * 0.3, Math.floor(now / 120) % 2 ? '#7cffd9' : '#2fd1a6');
    }
    if (seg.i === 0 || seg.i === 1) {
      // Start line chequers.
      for (let c = -4; c < 4; c++) {
        const f = (c + 0.5) / 4;
        quad(p1.sx + p1.sw * f, p1.sy, p1.sw / 8, p2.sx + p2.sw * f, p2.sy, p2.sw / 8, (c + seg.i) % 2 ? '#fff' : '#333');
      }
    }
    maxY = p2.sy;
  }
  g.globalAlpha = 1;

  // Sprites and ships, far to near, each clipped by the road drawn in front of it.
  for (let n = list.length - 1; n > 0; n--) {
    const seg = list[n];
    if (seg.p1.wz - camZ <= SEG * 0.5) continue;
    const fade = Math.min(1, (1 - n / DRAW) * 1.6);
    g.save();
    g.beginPath(); g.rect(0, 0, 600, seg.clip); g.clip();
    g.globalAlpha = fade;
    if (seg.deco) {
      const p = seg.p1, sx = p.sx + p.sw * seg.deco.side, sc = p.scale * 300;
      if (seg.deco.kind === 'pylon') {
        const h = 900 * sc, w = 70 * sc;
        g.fillStyle = '#29324a'; g.fillRect(sx - w / 2, p.sy - h, w, h);
        g.fillStyle = circuit.edge; g.fillRect(sx - w, p.sy - h - w, w * 2, w * 1.2);
      } else {
        const r = 500 * sc;
        g.fillStyle = '#4a3c2c'; g.beginPath(); g.ellipse(sx, p.sy - r * 0.7, r, r * 0.75, 0.3, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#6b5840'; g.beginPath(); g.ellipse(sx - r * 0.3, p.sy - r, r * 0.35, r * 0.25, 0.3, 0, Math.PI * 2); g.fill();
      }
    }
    if (rivals) for (const r of rivals) {
      const seg2 = segAt(r.z);
      if (seg2 !== seg) continue;
      const f = (r.z % SEG) / SEG;
      const sx = lerp(seg.p1.sx, seg.p2.sx, f) + lerp(seg.p1.sw, seg.p2.sw, f) * r.x;
      const sy = lerp(seg.p1.sy, seg.p2.sy, f);
      const w = lerp(seg.p1.sw, seg.p2.sw, f) * 0.2;
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.beginPath(); g.ellipse(sx, sy, w, w * 0.18, 0, 0, Math.PI * 2); g.fill();
      drawShip(sx, sy - w * 0.55 - Math.sin(now / 200 + r.wobble) * w * 0.05, w, r.colour, 0, 0.6);
    }
    g.restore();
  }

  // Player ship: fixed near the bottom, hovering.
  if (state !== 'menu') {
    const hover = Math.sin(now / 180) * 3;
    g.fillStyle = 'rgba(0,0,0,.55)';
    g.beginPath(); g.ellipse(300, 548, 70, 10, 0, 0, Math.PI * 2); g.fill();
    drawShip(300, 520 + hover, 74, '#7fd8ff', s.tilt, s.boost > 0 ? 1.4 : 0.5 + s.speed / MAX * 0.6);
  }

  if (state === 'menu') return drawMenu(now);
  hud(now);
  if (state === 'count') {
    const n = Math.ceil(countdown);
    label(n > 0 ? String(n) : 'GO', 300, 300, 90, n > 0 ? '#ffd34d' : '#5dffb4', 'center');
  }
  if (state === 'pause') banner(now, 'PAUSED', '#fff', 'Pinch to continue', ['Down: back to the menu']);
  if (state === 'done') {
    const lines = [
      'Time ' + GK.fmtTime(ship.total) + '   ·   best lap ' + GK.fmtTime(Math.min(...ship.lapTimes)),
    ];
    if (ship.unlock) lines.push('Unlocked: ' + ship.unlock);
    const title = mode === 'race' ? ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'][ship.place - 1] + ' PLACE' : 'FINISH';
    banner(now, title, ship.place <= 3 ? '#ffd34d' : '#7fd8ff', 'Pinch for the menu', lines);
  }
}

function hud(now) {
  const s = ship;
  plate(12, 8, 170, 62); plate(418, 8, 170, 62);
  label('LAP', 24, 30, 15, '#a9adb3');
  label(Math.min(s.lap, LAPS) + ' / ' + LAPS, 24, 60, 26);
  if (mode === 'race') { label('POS', 576, 30, 15, '#a9adb3', 'right'); label(place() + ' / ' + (RIVALS + 1), 576, 60, 26, '#ffd34d', 'right'); }
  else { label('BEST', 576, 30, 15, '#a9adb3', 'right'); label(GK.fmtTime(bestLaps[circuit.name]), 576, 60, 24, '#ffd34d', 'right'); }
  plate(220, 8, 160, 62);
  label(GK.fmtTime(raceTime - lapStart), 300, 36, 22, '#fff', 'center');
  label(Math.round(s.speed / MAX * 230) + ' km/h', 300, 60, 16, '#a9adb3', 'center');
  // Energy bar.
  plate(200, 576, 200, 14, 7, 'rgba(255,255,255,.15)');
  plate(200, 576, 200 * s.energy, 14, 7, s.energy > 0.33 ? '#7fd8ff' : '#ff6b6b');
  if (msgT > 0) label(msg, 300, 120, 26, '#5dffb4', 'center');
  if (steerMode && !GK.headLive() && GK.blink(now, 800)) label('Head steering waiting — swipe works', 300, 150, 16, '#ffb35c', 'center');
}

/* ------------------------------------------------------------------ menu */

const menuItems = () => [
  { text: () => 'Race · ' + CIRCUITS[pick].name + (pick + 1 > unlocked ? ' (locked)' : ''),
    hint: 'Left / Right: circuit · finish top 3 to unlock the next',
    left: () => { pick = (pick + CIRCUITS.length - 1) % CIRCUITS.length; build(CIRCUITS[pick]); },
    right: () => { pick = (pick + 1) % CIRCUITS.length; build(CIRCUITS[pick]); },
    act: () => { if (pick + 1 <= unlocked) startRace('race'); else beep(200, 0.2); } },
  { text: () => 'Time trial · ' + CIRCUITS[pick].name, hint: () => 'Best lap ' + GK.fmtTime(store.get('orbit.best', {})[CIRCUITS[pick].name]),
    left: () => { pick = (pick + CIRCUITS.length - 1) % CIRCUITS.length; build(CIRCUITS[pick]); },
    right: () => { pick = (pick + 1) % CIRCUITS.length; build(CIRCUITS[pick]); },
    act: () => { if (pick + 1 <= unlocked) startRace('trial'); else beep(200, 0.2); } },
  { text: () => 'Steering · ' + steerModes[steerMode], hint: 'Head steering asks for motion access once',
    left: () => setSteer((steerMode + 2) % 3), right: () => setSteer((steerMode + 1) % 3), act: () => setSteer((steerMode + 1) % 3) },
  { text: () => 'Invert head · ' + (head.invert ? 'on' : 'off'), hint: 'If the ship goes the wrong way', act: () => GK.setInvert(!head.invert) },
  { text: () => 'Sound · ' + (GK.sound.on ? 'on' : 'off'), act: () => GK.setSound(!GK.sound.on) },
];
let menu = GK.menu('GLASS ORBIT', '#7fd8ff', menuItems());

function setSteer(m) {
  steerMode = m;
  store.set('orbit.steer', m);
  if (m) GK.askHead();
}

function drawMenu(now) {
  GK.drawMenu(menu, now, 150);
  if (steerMode && GK.headLive()) label(`tilt ${head.roll.toFixed(0)}°   turn ${head.yaw.toFixed(0)}°`, 300, 590, 14, '#a9adb3', 'center');
}

/* ------------------------------------------------------------------ input */

GK.input.onKey = (k) => {
  if (state === 'menu') {
    // The permission prompt needs a gesture: ask on any key while head steering is chosen.
    if (steerMode && GK.head.state === 'off') GK.askHead();
    return GK.menuKey(menu, k);
  }
  if (k === 'Enter') {
    if (state === 'race' || state === 'count') state = 'pause';
    else if (state === 'pause') state = countdown > 0 ? 'count' : 'race';
    else if (state === 'done') state = 'menu';
    return;
  }
  if (state === 'pause' && k === 'ArrowDown') { state = 'menu'; return; }
  if (state !== 'race' && state !== 'count') return;
  if (k === 'ArrowLeft') ship.target = clamp(Math.round((ship.target - 0.45) / 0.45) * 0.45, -0.9, 0.9);
  else if (k === 'ArrowRight') ship.target = clamp(Math.round((ship.target + 0.45) / 0.45) * 0.45, -0.9, 0.9);
  else if (k === 'ArrowUp' && state === 'race') {
    if (ship.energy >= 0.33) { ship.energy -= 0.33; ship.boost = 1.6; beep(300, 0.4, 'sawtooth', 0.3, 500); }
    else beep(160, 0.1);
  } else if (k === 'ArrowDown') ship.brake = 0.55;
};

GK.loop.onHidden = () => { if (state === 'race' || state === 'count') state = 'pause'; };
GK.run(tick, render);
