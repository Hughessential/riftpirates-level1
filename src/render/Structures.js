import * as THREE from 'three';
import { P } from '../core/Palette.js';
import { buildVoxels, box, shell, cyl, sphere, ringXY, dedupe, glowSprite } from './VoxelBuilder.js';
import { rand, chance, TAU } from '../core/Utils.js';

/**
 * The five objectives, built from the concept sheets. Each builder returns
 *   { group, parts: { name -> THREE.Group } }
 * where every entry in `parts` is an independently destroyable module. The
 * encounter classes hang weak-point data off those groups; killing one hides it
 * and disables the attack it powers (spec §10, §13, §16, §19, §25).
 */

const EM = new Set([P.cyan, P.violet, P.red, P.pink, P.orange, P.amber, P.magenta, P.gold, P.green]);
const vx = (vox, s) => buildVoxels(dedupe(vox), s, { emissive: EM });

/** Pirate banner: a rectangle of cloth with a skull blotch, hung from a pole. */
function bannerVoxels(color) {
  const v = [];
  box(v, 0, 0, -8, 1, 0, 0, P.brown); // pole
  box(v, 1, 5, -7, 0, 0, 0, color, (x, y) => {
    // ragged lower edge
    if (y < -6 + (x % 2)) return false;
    return true;
  });
  // skull-and-crossbones blotch
  for (const [x, y] of [[2, -2], [3, -2], [2, -3], [3, -3], [2, -1], [3, -1], [1, -4], [4, -4]]) {
    v.push({ x, y, z: 0, c: P.white });
  }
  return v;
}

function addRubbleBelt(group, count, radius, spread, scale) {
  const rocks = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU);
    const r = radius * rand(0.7, 1.35);
    const v = [];
    const rr = Math.round(rand(1, 2));
    sphere(v, 0, 0, 0, rr, chance(0.3) ? P.stone : P.stoneDark);
    const m = vx(v, scale);
    m.position.set(Math.cos(a) * r, rand(-spread, spread), Math.sin(a) * r * 0.5);
    m.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
    m.userData.spin = { x: rand(-0.3, 0.3), y: rand(-0.3, 0.3) };
    rocks.add(m);
  }
  group.add(rocks);
  return rocks;
}

// =============================================================================
// TOWER 1 — OUTER DEFENSE TOWER (cyan / teal)
// Block fortress on an asteroid anchor: command spire, two cannon decks,
// tracking-laser emitter, two drone docks, cyan power core.
// =============================================================================
export function buildOuterTower() {
  const group = new THREE.Group();
  const parts = {};
  const S = 0.62;

  // --- asteroid anchor platform ---
  {
    const v = [];
    for (let x = -13; x <= 13; x++) {
      for (let z = -10; z <= 10; z++) {
        const d = Math.hypot(x / 13, z / 10);
        if (d > 1) continue;
        const depth = Math.round((1 - d) * 6);
        for (let y = -depth - 2; y <= -2; y++) {
          let c = y < -depth + 1 ? P.rockDark : P.stoneDark;
          if (chance(0.05)) c = P.stone;
          if (chance(0.02)) c = P.cyan; // embedded power veins
          v.push({ x, y, z, c });
        }
      }
    }
    // stalactite underside
    for (let i = 0; i < 26; i++) {
      const x = Math.round(rand(-10, 10));
      const z = Math.round(rand(-7, 7));
      const len = Math.round(rand(2, 7));
      for (let y = -9; y > -9 - len; y--) v.push({ x, y, z, c: P.rockDark });
    }
    const g = vx(v, S);
    parts.platform = new THREE.Group();
    parts.platform.add(g);
    group.add(parts.platform);
  }

  // --- stepped keep + command spire ---
  {
    const v = [];
    // tiered body, widest at the base
    const tiers = [
      [9, -2, 1], [8, 2, 4], [6, 5, 8], [5, 9, 12],
    ];
    for (const [w, y0, y1] of tiers) {
      box(v, -w, w, y0, y1, -w, w, P.stoneDark, (x, y, z) => {
        const edge = Math.abs(x) === w || Math.abs(z) === w;
        if (!edge && y < y1) return false; // hollow interior, capped top
        if (chance(0.12)) return P.stone;
        // cyan window slits
        if (edge && y % 3 === 1 && (Math.abs(x) % 4 === 1 || Math.abs(z) % 4 === 1)) return P.cyan;
        return P.stoneDark;
      });
    }
    // command spire
    box(v, -2, 2, 13, 18, -2, 2, P.stoneDark, (x, y, z) => {
      const w = 2 - Math.floor((y - 13) / 3);
      if (Math.abs(x) > w || Math.abs(z) > w) return false;
      return chance(0.15) ? P.cyan : P.stoneDark;
    });
    box(v, 0, 0, 19, 23, 0, 0, P.steel);
    v.push({ x: 0, y: 24, z: 0, c: P.cyan });
    const g = vx(v, S);
    parts.spire = new THREE.Group();
    parts.spire.add(g);
    group.add(parts.spire);
  }

  // --- cannon decks (weak points) ---
  for (const side of [-1, 1]) {
    const v = [];
    // deck platform
    box(v, -3, 3, -1, 1, -3, 3, P.stone, (x, y, z) => (chance(0.15) ? P.stoneDark : P.stone));
    // turret housing
    box(v, -2, 2, 2, 3, -2, 2, P.stoneDark);
    // barrel pointing at the player (toward +z)
    cyl(v, 0, 2, 3, 1, 7, P.black, 'z');
    v.push({ x: 0, y: 2, z: 10, c: P.orange });
    v.push({ x: 0, y: 4, z: 0, c: P.cyan }); // deck power cell
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(side * 8.2 * S * 1.35, 1.5 * S, 5 * S);
    const halo = glowSprite(P.cyan, 3.4, 0.5);
    halo.position.set(0, 2.4 * S, 0);
    grp.add(halo);
    group.add(grp);
    parts[side < 0 ? 'leftCannon' : 'rightCannon'] = grp;
  }

  // --- tracking-laser emitter (weak point) ---
  {
    const v = [];
    box(v, -3, 3, -2, 2, -2, 1, P.stoneDark);
    // dish
    for (let x = -3; x <= 3; x++) {
      for (let y = -3; y <= 3; y++) {
        if (x * x + y * y > 10) continue;
        v.push({ x, y, z: 2, c: x * x + y * y < 3 ? P.cyan : P.steel });
      }
    }
    v.push({ x: 0, y: 0, z: 4, c: P.cyan });
    v.push({ x: 0, y: 0, z: 3, c: P.white });
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(0, 13.5 * S, 4 * S);
    const halo = glowSprite(P.cyan, 4.2, 0.6);
    halo.position.z = 2.5 * S;
    grp.add(halo);
    parts.emitter = grp;
    group.add(grp);
  }

  // --- drone docks (weak points) ---
  for (const side of [-1, 1]) {
    const v = [];
    box(v, -2, 2, 0, 3, -2, 2, P.stoneDark);
    // open hangar mouth facing the player
    box(v, -1, 1, 1, 2, 3, 3, P.cyan);
    box(v, -3, 3, -1, -1, -2, 3, P.steel);
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(side * 5.5 * S * 1.4, 6.5 * S, 6 * S);
    parts[side < 0 ? 'dockL' : 'dockR'] = grp;
    group.add(grp);
  }

  // --- power core (final weak point, protected until modules fall) ---
  {
    const v = [];
    sphere(v, 0, 0, 0, 3, P.cyan, (x, y, z) => {
      const d = Math.hypot(x, y, z);
      if (d > 3) return false;
      return d > 2.1 ? P.teal : P.cyan;
    });
    box(v, -4, 4, -4, 4, -1, 1, P.stoneDark, (x, y) =>
      Math.abs(x) === 4 || Math.abs(y) === 4 ? P.steel : false
    );
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(0, 6.5 * S, 6.5 * S);
    const halo = glowSprite(P.cyan, 7, 0.75);
    grp.add(halo);
    grp.userData.halo = halo;
    parts.core = grp;
    group.add(grp);
  }

  // --- banners ---
  const banners = new THREE.Group();
  for (const side of [-1, 1]) {
    const b = vx(bannerVoxels(P.teal), S);
    b.position.set(side * 10 * S, 8 * S, 3 * S);
    b.rotation.y = side * -0.3;
    banners.add(b);
  }
  parts.banners = banners;
  group.add(banners);

  parts.rubble = addRubbleBelt(group, 14, 12, 6, 0.5);

  return { group, parts };
}

// =============================================================================
// TOWER 2 — MIDRIFT PRESSURE TOWER (purple / violet)
// Tall, unstable spike wrapped in orbiting energy rings, with a rift beam
// firing upward out of the core.
// =============================================================================
export function buildMidriftTower() {
  const group = new THREE.Group();
  const parts = {};
  const S = 0.6;

  // --- anchor base + pressure generator (weak point) ---
  {
    const v = [];
    for (let x = -11; x <= 11; x++) {
      for (let z = -9; z <= 9; z++) {
        const d = Math.hypot(x / 11, z / 9);
        if (d > 1) continue;
        for (let y = -6; y <= -3; y++) {
          v.push({ x, y, z, c: chance(0.12) ? P.stone : P.stoneDark });
        }
      }
    }
    // heavy underside machinery
    for (let i = 0; i < 14; i++) {
      const x = Math.round(rand(-8, 8));
      const z = Math.round(rand(-6, 6));
      box(v, x, x + 1, -10, -7, z, z + 1, chance(0.3) ? P.orange : P.stoneDark);
    }
    const g = vx(v, S);
    parts.base = new THREE.Group();
    parts.base.add(g);
    group.add(parts.base);
  }

  {
    const v = [];
    box(v, -5, 5, -2, 1, -5, 5, P.stoneDark, (x, y, z) => {
      const edge = Math.abs(x) >= 4 || Math.abs(z) >= 4;
      if (!edge) return false;
      return y === 0 && chance(0.5) ? P.orange : P.stoneDark;
    });
    // emitter vents ringing the generator
    ringXY(v, 0, 0, 0, 6, P.violet, 16, (i) => (i % 2 === 0 ? P.violet : false));
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(0, -2 * S, 6 * S);
    grp.rotation.x = -Math.PI / 2;
    const halo = glowSprite(P.violet, 6, 0.5);
    grp.add(halo);
    parts.pressureGen = grp;
    group.add(grp);
  }

  // --- tall central tower ---
  {
    const v = [];
    for (let y = -2; y <= 30; y++) {
      const w = Math.max(2, Math.round(7 - y * 0.16));
      box(v, -w, w, y, y, -w, w, P.stoneDark, (x, _y, z) => {
        const edge = Math.abs(x) === w || Math.abs(z) === w;
        if (!edge) return false;
        if (chance(0.08)) return P.stone;
        if (y % 5 === 0 && chance(0.35)) return P.violet;
        if (y % 7 === 3 && chance(0.2)) return P.orange; // furnace windows
        return P.stoneDark;
      });
      // jutting debris shelves make it read as unstable
      if (y % 6 === 2) {
        const sd = y % 12 === 2 ? 1 : -1;
        box(v, sd * w, sd * (w + 3), y, y, -2, 2, P.stone);
      }
    }
    const g = vx(v, S);
    parts.tower = new THREE.Group();
    parts.tower.add(g);
    group.add(parts.tower);
  }

  // --- orbiting energy rings (rotating groups, spec §13) ---
  parts.rings = new THREE.Group();
  parts.rings.position.y = 12 * S;
  const ringDefs = [
    { r: 13, tilt: 0.35, speed: 0.55 },
    { r: 10, tilt: -0.6, speed: -0.8 },
    { r: 16, tilt: 0.15, speed: 0.35 },
  ];
  parts.ringMeshes = [];
  for (const def of ringDefs) {
    const v = [];
    ringXY(v, 0, 0, 0, def.r, P.violet, Math.round(def.r * 5), (i) =>
      i % 3 === 0 ? P.magenta : P.violet
    );
    const g = vx(v, S * 0.9);
    const holder = new THREE.Group();
    holder.add(g);
    holder.rotation.x = Math.PI / 2 + def.tilt;
    holder.userData.speed = def.speed;
    parts.rings.add(holder);
    parts.ringMeshes.push(holder);
  }
  group.add(parts.rings);

  // --- gravity-ring generator (weak point) ---
  {
    const v = [];
    cyl(v, 0, -2, 0, 5, 4, P.stoneDark, 'y', (x, y, z) => {
      const d = Math.hypot(x, z);
      if (d < 3) return false;
      return chance(0.25) ? P.violet : P.stoneDark;
    });
    ringXY(v, 0, 0, 0, 6, P.magenta, 20);
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(0, 12 * S, 4 * S);
    const halo = glowSprite(P.violet, 8, 0.6);
    grp.add(halo);
    parts.gravityGen = grp;
    group.add(grp);
  }

  // --- heavy weapon decks (weak points) ---
  for (const side of [-1, 1]) {
    const v = [];
    box(v, -3, 3, -2, 2, -3, 2, P.stoneDark, () => (chance(0.2) ? P.stone : P.stoneDark));
    // twin heavy barrels
    for (const dy of [-1, 1]) {
      cyl(v, 0, dy, 2, 1, 6, P.black, 'z');
      v.push({ x: 0, y: dy, z: 8, c: P.orange });
    }
    box(v, -4, 4, 3, 3, -2, 1, P.steel);
    v.push({ x: 0, y: 4, z: 0, c: P.violet });
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(side * 8 * S, 20 * S, 5 * S);
    const halo = glowSprite(P.orange, 3, 0.5);
    grp.add(halo);
    group.add(grp);
    parts[side < 0 ? 'leftDeck' : 'rightDeck'] = grp;
  }

  // --- rift core (final weak point) + upward rift beam ---
  {
    const v = [];
    sphere(v, 0, 0, 0, 3, P.violet, (x, y, z) => {
      const d = Math.hypot(x, y, z);
      return d > 2.2 ? P.magenta : P.violet;
    });
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(0, 31 * S, 2 * S);
    const halo = glowSprite(P.magenta, 9, 0.8);
    grp.add(halo);
    grp.userData.halo = halo;
    parts.core = grp;
    group.add(grp);

    // rift-energy beam extending upward
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 1.1, 40, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: P.violet,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    beam.position.set(0, 31 * S + 20, 2 * S);
    parts.riftBeam = beam;
    group.add(beam);
  }

  parts.rubble = addRubbleBelt(group, 18, 14, 12, 0.5);

  return { group, parts };
}

// =============================================================================
// TOWER 3 — INNER CITADEL (red / pink / dark metal)
// A wide fortified keep rather than a spire: perimeter walls, shield
// generators, elite docking bay, crossfire turrets.
// =============================================================================
export function buildInnerCitadel() {
  const group = new THREE.Group();
  const parts = {};
  const S = 0.6;

  // --- foundation + heavy underside machinery ---
  {
    const v = [];
    box(v, -16, 16, -4, -1, -12, 12, P.stoneDark, (x, y, z) => {
      const d = Math.hypot(x / 16, z / 12);
      if (d > 1) return false;
      return chance(0.12) ? P.stone : P.stoneDark;
    });
    for (let i = 0; i < 22; i++) {
      const x = Math.round(rand(-12, 12));
      const z = Math.round(rand(-9, 9));
      const len = Math.round(rand(2, 6));
      box(v, x, x + 1, -4 - len, -5, z, z + 1, chance(0.25) ? P.red : P.stoneDark);
    }
    const g = vx(v, S);
    parts.foundation = new THREE.Group();
    parts.foundation.add(g);
    group.add(parts.foundation);
  }

  // --- perimeter walls with crenellations ---
  {
    const v = [];
    shell(v, -15, 15, 0, 5, -11, 11, P.stoneDark, (x, y, z) => {
      if (y > 5) return false;
      // leave the front open so the player can see in
      if (z === 11) return false;
      if (chance(0.1)) return P.stone;
      if (y === 5 && (x + z) % 3 === 0) return false; // crenellation gaps
      if (y === 2 && chance(0.06)) return P.red; // wall lights
      return P.stoneDark;
    });
    const g = vx(v, S);
    parts.walls = new THREE.Group();
    parts.walls.add(g);
    group.add(parts.walls);
  }

  // --- central keep ---
  {
    const v = [];
    const tiers = [[8, 4, 9], [6, 10, 15], [4, 16, 20]];
    for (const [w, y0, y1] of tiers) {
      box(v, -w, w, y0, y1, -w, w, P.stoneDark, (x, y, z) => {
        const edge = Math.abs(x) === w || Math.abs(z) === w;
        if (!edge && y < y1) return false;
        if (chance(0.1)) return P.stone;
        if (y % 4 === 1 && chance(0.25)) return P.red;
        return P.stoneDark;
      });
    }
    // corner spires
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(v, sx * 8, sx * 8, 21, 25, sz * 8, sz * 8, P.stoneDark);
        v.push({ x: sx * 8, y: 26, z: sz * 8, c: P.red });
      }
    }
    const g = vx(v, S);
    parts.keep = new THREE.Group();
    parts.keep.add(g);
    group.add(parts.keep);
  }

  // --- shield generators A / B (weak points, must die before the core) ---
  for (const side of [-1, 1]) {
    const v = [];
    cyl(v, 0, 0, 0, 3, 7, P.stoneDark, 'y', (x, y, z) => {
      const d = Math.hypot(x, z);
      if (d > 3) return false;
      return chance(0.2) ? P.steel : P.stoneDark;
    });
    // emitter crown
    ringXY(v, 0, 0, 0, 4, P.violet, 14);
    sphere(v, 0, 8, 0, 2, P.violet);
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(side * 12 * S, 6 * S, 6 * S);
    const halo = glowSprite(P.violet, 5, 0.7);
    halo.position.y = 8 * S;
    grp.add(halo);
    group.add(grp);
    parts[side < 0 ? 'shieldGenA' : 'shieldGenB'] = grp;
  }

  // --- hex shield dome (visual; hidden when both generators die) ---
  {
    const dome = new THREE.Mesh(
      new THREE.IcosahedronGeometry(13, 1),
      new THREE.MeshBasicMaterial({
        color: P.violet,
        transparent: true,
        opacity: 0.16,
        wireframe: true,
        depthWrite: false,
      })
    );
    dome.position.set(0, 8 * S, 2);
    parts.shieldDome = dome;
    group.add(dome);
  }

  // --- elite docking bay (weak point — kills reinforcement rate) ---
  {
    const v = [];
    box(v, -6, 6, 0, 4, -3, 3, P.stoneDark);
    box(v, -5, 5, 1, 3, 4, 4, P.red); // open hangar mouth
    box(v, -7, 7, -1, -1, -3, 4, P.steel);
    // landing lights
    for (let x = -5; x <= 5; x += 2) v.push({ x, y: 0, z: 5, c: P.pink });
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(0, 2 * S, 9 * S);
    const halo = glowSprite(P.red, 5, 0.5);
    halo.position.z = 2;
    grp.add(halo);
    parts.dock = grp;
    group.add(grp);
  }

  // --- crossfire turrets (weak points — killing them opens up safe space) ---
  for (const side of [-1, 1]) {
    const v = [];
    box(v, -2, 2, 0, 2, -2, 2, P.stoneDark);
    cyl(v, 0, 1, 2, 1, 6, P.black, 'z');
    v.push({ x: 0, y: 1, z: 9, c: P.red });
    box(v, -3, 3, 3, 3, -1, 1, P.steel);
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(side * 15 * S, 7 * S, 8 * S);
    const halo = glowSprite(P.red, 3, 0.55);
    grp.add(halo);
    group.add(grp);
    parts[side < 0 ? 'turretL' : 'turretR'] = grp;
  }

  // --- citadel core ---
  {
    const v = [];
    sphere(v, 0, 0, 0, 3, P.red, (x, y, z) => (Math.hypot(x, y, z) > 2.2 ? P.pink : P.red));
    box(v, -5, 5, -5, 5, -1, 0, P.stoneDark, (x, y) =>
      Math.abs(x) === 5 || Math.abs(y) === 5 ? P.steel : false
    );
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(0, 12 * S, 5 * S);
    const halo = glowSprite(P.red, 8, 0.8);
    grp.add(halo);
    grp.userData.halo = halo;
    parts.core = grp;
    group.add(grp);
  }

  // --- banners (burn away on death) ---
  const banners = new THREE.Group();
  for (const [x, y] of [[-9, 14], [9, 14], [-4, 18], [4, 18]]) {
    const b = vx(bannerVoxels(P.red), S * 1.1);
    b.position.set(x * S, y * S, 7 * S);
    banners.add(b);
  }
  parts.banners = banners;
  group.add(banners);

  parts.rubble = addRubbleBelt(group, 16, 18, 8, 0.5);

  return { group, parts };
}

// =============================================================================
// INHIBITOR CORE (orange / amber)
// A machine, not a tower: a great arch clamped around a floating crystal, held
// by locking braces and anchor chains, with three overload conduits.
// =============================================================================
export function buildInhibitor() {
  const group = new THREE.Group();
  const parts = {};
  const S = 0.6;

  // --- outer arch / frame ---
  {
    const v = [];
    // thick blocky ring facing the player
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * TAU;
      for (let t = 0; t < 4; t++) {
        const r = 15 + t;
        const x = Math.round(Math.cos(a) * r);
        const y = Math.round(Math.sin(a) * r);
        for (let z = -3; z <= 2; z++) {
          let c = P.stoneDark;
          if (chance(0.1)) c = P.stone;
          if (t === 0 && chance(0.25)) c = P.orange; // inner rim glow channel
          v.push({ x, y, z, c });
        }
      }
    }
    // corner buttresses
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        box(v, sx * 12, sx * 18, sy * 12, sy * 18, -4, 2, P.stoneDark, (x, y) => {
          if (Math.hypot(x, y) < 15 || Math.hypot(x, y) > 20) return false;
          return chance(0.15) ? P.amber : P.stoneDark;
        });
      }
    }
    const g = vx(v, S);
    parts.frame = new THREE.Group();
    parts.frame.add(g);
    group.add(parts.frame);
  }

  // --- locking braces (4 clamps holding the crystal) ---
  parts.braces = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const v = [];
    box(v, -2, 2, 0, 9, -2, 2, P.stoneDark, (x, y, z) =>
      chance(0.2) ? P.steel : P.stoneDark
    );
    box(v, -3, 3, 0, 1, -3, 3, P.steel);
    v.push({ x: 0, y: 10, z: 0, c: P.orange });
    const g = vx(v, S);
    g.position.set(Math.cos(a) * 8, Math.sin(a) * 8, 0);
    g.rotation.z = a - Math.PI / 2;
    parts.braces.add(g);
  }
  group.add(parts.braces);

  // --- rotating shield arcs (block player fire; must shoot the gaps) ---
  parts.shields = new THREE.Group();
  parts.shieldArcs = [];
  for (let s = 0; s < 2; s++) {
    const holder = new THREE.Group();
    const arcCount = 3;
    for (let i = 0; i < arcCount; i++) {
      const a0 = (i / arcCount) * TAU;
      const geo = new THREE.RingGeometry(
        s === 0 ? 6.5 : 9.5,
        s === 0 ? 8.2 : 11.2,
        16,
        1,
        a0,
        TAU / arcCount * 0.62
      );
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: s === 0 ? P.amber : P.orange,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      holder.add(m);
    }
    holder.userData.speed = s === 0 ? 0.75 : -0.5;
    holder.userData.inner = s === 0;
    parts.shields.add(holder);
    parts.shieldArcs.push(holder);
  }
  group.add(parts.shields);

  // --- overload conduits (the three sequential weak points) ---
  parts.conduitList = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI / 2;
    const v = [];
    box(v, -2, 2, -6, 6, -2, 2, P.stoneDark, (x, y, z) => {
      const edge = Math.abs(x) === 2 || Math.abs(z) === 2;
      if (!edge) return false;
      return Math.abs(y) % 3 === 0 ? P.orange : P.stoneDark;
    });
    sphere(v, 0, 0, 0, 3, P.amber, (x, y, z) => (Math.hypot(x, y, z) > 2 ? P.orange : P.amber));
    // muzzle facing outward
    cyl(v, 0, 0, 2, 1, 5, P.black, 'z');
    v.push({ x: 0, y: 0, z: 7, c: P.orange });
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(Math.cos(a) * 12.5, Math.sin(a) * 12.5, 1);
    grp.rotation.z = a;
    const halo = glowSprite(P.orange, 5, 0.7);
    grp.add(halo);
    grp.userData.halo = halo;
    grp.userData.angle = a;
    parts[`conduit${i}`] = grp;
    parts.conduitList.push(grp);
    group.add(grp);
  }

  // --- central crystal core ---
  {
    const core = new THREE.Group();
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(4.2, 0),
      new THREE.MeshBasicMaterial({ color: P.amber })
    );
    const cage = new THREE.Mesh(
      new THREE.OctahedronGeometry(5.4, 0),
      new THREE.MeshBasicMaterial({ color: P.orange, wireframe: true, transparent: true, opacity: 0.9 })
    );
    core.add(crystal);
    core.add(cage);
    const halo = glowSprite(P.orange, 18, 0.85);
    core.add(halo);
    core.userData.crystal = crystal;
    core.userData.cage = cage;
    core.userData.halo = halo;
    core.position.z = 1;
    parts.core = core;
    group.add(core);
  }

  // --- anchor rings + chains trailing off into the void ---
  {
    const v = [];
    for (const sx of [-1, 1]) {
      ringXY(v, sx * 22, 0, 0, 4, P.steel, 18);
      // chain links running outward
      for (let i = 0; i < 9; i++) {
        const x = sx * (26 + i * 3);
        const y = Math.round(Math.sin(i * 0.7) * 2);
        box(v, x, x + 1, y, y, -1, 0, i % 2 ? P.stoneDark : P.steel);
      }
    }
    const g = vx(v, S);
    parts.anchors = new THREE.Group();
    parts.anchors.add(g);
    group.add(parts.anchors);
  }

  parts.rubble = addRubbleBelt(group, 12, 20, 10, 0.5);

  return { group, parts };
}

// =============================================================================
// THE RIFT ADMIRAL (purple / magenta / gold)
// A pirate admiral fused to a fortress. Scale is the point: this must dwarf
// every structure before it.
// =============================================================================
export function buildRiftAdmiral() {
  const group = new THREE.Group();
  const parts = {};
  const S = 0.75;

  // --- fortress body ---
  {
    const v = [];
    box(v, -22, 22, -14, 2, -8, 6, P.stoneDark, (x, y, z) => {
      // taper the hull toward the bottom
      const w = 22 - Math.max(0, (-y - 2) * 0.9);
      if (Math.abs(x) > w) return false;
      const edge = Math.abs(x) > w - 2 || y === 2 || y === -14 || Math.abs(z) >= 6;
      if (!edge) return false;
      if (chance(0.08)) return P.stone;
      if (chance(0.05)) return P.magenta;
      if (y % 5 === 0 && chance(0.12)) return P.gold; // gilded trim
      return P.stoneDark;
    });
    // gun ports / windows along the broadside
    for (let x = -18; x <= 18; x += 4) {
      for (const y of [-3, -8]) {
        box(v, x, x + 1, y, y + 1, 6, 6, P.orange);
      }
    }
    // keel spike
    box(v, -2, 2, -22, -14, -2, 2, P.stoneDark);
    v.push({ x: 0, y: -23, z: 0, c: P.magenta });
    const g = vx(v, S);
    parts.body = new THREE.Group();
    parts.body.add(g);
    group.add(parts.body);
  }

  // --- the admiral's skull visage ---
  {
    const v = [];
    // cranium
    sphere(v, 0, 0, 0, 8, P.light, (x, y, z) => {
      if (y < -3) return false;
      const d = Math.hypot(x, y, z);
      if (d > 8) return false;
      return d > 6.8 ? P.gray : P.light;
    });
    // jaw
    box(v, -6, 6, -8, -3, -5, 5, P.light, (x, y, z) => {
      if (Math.hypot(x / 6, z / 5) > 1) return false;
      if (y === -8 && (x % 2 === 0)) return P.gray; // teeth
      return P.light;
    });
    // The player/cinematic camera approach from +Z, like the gun ports below.
    // Keep the face on that side so the reveal never presents a blank skull.
    for (const sx of [-3, 3]) {
      box(v, sx - 1, sx + 1, 0, 2, 6, 8, P.black);
    }
    // beard, braided into the hull
    for (let x = -5; x <= 5; x++) {
      const len = 5 - Math.abs(x) * 0.5;
      for (let y = -9; y > -9 - len; y--) {
        v.push({ x, y: Math.round(y), z: Math.round(rand(-3, 1)), c: chance(0.2) ? P.gold : P.gray });
      }
    }
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(0, 16 * S, -2 * S);
    parts.skull = grp;
    group.add(grp);

    // eyes (separate emissive sprites so phases can brighten them)
    parts.eyes = [];
    for (const sx of [-3, 3]) {
      const e = glowSprite(P.magenta, 3.2, 0.95);
      e.position.set(sx * S, 17 * S, 7 * S);
      group.add(e);
      parts.eyes.push(e);
    }
  }

  // --- the hat: massive tricorn with a gold skull badge ---
  {
    const v = [];
    // brim
    for (let x = -16; x <= 16; x++) {
      for (let z = -12; z <= 10; z++) {
        const d = Math.hypot(x / 16, z / 11);
        if (d > 1) continue;
        const y = Math.round(Math.abs(x) * 0.18) + Math.round(Math.abs(z) * 0.1);
        v.push({ x, y, z, c: P.black });
      }
    }
    // crown
    box(v, -8, 8, 1, 8, -6, 5, P.black, (x, y, z) => {
      const w = 8 - Math.floor((y - 1) * 0.5);
      if (Math.abs(x) > w) return false;
      return P.black;
    });
    // gold band + skull badge
    box(v, -8, 8, 2, 3, -6, 5, P.gold, (x, y, z) => (Math.abs(z) >= 5 || Math.abs(x) >= 7 ? P.gold : false));
    sphere(v, 0, 5, 6, 3, P.gold);
    for (const sx of [-1, 1]) v.push({ x: sx, y: 6, z: 8, c: P.black });
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(0, 24 * S, -2 * S);
    parts.hat = grp;
    group.add(grp);
  }

  // --- cannon batteries (weak points) ---
  for (const side of [-1, 1]) {
    const v = [];
    box(v, -4, 4, -3, 3, -4, 4, P.stoneDark, () => (chance(0.15) ? P.gold : P.stoneDark));
    // triple heavy barrels
    for (const dy of [-2, 0, 2]) {
      cyl(v, 0, dy, 4, 1, 12, P.black, 'z');
      v.push({ x: 0, y: dy, z: 17, c: P.magenta });
    }
    box(v, -5, 5, 4, 4, -3, 3, P.steel);
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(side * 24 * S, 2 * S, 4 * S);
    const halo = glowSprite(P.magenta, 6, 0.6);
    halo.position.z = 8 * S;
    grp.add(halo);
    group.add(grp);
    parts[side < 0 ? 'cannonL' : 'cannonR'] = grp;
  }

  // --- mechanical tendrils ---
  parts.tendrils = [];
  const tendrilGroup = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const arm = new THREE.Group();
    const segs = 7;
    for (let s = 0; s < segs; s++) {
      const v = [];
      const r = 3 - s * 0.3;
      box(v, -Math.round(r), Math.round(r), -Math.round(r), Math.round(r), 0, 3, P.stoneDark, () =>
        chance(0.2) ? P.violet : P.stoneDark
      );
      const seg = vx(v, S * 0.8);
      seg.position.z = s * 3 * S * 0.8;
      seg.userData.index = s;
      arm.add(seg);
    }
    const tip = glowSprite(P.violet, 3, 0.8);
    tip.position.z = segs * 3 * S * 0.8;
    arm.add(tip);

    const a = (i / 6) * Math.PI - Math.PI / 2;
    arm.position.set(Math.cos(a) * 18 * S, -6 * S + Math.sin(a) * 4, 2);
    arm.rotation.y = Math.PI + a * 0.4;
    arm.rotation.x = 0.3;
    arm.userData.base = { rx: arm.rotation.x, ry: arm.rotation.y };
    arm.userData.phase = i * 0.9;
    tendrilGroup.add(arm);
    parts.tendrils.push(arm);
  }
  parts.tendrilGroup = tendrilGroup;
  group.add(tendrilGroup);

  // --- tendril control node (weak point — slows the sweeps) ---
  {
    const v = [];
    box(v, -3, 3, -3, 3, -2, 2, P.stoneDark);
    ringXY(v, 0, 0, 3, 5, P.violet, 16);
    sphere(v, 0, 0, 2, 2, P.violet);
    const g = vx(v, S);
    const grp = new THREE.Group();
    grp.add(g);
    grp.position.set(0, -10 * S, 6 * S);
    const halo = glowSprite(P.violet, 5, 0.7);
    grp.add(halo);
    parts.tendrilControl = grp;
    group.add(grp);
  }

  // --- the Nexus core (opens only during damage windows) ---
  {
    const core = new THREE.Group();
    const shellMesh = new THREE.Mesh(
      new THREE.TorusGeometry(6, 1.4, 6, 16),
      new THREE.MeshLambertMaterial({ color: P.stoneDark })
    );
    // iris plates that retract when the core opens
    const plates = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(4.6, 2.2, 1.4),
        new THREE.MeshLambertMaterial({ color: P.steel })
      );
      p.position.set(Math.cos(a) * 3, Math.sin(a) * 3, 0.6);
      p.rotation.z = a;
      p.userData.angle = a;
      plates.add(p);
    }
    const crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(3.4, 0),
      new THREE.MeshBasicMaterial({ color: P.magenta })
    );
    crystal.position.z = -0.5;
    const halo = glowSprite(P.magenta, 14, 0);
    core.add(shellMesh);
    core.add(plates);
    core.add(crystal);
    core.add(halo);
    core.position.set(0, 0, 7 * S);
    core.userData = { plates, crystal, halo, shellMesh };
    parts.core = core;
    group.add(core);
  }

  // --- hanging chains ---
  {
    const v = [];
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 14; i++) {
        const x = sx * (26 + i * 2);
        const y = -2 - i * 2 + Math.round(Math.sin(i * 0.8) * 2);
        box(v, x, x + 1, y, y + 1, -1, 0, i % 2 ? P.stoneDark : P.steel);
      }
    }
    const g = vx(v, S);
    parts.chains = new THREE.Group();
    parts.chains.add(g);
    group.add(parts.chains);
  }

  return { group, parts };
}
