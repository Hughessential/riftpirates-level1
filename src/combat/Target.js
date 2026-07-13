import * as THREE from 'three';

/**
 * Anything the player can shoot registers as a Target. Priority drives autofire
 * selection (spec §8): lower number = shot first.
 */
export const PRIORITY = {
  THREAT: 0, // an enemy already in the player's face
  ENEMY: 10,
  WEAK_POINT: 20, // tower weak points, inhibitor conduits, boss modules
  BODY: 40, // tower/boss body — only worth shooting once modules are down
};

let nextId = 1;

export class Target {
  constructor({
    object3D,
    hp,
    radius = 2,
    priority = PRIORITY.ENEMY,
    kind = 'enemy',
    label = '',
    // Shielded bodies still register so autofire has something to chew on, but
    // scale incoming damage down hard until their generators die.
    damageScale = 1,
    scrap = 0,
    score = 0,
    xp = 0,
    onDamage = null,
    onDeath = null,
    offset = null,
  }) {
    this.id = nextId++;
    this.object3D = object3D;
    this.hp = hp;
    this.maxHp = hp;
    this.radius = radius;
    this.priority = priority;
    this.kind = kind;
    this.label = label;
    this.damageScale = damageScale;
    this.scrap = scrap;
    this.score = score;
    this.xp = xp;
    this.onDamage = onDamage;
    this.onDeath = onDeath;
    this.alive = true;
    this.targetable = true;
    this.offset = offset; // optional local offset from object3D origin
    this.pos = new THREE.Vector3();
    this.syncPos();
  }

  syncPos() {
    if (!this.object3D) return;
    this.object3D.getWorldPosition(this.pos);
    if (this.offset) this.pos.add(this.offset);
  }

  /** @returns {number} damage actually dealt (0 when fully shielded). */
  damage(amount, isCrit = false) {
    if (!this.alive) return 0;
    const dealt = amount * this.damageScale;
    if (dealt <= 0) return 0;
    this.hp -= dealt;
    if (this.onDamage) this.onDamage(dealt, isCrit, this);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.targetable = false;
      if (this.onDeath) this.onDeath(this);
    }
    return dealt;
  }

  get healthPct() {
    return this.maxHp > 0 ? this.hp / this.maxHp : 0;
  }
}
