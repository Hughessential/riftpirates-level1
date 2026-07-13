import * as THREE from 'three';
import { P } from '../core/Palette.js';

/**
 * Every structure in the game is a merged voxel mesh wrapped in an inverted-hull
 * black shell, which is what gives the concept-art "outlined block" read. One
 * draw call for the fill, one for the outline, regardless of voxel count.
 */

let unitBox = null;

export function buildVoxels(vox, scale = 1, opts = {}) {
  const outlineWidth = opts.outline ?? 1.16;
  const emissiveKeys = opts.emissive || null; // Set of hex strings that should self-illuminate

  if (!unitBox) unitBox = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const bp = unitBox.attributes.position.array;
  const bn = unitBox.attributes.normal.array;
  const nv = bp.length / 3;
  const N = vox.length;

  const pos = new Float32Array(nv * 3 * N);
  const nor = new Float32Array(nv * 3 * N);
  const col = new Float32Array(nv * 3 * N);
  const posOut = new Float32Array(nv * 3 * N);
  const c = new THREE.Color();

  for (let i = 0; i < N; i++) {
    const v = vox[i];
    c.set(v.c);
    // Emissive voxels are pushed brighter than 1.0 so bloom-free rendering still
    // reads them as light sources against the dark hull.
    let r = c.r;
    let g = c.g;
    let b = c.b;
    if (emissiveKeys && emissiveKeys.has(v.c)) {
      r = Math.min(1, r * 1.55 + 0.2);
      g = Math.min(1, g * 1.55 + 0.2);
      b = Math.min(1, b * 1.55 + 0.2);
    }
    for (let j = 0; j < nv; j++) {
      const o = (i * nv + j) * 3;
      pos[o] = bp[j * 3] * scale + v.x * scale;
      pos[o + 1] = bp[j * 3 + 1] * scale + v.y * scale;
      pos[o + 2] = bp[j * 3 + 2] * scale + v.z * scale;
      posOut[o] = bp[j * 3] * scale * outlineWidth + v.x * scale;
      posOut[o + 1] = bp[j * 3 + 1] * scale * outlineWidth + v.y * scale;
      posOut[o + 2] = bp[j * 3 + 2] * scale * outlineWidth + v.z * scale;
      nor[o] = bn[j * 3];
      nor[o + 1] = bn[j * 3 + 1];
      nor[o + 2] = bn[j * 3 + 2];
      col[o] = r;
      col[o + 1] = g;
      col[o + 2] = b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));

  const grp = new THREE.Group();

  if (outlineWidth > 1) {
    const geoOut = new THREE.BufferGeometry();
    geoOut.setAttribute('position', new THREE.BufferAttribute(posOut, 3));
    const outline = new THREE.Mesh(
      geoOut,
      new THREE.MeshBasicMaterial({ color: P.black, side: THREE.BackSide })
    );
    grp.add(outline);
  }
  grp.add(mesh);
  grp.userData.mesh = mesh;
  return grp;
}

// ---- shared sprite textures -------------------------------------------------

let texGlow = null;
let texSwirl = null;
let texDiamond = null;
let texRing = null;

export function initTextures() {
  texGlow = radialTex([
    [0, 'rgba(255,255,255,1)'],
    [0.35, 'rgba(255,255,255,0.5)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  texSwirl = radialTex([
    [0, 'rgba(255,46,210,0.9)'],
    [0.4, 'rgba(139,47,214,0.45)'],
    [0.8, 'rgba(34,211,238,0.18)'],
    [1, 'rgba(0,0,0,0)'],
  ], 128);
  texDiamond = diamondTex();
  texRing = ringTex();
}

function radialTex(stops, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) gr.addColorStop(at, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function diamondTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  g.rotate(Math.PI / 4);
  const gr = g.createLinearGradient(-18, -18, 18, 18);
  gr.addColorStop(0, '#fff0ff');
  gr.addColorStop(0.5, '#FF2ED2');
  gr.addColorStop(1, '#7C1D6F');
  g.fillStyle = gr;
  g.fillRect(-16, -16, 32, 32);
  g.strokeStyle = '#0A0716';
  g.lineWidth = 4;
  g.strokeRect(-16, -16, 32, 32);
  return new THREE.CanvasTexture(c);
}

function ringTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

export const Tex = {
  get glow() { return texGlow; },
  get swirl() { return texSwirl; },
  get diamond() { return texDiamond; },
  get ring() { return texRing; },
};

export function glowSprite(color, scale = 1, opacity = 1) {
  const m = new THREE.SpriteMaterial({
    map: texGlow,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(m);
  s.scale.set(scale, scale, 1);
  return s;
}

// ---- voxel volume helpers (used by every model generator) --------------------

/** Fill an inclusive box volume. `fn` can skip or recolor per-voxel. */
export function box(v, x0, x1, y0, y1, z0, z1, c, fn) {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (fn) {
          const r = fn(x, y, z);
          if (r === false) continue;
          v.push({ x, y, z, c: typeof r === 'string' ? r : c });
        } else {
          v.push({ x, y, z, c });
        }
      }
    }
  }
}

/** Hollow box shell — the fortress walls read better than solid blocks. */
export function shell(v, x0, x1, y0, y1, z0, z1, c, fn) {
  box(v, x0, x1, y0, y1, z0, z1, c, (x, y, z) => {
    const onEdge =
      x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
    if (!onEdge) return false;
    return fn ? fn(x, y, z) : true;
  });
}

export function cyl(v, cx, cy, cz, r, h, c, axis = 'y', fn) {
  const R2 = r * r;
  for (let a = -r; a <= r; a++) {
    for (let b = -r; b <= r; b++) {
      if (a * a + b * b > R2) continue;
      for (let l = 0; l < h; l++) {
        let x;
        let y;
        let z;
        if (axis === 'y') { x = cx + a; y = cy + l; z = cz + b; }
        else if (axis === 'z') { x = cx + a; y = cy + b; z = cz + l; }
        else { x = cx + l; y = cy + a; z = cz + b; }
        const col = fn ? fn(x, y, z) : true;
        if (col === false) continue;
        v.push({ x, y, z, c: typeof col === 'string' ? col : c });
      }
    }
  }
}

export function sphere(v, cx, cy, cz, r, c, fn) {
  for (let x = -r; x <= r; x++) {
    for (let y = -r; y <= r; y++) {
      for (let z = -r; z <= r; z++) {
        if (x * x + y * y + z * z > r * r) continue;
        const col = fn ? fn(cx + x, cy + y, cz + z) : true;
        if (col === false) continue;
        v.push({ x: cx + x, y: cy + y, z: cz + z, c: typeof col === 'string' ? col : c });
      }
    }
  }
}

/** Ring of voxels in the XY plane — energy rings, anchor rings, portal frames. */
export function ringXY(v, cx, cy, cz, r, c, segs = 40, fn) {
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const x = cx + Math.round(Math.cos(a) * r);
    const y = cy + Math.round(Math.sin(a) * r);
    const col = fn ? fn(i, a) : true;
    if (col === false) continue;
    v.push({ x, y, z: cz, c: typeof col === 'string' ? col : c });
  }
}

/** Dedupe voxels sharing a cell — later writes win, so detail paints over bulk. */
export function dedupe(v) {
  const map = new Map();
  for (const p of v) map.set(`${p.x},${p.y},${p.z}`, p);
  return [...map.values()];
}
