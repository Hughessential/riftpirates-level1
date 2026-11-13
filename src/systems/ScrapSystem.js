import * as THREE from 'three';
import { Tex } from '../render/VoxelBuilder.js';
import { Audio2 } from '../core/AudioManager.js';
import { rand } from '../core/Utils.js';
import { RunWallet } from './RunWallet.js';

export const LOOT_POOL_SIZE = 260;
// Authorization is finite, even in a stalled encounter. Every authorized source
// fits in the pending queue; pool pressure delays value without discarding it.
export const MAX_RUN_REWARDS = 2048;
export const LOOT_COLORS = Object.freeze([0xf4f8ff, 0xffca43, 0xa956ff, 0x27f5da, 0xff53cb]);
export const LOOT_DENOMINATIONS = Object.freeze([
  { value: 2, name: 'SHARD', color: 0xf4f8ff, size: .75, sides: 3 },
  { value: 10, name: 'SALVAGE', color: 0xff53cb, size: 1.05, sides: 4 },
  { value: 25, name: 'DIAMOND', color: 0x27f5da, size: 1.4, sides: 4 },
  { value: 100, name: 'CRYSTAL', color: 0xa956ff, size: 1.9, sides: 6 },
  { value: 250, name: 'CORE', color: 0xffca43, size: 2.4, sides: 8 },
]);

/** Bounded denomination shower; arbitrary final remainders remain real SCRAP. */
export function splitLootValue(value) {
  let left = Math.max(0, Math.min(1e9, Math.round(Number(value) || 0)));
  const pieces = [], ceiling = left >= 500 ? 100 : left >= 100 ? 25 : left >= 25 ? 10 : 2;
  if (left >= 500) { pieces.push(250); left -= 250; }
  while (left > 0 && pieces.length < 31) {
    const denomination = [...LOOT_DENOMINATIONS].reverse().find(d => d.value <= ceiling && d.value <= left);
    const amount = denomination?.value || left;
    pieces.push(amount); left -= amount;
  }
  if (left) pieces.push(left);
  return pieces;
}
const denomination = value => [...LOOT_DENOMINATIONS].reverse().find(d => value >= d.value) || LOOT_DENOMINATIONS[0];
const textures = new Map();
function lootTexture(d,value) {
  if (typeof document === 'undefined') return Tex.diamond;
  const exact = value === d.value, key = `${d.value}:${exact?'exact':'bundle'}`;
  if (textures.has(key)) return textures.get(key);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 4;
  const points = d.value === 100 ? [[49,8],[78,8],[103,75],[64,102],[25,75]]
    : Array.from({ length: d.sides }, (_, i) => { const a = i*Math.PI*2/d.sides-Math.PI/2; return [64+Math.cos(a)*40,51+Math.sin(a)*40]; });
  ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.closePath(); ctx.stroke();
  ctx.globalAlpha = .28; ctx.fill(); ctx.globalAlpha = 1;
  for (const [x,y] of points) { ctx.beginPath(); ctx.moveTo(64,51); ctx.lineTo(x,y); ctx.stroke(); }
  // Nonstandard remainders/merged bundles use PACK, never a false denomination.
  // Ten shared textures maximum; arbitrary values cannot grow this cache.
  ctx.font = 'bold 21px monospace'; ctx.textAlign = 'center'; ctx.fillText(exact?String(d.value):'PACK',64,124);
  const texture = new THREE.CanvasTexture(canvas); textures.set(key,texture); return texture;
}

export class ScrapSystem {
  constructor(scene, game) {
    this.game = game; this.wallet = new RunWallet(); this.pool = [];
    this.halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({
      map: Tex.glow, transparent: true, opacity: .17, blending: THREE.AdditiveBlending, depthWrite: false }),LOOT_POOL_SIZE);
    this.halos.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.halos.frustumCulled = false;
    this._transform = new THREE.Object3D(); scene.add(this.halos);
    for (let i = 0; i < LOOT_POOL_SIZE; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: Tex.diamond, transparent: true, depthWrite: false }));
      sp.visible = false; scene.add(sp);
      this.pool.push({ sp, active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, value: 0, life: 0 });
    }
    this.reset();
  }
  reset() {
    this.wallet.reset(); this.burstSerial = 0; this.pending = []; this.sources = new Map(); this.budgets = new Map();
    this.metrics = { authorized: 0, collectedBase: 0, expiredBase: 0, rejectedSources: 0, peakPending: 0 };
    this.halos.count = 0;
    for (const o of this.pool) { o.active = false; o.sp.visible = false; o.reward = null; }
  }
  /** Replayed source IDs and exhausted source budgets reject BEFORE authorization. */
  burst(x,y,z,value,spread=1,meta={}) {
    const amount = Math.max(0,Math.min(1e9,Math.round(Number(value)||0)));
    if (!amount) return false;
    const sourceId = meta.sourceId || `drop:${++this.burstSerial}`, group = meta.budgetGroup;
    if (this.sources.has(sourceId) || this.sources.size >= MAX_RUN_REWARDS ||
        (group && (this.budgets.get(group)||0) >= (meta.budgetLimit??64))) {
      this.metrics.rejectedSources++; return false;
    }
    if (group) this.budgets.set(group,(this.budgets.get(group)||0)+1);
    const reward = { sourceId, kind: meta.kind||'salvage', pieces: meta.bundle?[amount]:splitLootValue(amount),
      x,y,z,spread,baseValue:amount,collectedBase:0,awarded:0,multiplier:null,firstCollection:true,
      life:meta.life??18,speed:meta.speed??1,next:0 };
    this.sources.set(sourceId,reward); this.pending.push(reward); this.metrics.authorized += amount;
    this.metrics.peakPending = Math.max(this.metrics.peakPending,this.pending.length);
    this._flushPending(); return true;
  }
  _flushPending() {
    for (const o of this.pool) {
      if (o.active || !this.pending.length) continue;
      const reward = this.pending[0], value = reward.pieces[reward.next++], d = denomination(value);
      Object.assign(o,{ active:true,reward,value,x:reward.x+rand(-reward.spread,reward.spread),
        y:reward.y+rand(-reward.spread,reward.spread),z:reward.z+rand(-reward.spread,reward.spread),
        vx:rand(-2.5,2.5)*reward.spread,vy:rand(-2,3)*reward.spread,vz:rand(3,7),life:reward.life,tint:d.color,size:d.size });
      o.sp.material.map = lootTexture(d,value); o.sp.material.color.setHex(d.color).multiplyScalar(1.7);
      o.sp.material.opacity = 1; o.sp.visible = true; o.sp.scale.setScalar(o.size); o.sp.position.set(o.x,o.y,o.z);
      if (reward.next >= reward.pieces.length) this.pending.shift();
    }
  }
  _collect(o) {
    if (!o.active || !o.reward) return;
    const g = this.game, p = g.player, reward = o.reward, firstCollection = reward.firstCollection;
    // Claim the collectible before invoking combat/HUD callbacks. A failed
    // effect must never leave an already-credited sprite available next frame.
    o.active = false; o.sp.visible = false; o.reward = null;
    reward.firstCollection = false;
    reward.multiplier ??= Math.max(0,Number(p.stats.scrapMultiplier)||0);
    reward.collectedBase += o.value;
    // Cumulative rounding per logical source, never per visible fragment. The
    // first collection snapshots its multiplier; later purchases aren't retroactive.
    const total = Math.min(Number.MAX_SAFE_INTEGER,Math.round(reward.collectedBase*reward.multiplier));
    const gained = total-reward.awarded; reward.awarded = total;
    if (this.wallet.credit(gained)) {
      this.metrics.collectedBase += o.value;
      g.augmentEffects?.onScrap(gained,{ sourceId:reward.sourceId,firstCollection,baseValue:o.value,kind:reward.kind });
      if (p.stats.scrapYield > 0) g.score.add(gained*12*p.stats.scrapYield,'PLUNDER');
      if (firstCollection) g.heat.onScrapCollected();
      const crossed = [100,250,650,1600].filter(price => this.wallet.balance >= price && this.wallet.balance-gained < price).at(-1);
      if (crossed && !g.director?.inUpgrade) g.hud?.toast('TREASURE SECURED',`${this.wallet.balance} SCRAP AVAILABLE`,'#27f5da');
    }
  }
  update(dt,worldSpeed) {
    const g = this.game, p = g.player, radius = Math.max(5,p.stats.scrapRadius);
    let picked = 0, haloCount = 0; this._flushPending();
    for (const o of this.pool) {
      if (!o.active) continue;
      o.life -= dt; const drag = Math.max(0,1-dt*2);
      o.vx *= drag; o.vy *= drag; o.vz *= drag; o.x += o.vx*dt; o.y += o.vy*dt;
      o.z += (o.vz+worldSpeed*.8*o.reward.speed)*dt;
      const distance = Math.hypot(o.x-p.x,o.y-p.y,o.z);
      if (distance < radius && p.alive) {
        const pull = Math.min(1,38*dt/Math.max(distance,.6));
        o.x += (p.x-o.x)*pull; o.y += (p.y-o.y)*pull; o.z *= 1-pull;
      }
      if (Math.hypot(o.x-p.x,o.y-p.y,o.z) < 2.25 && p.alive) { this._collect(o); picked++; continue; }
      if (o.life <= 0 || o.z > 22) {
        this.metrics.expiredBase += o.value; o.active = false; o.sp.visible = false; o.reward = null; continue;
      }
      o.sp.position.set(o.x,o.y,o.z); o.sp.material.rotation = Math.sin(o.life*1.3)*.15;
      o.sp.scale.setScalar(o.size*(1+.09*Math.sin(o.life*8+o.value))); o.sp.material.opacity = Math.min(1,o.life);
      const transform = this._transform; transform.position.set(o.x,o.y,o.z);
      if (g.camera) transform.quaternion.copy(g.camera.quaternion);
      transform.scale.setScalar(o.size*(2.4+.15*Math.sin(o.life*5))); transform.updateMatrix();
      this.halos.setMatrixAt(haloCount,transform.matrix); this.halos.setColorAt(haloCount++,o.sp.material.color);
    }
    this.halos.count = haloCount; this.halos.instanceMatrix.needsUpdate = true;
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;
    if (picked) Audio2.play(picked>4?'scrap_burst':'scrap',.3,1,.12);
  }
  get collected() { return this.wallet.earned; }
  get total() { return this.wallet.earned; }
  get outstandingValue() {
    return this.pool.reduce((sum,o)=>sum+(o.active?o.value:0),0)+
      this.pending.reduce((sum,r)=>sum+r.pieces.slice(r.next).reduce((a,b)=>a+b,0),0);
  }
}
