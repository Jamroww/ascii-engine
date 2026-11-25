import type { Engine } from './Engine';
import type { PlacedEntity } from '../data/levelTypes';
import { AssetRegistry } from '../data/AssetRegistry';
import type { EnemyArchetype } from '../data/AssetRegistry';
import { PLAYER_RADIUS } from './world';

export type EnemyState = 'idle' | 'chase' | 'telegraph' | 'attack' | 'recover';

export interface Enemy {
  id: string;
  assetId: string;
  x: number;
  y: number;
  /** Current movement velocity (chase / lunge impulse). */
  vx: number;
  vy: number;
  /** Separate knockback velocity that decays far faster than movement. */
  kbx: number;
  kby: number;
  hp: number;
  maxHp: number;
  state: EnemyState;
  stateTimer: number;
  hitFlashTimer: number;
  /** Remaining seconds of a Radiant Burst stun; pauses AI while > 0. */
  stunTimer: number;
  /** The last weapon swing that already connected, so a swing hits once. */
  lastHitSwingId: number;
}

export interface EnemyProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  radius: number;
}

const SWORD_DAMAGE = 20;
const PLAYER_KNOCKBACK = 3.2;
const ENEMY_KNOCKBACK = 5.0;
const HIT_FLASH_DURATION = 0.12;
const LUNGE_SPEED = 16;
const LUNGE_DURATION = 0.22;
const PROJECTILE_SPEED = 6.5;
const PROJECTILE_LIFE = 3.5;
const PROJECTILE_RADIUS = 0.35;

/**
 * Owns every live enemy and enemy projectile. Enemy AI reads the player position
 * from the engine, resolves movement against the world colliders, and reports
 * sword hits / player damage back through the engine's combat feedback hooks.
 */
export class EnemyManager {
  private readonly engine: Engine;
  private enemies: Enemy[] = [];
  private projectiles: EnemyProjectile[] = [];
  private spawns: Array<{ assetId: string; x: number; y: number }> = [];
  private idCounter = 0;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  getEnemies(): readonly Enemy[] {
    return this.enemies;
  }

  getProjectiles(): readonly EnemyProjectile[] {
    return this.projectiles;
  }

  /** (Re)build the live enemy list from placed `enemy` entities (level load / editor). */
  spawnFromEntities(entities: PlacedEntity[]): void {
    this.clear();
    this.spawns = [];
    for (const e of entities) {
      if (e.kind !== 'enemy') continue;
      this.spawns.push({ assetId: e.assetId, x: e.x, y: e.y });
      this.spawn(e.assetId, e.x, e.y);
    }
  }

  clear(): void {
    this.enemies = [];
    this.projectiles = [];
  }

  /** Respawn every enemy at its original position with full health (player respawn). */
  reset(): void {
    this.clear();
    for (const s of this.spawns) this.spawn(s.assetId, s.x, s.y);
  }

  update(dt: number): void {
    const px = this.engine.playerPos.x;
    const py = this.engine.playerPos.y;

    this.updateEnemies(dt, px, py);
    this.resolveSwordHits(px, py);
    this.updateProjectiles(dt, px, py);

    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  // --- Spawning --------------------------------------------------------------

  private spawn(assetId: string, x: number, y: number): Enemy {
    const archetype = AssetRegistry.getEnemyArchetype(assetId);
    this.idCounter += 1;
    this.enemies.push({
      id: `enemy_${this.idCounter}`,
      assetId,
      x,
      y,
      vx: 0,
      vy: 0,
      kbx: 0,
      kby: 0,
      hp: archetype.maxHp,
      maxHp: archetype.maxHp,
      state: 'idle',
      stateTimer: 0,
      hitFlashTimer: 0,
      stunTimer: 0,
      lastHitSwingId: -1,
    });
    return this.enemies[this.enemies.length - 1];
  }

  private spawnProjectile(x: number, y: number, targetX: number, targetY: number, damage: number): void {
    const dx = targetX - x;
    const dy = targetY - y;
    const d = Math.hypot(dx, dy) || 1;
    this.projectiles.push({
      x,
      y,
      vx: (dx / d) * PROJECTILE_SPEED,
      vy: (dy / d) * PROJECTILE_SPEED,
      life: PROJECTILE_LIFE,
      damage,
      radius: PROJECTILE_RADIUS,
    });
  }

  // --- AI --------------------------------------------------------------------

  private updateEnemies(dt: number, px: number, py: number): void {
    for (const enemy of this.enemies) {
      const archetype = AssetRegistry.getEnemyArchetype(enemy.assetId);
      if (enemy.hitFlashTimer > 0) enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - dt);

      const dx = px - enemy.x;
      const dy = py - enemy.y;
      const dist = Math.hypot(dx, dy) || 1e-5;
      const nx = dx / dist;
      const ny = dy / dist;

      if (enemy.stunTimer > 0) {
        // Stunned: freeze AI and momentum, then count down.
        enemy.stunTimer = Math.max(0, enemy.stunTimer - dt);
        enemy.vx = 0;
        enemy.vy = 0;
      } else if (archetype.kind === 'melee') {
        this.updateMeleeEnemy(enemy, archetype, dt, dist, nx, ny);
      } else {
        this.updateRangedEnemy(enemy, archetype, dt, dist, nx, ny, px, py);
      }

      // Move and settle against trees / buildings / boulders.
      enemy.x += (enemy.vx + enemy.kbx) * dt;
      enemy.y += (enemy.vy + enemy.kby) * dt;
      const pos = { x: enemy.x, y: enemy.y };
      this.engine.collision.resolve(pos, archetype.radius);
      enemy.x = pos.x;
      enemy.y = pos.y;

      // Friction so lunge / chase velocities ease out instead of sliding forever.
      const friction = Math.exp(-5 * dt);
      enemy.vx *= friction;
      enemy.vy *= friction;

      // Knockback decays much faster: a tight micro-shove, not a throw.
      const kbDecay = Math.exp(-14 * dt);
      enemy.kbx *= kbDecay;
      enemy.kby *= kbDecay;

      // Melee contact: only the stalker's lunge bites (never while stunned).
      if (archetype.kind === 'melee' && enemy.state === 'attack' && enemy.stunTimer <= 0) {
        const d = Math.hypot(px - enemy.x, py - enemy.y);
        if (d < archetype.radius + PLAYER_RADIUS) this.hitPlayer(enemy, archetype);
      }
    }
  }

  private updateMeleeEnemy(
    enemy: Enemy,
    archetype: EnemyArchetype,
    dt: number,
    dist: number,
    nx: number,
    ny: number
  ): void {
    switch (enemy.state) {
      case 'idle':
        enemy.vx = 0;
        enemy.vy = 0;
        if (dist <= archetype.aggroRange) enemy.state = 'chase';
        break;

      case 'chase':
        if (dist > archetype.aggroRange * 1.4) {
          enemy.state = 'idle';
          enemy.vx = 0;
          enemy.vy = 0;
        } else if (dist <= archetype.attackRange) {
          enemy.state = 'telegraph';
          enemy.stateTimer = archetype.telegraphTime;
          enemy.vx = 0;
          enemy.vy = 0;
        } else {
          enemy.vx = nx * archetype.speed;
          enemy.vy = ny * archetype.speed;
        }
        break;

      case 'telegraph':
        enemy.vx = 0;
        enemy.vy = 0;
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          enemy.state = 'attack';
          enemy.stateTimer = LUNGE_DURATION;
          enemy.vx = nx * LUNGE_SPEED;
          enemy.vy = ny * LUNGE_SPEED;
        }
        break;

      case 'attack':
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          enemy.state = 'recover';
          enemy.stateTimer = archetype.attackCooldown;
          enemy.vx = 0;
          enemy.vy = 0;
        }
        break;

      case 'recover':
        enemy.vx = 0;
        enemy.vy = 0;
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          enemy.state = dist <= archetype.aggroRange ? 'chase' : 'idle';
        }
        break;
    }
  }

  private updateRangedEnemy(
    enemy: Enemy,
    archetype: EnemyArchetype,
    dt: number,
    dist: number,
    nx: number,
    ny: number,
    px: number,
    py: number
  ): void {
    const minRange = archetype.attackRange * 0.35;

    switch (enemy.state) {
      case 'idle':
        enemy.vx = 0;
        enemy.vy = 0;
        if (dist <= archetype.aggroRange) {
          enemy.state = 'telegraph';
          enemy.stateTimer = archetype.telegraphTime;
        }
        break;

      case 'telegraph':
        enemy.stateTimer -= dt;
        // Cancel if the player slips well out of reach.
        if (dist > archetype.aggroRange * 1.6) {
          enemy.state = 'idle';
          enemy.stateTimer = 0;
          enemy.vx = 0;
          enemy.vy = 0;
          break;
        }
        // Keep a little distance while winding up.
        if (dist < minRange) {
          enemy.vx = -nx * archetype.speed;
          enemy.vy = -ny * archetype.speed;
        } else {
          enemy.vx = 0;
          enemy.vy = 0;
        }
        if (enemy.stateTimer <= 0) {
          this.spawnProjectile(enemy.x, enemy.y, px, py, archetype.damage);
          enemy.state = 'recover';
          enemy.stateTimer = archetype.attackCooldown;
        }
        break;

      case 'recover':
        enemy.vx = 0;
        enemy.vy = 0;
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          enemy.state = dist <= archetype.aggroRange ? 'telegraph' : 'idle';
          if (enemy.state === 'telegraph') enemy.stateTimer = archetype.telegraphTime;
        }
        break;

      default:
        enemy.vx = 0;
        enemy.vy = 0;
        break;
    }
  }

  // --- Combat ----------------------------------------------------------------

  /**
   * Radiant Burst: deal light damage and stun every enemy within `radius` of
   * the player. Dead enemies are filtered out by the next `update()` pass.
   */
  public radiantBurst(x: number, y: number, radius: number, damage: number, stunDuration: number): void {
    for (const enemy of this.enemies) {
      const d = Math.hypot(enemy.x - x, enemy.y - y);
      if (d > radius) continue;
      enemy.hp -= damage;
      enemy.stunTimer = Math.max(enemy.stunTimer, stunDuration);
    }
  }

  /** Player sword sweeps damage each enemy at most once per swing. */
  private resolveSwordHits(px: number, py: number): void {
    const weapon = this.engine.weapon;
    if (!weapon.isSwinging) return;

    for (const enemy of this.enemies) {
      if (enemy.lastHitSwingId === weapon.swingId) continue;

      const archetype = AssetRegistry.getEnemyArchetype(enemy.assetId);
      const dx = enemy.x - px;
      const dy = enemy.y - py;
      const dist = Math.hypot(dx, dy);
      if (dist > weapon.reach + archetype.radius) continue;

      const angle = Math.atan2(dx, dy);
      let diff = angle - weapon.aimAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > weapon.arcHalfAngle) continue;

      enemy.lastHitSwingId = weapon.swingId;
      enemy.hp -= SWORD_DAMAGE;
      enemy.hitFlashTimer = HIT_FLASH_DURATION;

      const kd = dist || 1;
      enemy.kbx += (dx / kd) * ENEMY_KNOCKBACK;
      enemy.kby += (dy / kd) * ENEMY_KNOCKBACK;

      this.engine.triggerHitstop();
      this.engine.triggerShake(0.12);
    }
  }

  private updateProjectiles(dt: number, px: number, py: number): void {
    const remaining: EnemyProjectile[] = [];
    for (const p of this.projectiles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      let consumed = p.life <= 0;
      if (!consumed) {
        const d = Math.hypot(px - p.x, py - p.y);
        if (d < PLAYER_RADIUS + p.radius) {
          consumed = true;
          if (this.engine.stats.takeDamage(p.damage)) {
            const kd = d || 1;
            this.engine.applyPlayerKnockback(((px - p.x) / kd) * PLAYER_KNOCKBACK, ((py - p.y) / kd) * PLAYER_KNOCKBACK);
            this.engine.triggerShake(0.22);
          }
        }
      }

      if (!consumed) remaining.push(p);
    }
    this.projectiles = remaining;
  }

  private hitPlayer(enemy: Enemy, archetype: EnemyArchetype): void {
    if (!this.engine.stats.takeDamage(archetype.damage)) return;

    const dx = this.engine.playerPos.x - enemy.x;
    const dy = this.engine.playerPos.y - enemy.y;
    const d = Math.hypot(dx, dy) || 1;
    this.engine.applyPlayerKnockback((dx / d) * PLAYER_KNOCKBACK, (dy / d) * PLAYER_KNOCKBACK);
    this.engine.triggerShake(0.25);
  }
}
