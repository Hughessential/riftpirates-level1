import { P } from '../core/Palette.js';
import { box, sphere, dedupe } from './VoxelBuilder.js';
import { rand, chance } from '../core/Utils.js';

/** The Star Hopper, rebuilt from the Goxel sheets in the original prototype. */
export function hopperVoxels() {
  const v = [];
  const add = (x, y, z, c) => v.push({ x, y, z, c });

  // fuselage
  for (let z = -6; z <= 5; z++) {
    for (let x = -1; x <= 1; x++) {
      for (let y = 0; y <= 1; y++) {
        if (z === -6 && x !== 0) continue;
        add(x, y, z, P.hull);
      }
    }
  }
  add(0, 0, -7, P.orange);
  add(0, 1, -6, P.orange);
  add(0, 2, -1, P.cyan);
  add(0, 2, 0, P.cyan);
  for (let z = 2; z <= 4; z++) add(0, 2, z, P.hull);
  add(0, 3, 3, P.orange);
  add(0, 3, 4, P.orange);

  // twin tail fins
  for (const fx of [-2, 2]) {
    for (let y = 1; y <= 4; y++) add(fx, y, 4, P.hull);
    add(fx, 5, 4, P.green);
  }

  // swept wings with serrated trailing edge
  for (let side = -1; side <= 1; side += 2) {
    for (let wx = 2; wx <= 10; wx++) {
      const lead = -3 + Math.floor((wx - 2) * 0.55);
      const w = 7 - Math.floor((wx - 2) * 0.55) - (wx % 2 ? 1 : 0);
      for (let z = lead; z < lead + w; z++) {
        const c = wx === 3 || wx === 8 || wx === 10 ? P.green : P.hull;
        add(side * wx, 0, z, c);
        if (wx <= 3) add(side * wx, 1, z, P.hull);
      }
    }
  }

  // engine pods
  for (const sd of [-1, 1]) {
    for (let z = 0; z <= 5; z++) {
      for (let x = 1; x <= 2; x++) add(sd * x, -1, z, P.hullDark);
    }
    add(sd * 1, -1, 0, P.light);
    add(sd * 2, -1, 0, P.light);
    add(sd * 1, -1, 6, P.red);
    add(sd * 2, -1, 6, P.orange);
  }
  return v;
}

// ---- enemy roster (spec §32) ------------------------------------------------

export function scoutDroneVoxels(tint = P.cyan) {
  const v = [{ x: 0, y: 0, z: 0, c: P.black }];
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) v.push({ x, y: 0, z, c: P.hull });
  for (const [x, z] of [[2, 0], [-2, 0]]) v.push({ x, y: 0, z, c: P.hullDark });
  v.push({ x: 0, y: 0, z: -2, c: tint });
  v.push({ x: 0, y: 1, z: 0, c: tint });
  return v;
}

export function gunshipVoxels(tint = P.orange) {
  const v = [];
  box(v, -1, 1, 0, 1, -2, 2, P.hull);
  for (let z = -1; z <= 1; z++) {
    v.push({ x: -2, y: 0, z, c: P.hullDark });
    v.push({ x: 2, y: 0, z, c: P.hullDark });
  }
  v.push({ x: -1, y: 0, z: -3, c: tint });
  v.push({ x: 1, y: 0, z: -3, c: tint });
  v.push({ x: 0, y: 1, z: -2, c: P.cyan });
  v.push({ x: -2, y: 0, z: 2, c: P.magenta });
  v.push({ x: 2, y: 0, z: 2, c: P.magenta });
  return v;
}

export function heavyGunnerVoxels(tint = P.red) {
  const v = [];
  box(v, -2, 2, -1, 2, -3, 3, P.stoneDark);
  box(v, -1, 1, 0, 1, -4, -3, P.steel);
  // twin heavy barrels
  for (const sx of [-2, 2]) {
    box(v, sx, sx, 0, 0, -5, -2, P.black);
    v.push({ x: sx, y: 0, z: -6, c: tint });
  }
  box(v, -1, 1, 3, 3, -1, 1, P.stone);
  v.push({ x: 0, y: 3, z: -2, c: tint });
  // engine glow
  for (const sx of [-1, 1]) v.push({ x: sx, y: 0, z: 4, c: P.orange });
  return v;
}

export function shieldDroneVoxels() {
  const v = [];
  sphere(v, 0, 0, 0, 2, P.steel, (x, y, z) => (Math.abs(x) + Math.abs(y) + Math.abs(z) > 3 ? false : true));
  v.push({ x: 0, y: 0, z: -3, c: P.cyan });
  // emitter prongs
  for (const [x, y] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) v.push({ x, y, z: 0, c: P.cyan });
  return v;
}

export function eliteCaptainVoxels() {
  const v = [];
  box(v, -2, 2, 0, 1, -3, 3, P.stoneDark);
  box(v, -1, 1, 2, 2, -1, 2, P.red);
  // forward-swept wings
  for (const sd of [-1, 1]) {
    for (let w = 3; w <= 5; w++) {
      const z = -1 + (w - 3);
      box(v, sd * w, sd * w, 0, 0, z, z + 2, w === 5 ? P.pink : P.stone);
    }
  }
  v.push({ x: -1, y: 0, z: -4, c: P.pink });
  v.push({ x: 1, y: 0, z: -4, c: P.pink });
  v.push({ x: 0, y: 2, z: -2, c: P.gold });
  for (const sx of [-2, 0, 2]) v.push({ x: sx, y: 0, z: 4, c: P.magenta });
  return v;
}

// ---- environment ------------------------------------------------------------

export function asteroidVoxels(r) {
  const v = [];
  for (let x = -r; x <= r; x++) {
    for (let y = -r; y <= r; y++) {
      for (let z = -r; z <= r; z++) {
        const d = Math.sqrt(x * x + y * y + z * z);
        if (d > r * (0.72 + Math.random() * 0.32)) continue;
        let c = P.rockDark;
        const rr = Math.random();
        if (rr < 0.14) c = P.hullDark;
        else if (rr < 0.2 && d > r * 0.7) c = P.orange;
        else if (rr < 0.24) c = P.black;
        v.push({ x, y, z, c });
      }
    }
  }
  return v;
}

export function debrisVoxels() {
  return [
    { x: 0, y: 0, z: 0, c: P.rockDark },
    { x: 1, y: 0, z: 0, c: P.hullDark },
    { x: 0, y: 1, z: 0, c: P.stone },
  ];
}

export function scrapChunkVoxels() {
  const v = [];
  box(v, 0, 1, 0, 1, 0, 1, P.magenta, () => (chance(0.35) ? P.gold : P.magenta));
  return v;
}

/** Distant voxel planet parked in the backdrop, as in the key art. */
export function planetVoxels() {
  const v = [];
  const R = 8;
  for (let x = -R; x <= R; x++) {
    for (let y = -R; y <= R; y++) {
      for (let z = -R; z <= R; z++) {
        const d = Math.sqrt(x * x + y * y + z * z);
        if (Math.abs(d - R) > 0.55) continue;
        const band = (y + R) / (2 * R);
        let c = band < 0.33 ? '#2A1E7A' : band < 0.66 ? P.hullDark : P.hull;
        if (Math.random() < 0.03) c = P.cyan;
        v.push({ x, y, z, c });
      }
    }
  }
  return v;
}

/** Broken pirate hulks drifting in the traversal sectors. */
export function wreckVoxels() {
  const v = [];
  const len = 10;
  for (let z = -len; z <= len; z++) {
    const w = Math.max(0, 2 - Math.floor(Math.abs(z) / 6));
    box(v, -w, w, 0, 1, z, z, chance(0.2) ? P.rockDark : P.stoneDark);
  }
  for (const sd of [-1, 1]) box(v, sd * 3, sd * 5, 0, 0, -2, 2, P.stone);
  v.push({ x: 0, y: 2, z: -1, c: P.orange });
  return dedupe(v);
}

/** Anchor pylons flanking the Inhibitor approach. */
export function pylonVoxels() {
  const v = [];
  for (let y = -6; y <= 6; y++) {
    v.push({ x: 0, y, z: 0, c: y % 3 === 0 ? P.amber : P.stoneDark });
  }
  v.push({ x: 0, y: 7, z: 0, c: P.orange });
  v.push({ x: 0, y: -7, z: 0, c: P.orange });
  for (const sx of [-1, 1]) {
    v.push({ x: sx, y: 0, z: 0, c: P.steel });
    v.push({ x: sx, y: 3, z: 0, c: P.steel });
    v.push({ x: sx, y: -3, z: 0, c: P.steel });
  }
  return v;
}

/** Laser-gate pylon pair used as a moving obstacle in Traversal 2. */
export function gatePylonVoxels() {
  const v = [];
  for (let y = -4; y <= 4; y++) v.push({ x: 0, y, z: 0, c: y % 2 === 0 ? P.hullDark : P.gray });
  v.push({ x: 0, y: 5, z: 0, c: P.magenta });
  v.push({ x: 0, y: -5, z: 0, c: P.magenta });
  return v;
}

/** A tumbling scrap crate — the traversal reward pickup. */
export function crateVoxels() {
  const v = [];
  box(v, -1, 1, -1, 1, -1, 1, P.brown, (x, y, z) =>
    Math.abs(x) + Math.abs(y) + Math.abs(z) <= 2 ? P.brown : false
  );
  for (const [x, y, z] of [[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]]) {
    v.push({ x, y, z, c: P.gold });
  }
  return v;
}

/** Small rock chunks that orbit the towers (concept art shows these everywhere). */
export function rubbleVoxels() {
  const v = [];
  const r = 2;
  for (let x = -r; x <= r; x++) {
    for (let y = -r; y <= r; y++) {
      for (let z = -r; z <= r; z++) {
        if (Math.sqrt(x * x + y * y + z * z) > rand(1.2, 2.1)) continue;
        v.push({ x, y, z, c: chance(0.25) ? P.stone : P.stoneDark });
      }
    }
  }
  return v;
}
