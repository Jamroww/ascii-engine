import type { Engine } from './Engine';
import type { PlacedEntity } from '../data/levelTypes';
import { AssetRegistry } from '../data/AssetRegistry';
import type { EnemyArchetype } from '../data/AssetRegistry';
import { PLAYER_RADIUS } from './world';

export type EnemyState =
  | 'idle'
  | 'chase'
  | 'telegraph'
  | 'attack'
  | 'recover'
  | 'pre_fight'
  | 'phase_transition';

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
  /** Remaining seconds of a parry stagger (silver tint, pauses AI while > 0). */
  staggerTimer: number;
  /** The last weapon swing that already connected, so a swing hits once. */
  lastHitSwingId: number;
  /** Boss only: alternates between forward lunge (0) and wide sweep (1). */
  attackVariant: number;
  /** Effective melee contact radius for the current attack. */
  attackHitRadius: number;
  /** Distance at which a melee enemy coils for its joust lunge. */
  strikeRange: number;
  /** Optional quest grouping, e.g. 'alley', 'patrol', 'boss'. */
  group?: string;
  /** Ronin boss phase: 0 = pre-fight, 1 = phase one, 2 = phase two (Unsheathed). */
  roninPhase?: number;
  /** Ronin current move key (draw / crescent / twin / combo / wave / whirlwind). */
  roninMove?: string;
  /** Ronin combo hit index within a multi-hit attack. */
  roninComboStep?: number;
  /** Remaining invulnerability seconds (phase transition stance-shift). */
  roninInvuln?: number;
  /** Blade glow brightness (0..1), boosted in phase two. */
  roninGlow?: number;
}

/** A transient expanding shockwave ring (Gale pushback / phase transition). */
export interface Shockwave {
  x: number;
  y: number;
  age: number;
  life: number;
  r: number;
  g: number;
  b: number;
}

export interface EnemyProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  radius: number;
  /** True for the Ronin's golden crescent wave (rendered as a slash). */
  golden?: boolean;
}

export interface FriendlyProjectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  radius: number;
}

/** A transient bright parry clash ring, faded by EnemyLayer over its lifetime. */
export interface ClashSpark {
  x: number;
  y: number;
  age: number;
}

const PLAYER_KNOCKBACK = 3.2;
const ENEMY_KNOCKBACK = 5.0;
const HIT_FLASH_DURATION = 0.12;
const LUNGE_SPEED = 16;
const LUNGE_DURATION = 0.18;

// Melee "joust" cadence: approach to strike range, coil (telegraph) with a
// bright glint in the final window, forward lunge, then a rhythm recovery.
const TELEGRAPH_COIL_DURATION = 0.48;
const RECOVERY_DURATION = 0.65;
/** Backward settle impulse that pulls the enemy ~0.25 units during the coil. */
const COIL_PULLBACK_IMPULSE = 3.5;
/** Final seconds of the coil where the enemy flashes its white/gold glint. */
export const MELEE_TELEGRAPH_GLINT_WINDOW = 0.28;
/** Parry knockback impulse (~1.4 units with the fast kb decay). */
const PARRY_KNOCKBACK = 20;
const CLASH_SPARK_DURATION = 0.22;
const PROJECTILE_SPEED = 6.5;
const PROJECTILE_LIFE = 3.5;
const PROJECTILE_RADIUS = 0.35;

const PARRY_STAGGER_DURATION = 1.6;
const BOSS_STAGGER_DURATION = 2.0;
const RONIN_STAGGER_DURATION = 1.8;
const DEFLECT_RANGE = 2.4;
const DEFLECT_DAMAGE = 30;
const FRIENDLY_PROJECTILE_SPEED = 14;
const FRIENDLY_PROJECTILE_LIFE = 2.5;
const FRIENDLY_PROJECTILE_RADIUS = 0.3;

// --- The Ronin boss tuning ----------------------------------------------------
const RONIN_LUNGE_SPEED = 22;
const RONIN_TRANSITION_DURATION = 0.9;
const RONIN_RECOVERY = 0.55;
const RONIN_PHASE2_SPEED_MULT = 1.35;
const RONIN_WAVE_SPEED = 12;
const RONIN_WAVE_LIFE = 3.2;
const RONIN_WAVE_RADIUS = 0.55;
const RONIN_WAVE_DAMAGE = 22;
const SHOCKWAVE_LIFE = 0.55;

/**
 * Owns every live enemy and enemy projectile. Enemy AI reads the player position
 * from the engine, resolves movement against the world colliders, and reports
 * sword hits / player damage back through the engine's combat feedback hooks.
 * Right-click parries negate incoming melee/projectile hits, stagger attackers
 * and deflect spore orbs back as friendly projectiles.
 */
export class EnemyManager {
  private readonly engine: Engine;
  private enemies: Enemy[] = [];
  private projectiles: EnemyProjectile[] = [];
  private friendly: FriendlyProjectile[] = [];
  private clashes: ClashSpark[] = [];
  private shockwaves: Shockwave[] = [];
  private spawns: Array<{ assetId: string; x: number; y: number; group?: string }> = [];
  private idCounter = 0;

  /** Live sword damage, wired from the player's equipped weapon each frame. */
  public swordDamage = 20;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  getEnemies(): readonly Enemy[] {
    return this.enemies;
  }

  getProjectiles(): readonly EnemyProjectile[] {
    return this.projectiles;
  }

  getFriendlyProjectiles(): readonly FriendlyProjectile[] {
    return this.friendly;
  }

  /** Parry clash sparks, rendered by EnemyLayer as expanding bright rings. */
  getClashes(): readonly ClashSpark[] {
    return this.clashes;
  }

  /** Golden expanding shockwave rings (Gale pushback + phase transition). */
  getShockwaves(): readonly Shockwave[] {
    return this.shockwaves;
  }

  /** The living Castle Warden boss, or undefined when dead / absent. */
  getBoss(): Enemy | undefined {
    return this.enemies.find((e) => e.group === 'boss');
  }

  /** True while any enemy in the given quest group is still alive. */
  hasAliveGroup(group: string): boolean {
    return this.enemies.some((e) => e.group === group);
  }

  /** (Re)build the live enemy list from placed `enemy` entities (level load / editor). */
  spawnFromEntities(entities: PlacedEntity[]): void {
    this.clear();
    this.spawns = [];
    for (const e of entities) {
      if (e.kind !== 'enemy') continue;
      this.spawns.push({ assetId: e.assetId, x: e.x, y: e.y, group: e.group });
      this.spawn(e.assetId, e.x, e.y, e.group);
    }
  }

  clear(): void {
    this.enemies = [];
    this.projectiles = [];
    this.friendly = [];
    this.clashes = [];
    this.shockwaves = [];
  }

  /** Spawn a golden-white (or tinted) expanding shockwave ring. */
  public spawnShockwave(x: number, y: number, r = 1, g = 0.92, b = 0.6): void {
    this.shockwaves.push({ x, y, age: 0, life: SHOCKWAVE_LIFE, r, g, b });
  }

  /** Respawn every enemy at its original position with full health (player respawn). */
  reset(): void {
    this.clear();
    for (const s of this.spawns) this.spawn(s.assetId, s.x, s.y, s.group);
  }

  update(dt: number): void {
    const px = this.engine.playerPos.x;
    const py = this.engine.playerPos.y;

    this.updateEnemies(dt, px, py);
    this.resolveSwordHits(px, py);
    this.updateProjectiles(dt, px, py);
    this.updateFriendlyProjectiles(dt);
    this.updateClashes(dt);
    this.updateShockwaves(dt);

    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  // --- Spawning --------------------------------------------------------------

  private spawn(assetId: string, x: number, y: number, group?: string): Enemy {
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
      staggerTimer: 0,
      lastHitSwingId: -1,
      attackVariant: 0,
      attackHitRadius: archetype.radius,
      strikeRange: this.meleeStrikeRange(assetId),
      group,
      roninPhase: assetId === 'the_ronin' ? 0 : undefined,
      roninMove: undefined,
      roninComboStep: 0,
      roninInvuln: 0,
      roninGlow: 0,
    });
    return this.enemies[this.enemies.length - 1];
  }

  /** Readiness distance for the melee "joust" coil, per archetype. */
  private meleeStrikeRange(assetId: string): number {
    switch (assetId) {
      case 'blight_stalker':
        return 2.6;
      case 'castle_warden':
        return 3.4;
      case 'the_ronin':
        return 3.4;
      case 'blight_sentinel':
        return 3.0;
      default:
        return 2.8;
    }
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

      if (enemy.staggerTimer > 0) {
        // Staggered: freeze AI and momentum (backward knockback still decays).
        enemy.staggerTimer = Math.max(0, enemy.staggerTimer - dt);
        enemy.vx = 0;
        enemy.vy = 0;
      } else if (enemy.stunTimer > 0) {
        // Stunned: freeze AI and momentum, then count down.
        enemy.stunTimer = Math.max(0, enemy.stunTimer - dt);
        enemy.vx = 0;
        enemy.vy = 0;
      } else if (enemy.assetId === 'the_ronin') {
        this.updateRoninEnemy(enemy, archetype, dt, dist, nx, ny, px, py);
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

      // Melee contact: only an active lunge bites (never while stunned/staggered).
      if (
        archetype.kind === 'melee' &&
        enemy.state === 'attack' &&
        enemy.stunTimer <= 0 &&
        enemy.staggerTimer <= 0
      ) {
        const d = Math.hypot(px - enemy.x, py - enemy.y);
        if (d < enemy.attackHitRadius + PLAYER_RADIUS) {
          if (this.engine.isParryActive()) {
            this.engine.onParrySuccess();
            const rdx = px - enemy.x;
            const rdy = py - enemy.y;
            const rd = Math.hypot(rdx, rdy) || 1;
            this.engine.onMeleeParry(rdx / rd, rdy / rd);
            this.spawnClashSpark(px, py, enemy.x, enemy.y);
            this.staggerEnemy(
              enemy,
              enemy.assetId === 'castle_warden'
                ? BOSS_STAGGER_DURATION
                : enemy.assetId === 'the_ronin'
                  ? RONIN_STAGGER_DURATION
                  : PARRY_STAGGER_DURATION,
              px,
              py,
            );
          } else {
            this.hitPlayer(enemy, archetype);
          }
        }
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
        } else if (dist <= enemy.strikeRange) {
          // Joust coil: pause, settle backward slightly, then lunge.
          enemy.state = 'telegraph';
          enemy.stateTimer = TELEGRAPH_COIL_DURATION;
          enemy.vx = 0;
          enemy.vy = 0;
          enemy.kbx = -nx * COIL_PULLBACK_IMPULSE;
          enemy.kby = -ny * COIL_PULLBACK_IMPULSE;
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
          this.beginMeleeAttack(enemy, archetype, nx, ny);
        }
        break;

      case 'attack':
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          enemy.state = 'recover';
          enemy.stateTimer = RECOVERY_DURATION;
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

  /** Start a melee attack; the Castle Warden alternates lunge vs wide sweep. */
  private beginMeleeAttack(
    enemy: Enemy,
    archetype: EnemyArchetype,
    nx: number,
    ny: number,
  ): void {
    const isBoss = archetype.id === 'castle_warden';
    let variant = 0;
    if (isBoss) {
      enemy.attackVariant = (enemy.attackVariant + 1) % 2;
      variant = enemy.attackVariant;
    }

    if (variant === 1) {
      // Wide sweep: broader contact radius, slightly slower.
      enemy.attackHitRadius = archetype.radius * 1.9;
      enemy.vx = nx * LUNGE_SPEED * 0.85;
      enemy.vy = ny * LUNGE_SPEED * 0.85;
    } else {
      // Forward lunge: extended reach, faster.
      enemy.attackHitRadius = archetype.radius + 0.35;
      enemy.vx = nx * LUNGE_SPEED * 1.15;
      enemy.vy = ny * LUNGE_SPEED * 1.15;
    }

    enemy.state = 'attack';
    enemy.stateTimer = LUNGE_DURATION;
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

  // --- The Ronin -----------------------------------------------------------

  /** Kick the Ronin out of pre-fight idle and into phase one (after dialogue). */
  public beginRoninFight(): void {
    const ronin = this.enemies.find((e) => e.assetId === 'the_ronin');
    if (!ronin) return;
    ronin.roninPhase = 1;
    ronin.state = 'idle';
    ronin.roninMove = undefined;
    ronin.roninInvuln = 0;
    ronin.roninGlow = 0.35;
    ronin.stateTimer = 0;
    ronin.vx = 0;
    ronin.vy = 0;
  }

  private updateRoninEnemy(
    enemy: Enemy,
    archetype: EnemyArchetype,
    dt: number,
    dist: number,
    nx: number,
    ny: number,
    px: number,
    py: number,
  ): void {
    // Phase two transition the moment the Ronin drops below half health.
    if (enemy.roninPhase === 1 && enemy.hp <= enemy.maxHp * 0.5) {
      this.startRoninPhaseTransition(enemy);
    }

    if (enemy.roninInvuln !== undefined && enemy.roninInvuln > 0) {
      enemy.roninInvuln = Math.max(0, enemy.roninInvuln - dt);
    }

    // Pre-fight: stands calmly and never attacks.
    if (enemy.roninPhase === 0) {
      enemy.vx = 0;
      enemy.vy = 0;
      enemy.roninGlow = 0;
      return;
    }

    const speed = enemy.roninPhase === 2 ? archetype.speed * RONIN_PHASE2_SPEED_MULT : archetype.speed;
    enemy.roninGlow = enemy.roninPhase === 2 ? 1.0 : 0.35;

    switch (enemy.state) {
      case 'idle':
        enemy.vx = 0;
        enemy.vy = 0;
        if (dist <= archetype.aggroRange) enemy.state = 'chase';
        break;

      case 'chase':
        if (dist > archetype.aggroRange * 1.6) {
          enemy.state = 'idle';
          enemy.vx = 0;
          enemy.vy = 0;
        } else if (dist <= enemy.strikeRange) {
          this.beginRoninAttack(enemy, nx, ny);
        } else {
          enemy.vx = nx * speed;
          enemy.vy = ny * speed;
        }
        break;

      case 'telegraph':
        enemy.vx = 0;
        enemy.vy = 0;
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          if (enemy.roninMove === 'wave') {
            this.fireRoninWave(enemy, px, py);
            enemy.state = 'recover';
            enemy.stateTimer = RONIN_RECOVERY;
          } else {
            this.beginRoninAttackHit(enemy, nx, ny);
          }
        }
        break;

      case 'attack':
        enemy.stateTimer -= dt;
        this.updateRoninAttack(enemy, nx, ny);
        break;

      case 'recover':
        enemy.vx = 0;
        enemy.vy = 0;
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          enemy.state = dist <= archetype.aggroRange ? 'chase' : 'idle';
        }
        break;

      case 'phase_transition':
        enemy.vx = 0;
        enemy.vy = 0;
        enemy.stateTimer -= dt;
        if (enemy.stateTimer <= 0) {
          this.completeRoninPhaseTransition(enemy);
        }
        break;

      default:
        enemy.vx = 0;
        enemy.vy = 0;
        break;
    }
  }

  private startRoninPhaseTransition(enemy: Enemy): void {
    enemy.roninPhase = 2;
    enemy.state = 'phase_transition';
    enemy.stateTimer = RONIN_TRANSITION_DURATION;
    enemy.roninInvuln = RONIN_TRANSITION_DURATION + 0.1;
    enemy.vx = 0;
    enemy.vy = 0;

    // Golden-crimson shockwave burst + gentle nudge if the player is crowding.
    this.spawnShockwave(enemy.x, enemy.y, 1.0, 0.45, 0.18);
    const px = this.engine.playerPos.x;
    const py = this.engine.playerPos.y;
    const dx = px - enemy.x;
    const dy = py - enemy.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.01 && d < 3.0) {
      this.engine.applyPlayerKnockback((dx / d) * 3.5, (dy / d) * 3.5);
    }
    this.engine.triggerShake(0.28);
  }

  private completeRoninPhaseTransition(enemy: Enemy): void {
    enemy.state = 'recover';
    enemy.stateTimer = RONIN_RECOVERY;
  }

  /** Choose the next move and begin its telegraph (or backstep for the wave). */
  private beginRoninAttack(enemy: Enemy, nx: number, ny: number): void {
    const moves =
      enemy.roninPhase === 2 ? ['combo', 'wave', 'whirlwind'] : ['draw', 'crescent', 'twin'];
    enemy.attackVariant = ((enemy.attackVariant ?? 0) + 1) % moves.length;
    const move = moves[enemy.attackVariant];

    if (move === 'wave') {
      // Quick backstep, then a golden glint telegraph, then the slash wave.
      enemy.roninMove = 'wave_backstep';
      enemy.state = 'attack';
      enemy.stateTimer = 0.3;
      enemy.attackHitRadius = 0; // backstep deals no melee contact damage
      enemy.vx = -nx * 22;
      enemy.vy = -ny * 22;
      return;
    }

    enemy.roninMove = move;
    enemy.state = 'telegraph';
    enemy.vx = 0;
    enemy.vy = 0;
    switch (move) {
      case 'draw':
        enemy.stateTimer = 0.5;
        break;
      case 'crescent':
        enemy.stateTimer = 0.45;
        break;
      case 'twin':
        enemy.stateTimer = 0.42;
        break;
      case 'combo':
        enemy.stateTimer = 0.4;
        break;
      case 'whirlwind':
        enemy.stateTimer = 0.46;
        break;
      default:
        enemy.stateTimer = 0.45;
        break;
    }
  }

  /** Start the damaging window for the telegraphed move. */
  private beginRoninAttackHit(enemy: Enemy, nx: number, ny: number): void {
    enemy.state = 'attack';
    enemy.roninComboStep = 0;
    switch (enemy.roninMove) {
      case 'draw':
        enemy.attackHitRadius = 3.5;
        enemy.stateTimer = 0.22;
        enemy.vx = nx * RONIN_LUNGE_SPEED;
        enemy.vy = ny * RONIN_LUNGE_SPEED;
        break;
      case 'crescent':
        enemy.attackHitRadius = 3.8;
        enemy.stateTimer = 0.3;
        enemy.vx = nx * 6;
        enemy.vy = ny * 6;
        break;
      case 'twin':
        enemy.attackHitRadius = 3.3;
        enemy.stateTimer = 0.18;
        enemy.vx = nx * 5;
        enemy.vy = ny * 5;
        break;
      case 'combo':
        enemy.attackHitRadius = 3.3;
        enemy.stateTimer = 0.22;
        enemy.vx = nx * 5;
        enemy.vy = ny * 5;
        break;
      case 'whirlwind':
        enemy.attackHitRadius = 3.8;
        enemy.stateTimer = 0.4;
        enemy.vx = 0;
        enemy.vy = 0;
        break;
      default:
        enemy.attackHitRadius = 3.3;
        enemy.stateTimer = 0.2;
        break;
    }
  }

  /** Advance a multi-hit combo or close the attack into recovery. */
  private updateRoninAttack(enemy: Enemy, nx: number, ny: number): void {
    const move = enemy.roninMove ?? '';

    if (move === 'wave_backstep') {
      if (enemy.stateTimer <= 0) {
        enemy.roninMove = 'wave';
        enemy.state = 'telegraph';
        enemy.stateTimer = 0.52;
        enemy.vx = 0;
        enemy.vy = 0;
      }
      return;
    }

    if (enemy.stateTimer > 0) return;

    const isCombo = move === 'twin' || move === 'combo';
    const maxHits = move === 'twin' ? 2 : move === 'combo' ? 3 : 1;
    const step = (enemy.roninComboStep ?? 0) + 1;
    if (isCombo && step < maxHits) {
      enemy.roninComboStep = step;
      enemy.stateTimer = move === 'combo' ? 0.22 : 0.18;
      enemy.vx = nx * 5;
      enemy.vy = ny * 5;
      return;
    }

    enemy.state = 'recover';
    enemy.stateTimer = RONIN_RECOVERY;
    enemy.vx = 0;
    enemy.vy = 0;
  }

  /** Launch the Ronin's golden crescent energy slash wave (parry-deflectable). */
  private fireRoninWave(enemy: Enemy, px: number, py: number): void {
    const dx = px - enemy.x;
    const dy = py - enemy.y;
    const d = Math.hypot(dx, dy) || 1;
    this.projectiles.push({
      x: enemy.x,
      y: enemy.y,
      vx: (dx / d) * RONIN_WAVE_SPEED,
      vy: (dy / d) * RONIN_WAVE_SPEED,
      life: RONIN_WAVE_LIFE,
      damage: RONIN_WAVE_DAMAGE,
      radius: RONIN_WAVE_RADIUS,
      golden: true,
    });
    this.engine.triggerShake(0.1);
  }

  // --- Combat ----------------------------------------------------------------

  /** Put an enemy into a staggered state with a small backward shove. */
  private staggerEnemy(enemy: Enemy, duration: number, px: number, py: number): void {
    enemy.staggerTimer = Math.max(enemy.staggerTimer, duration);
    enemy.state = 'idle';
    enemy.vx = 0;
    enemy.vy = 0;

    const dx = enemy.x - px;
    const dy = enemy.y - py;
    const d = Math.hypot(dx, dy) || 1;
    enemy.kbx += (dx / d) * PARRY_KNOCKBACK;
    enemy.kby += (dy / d) * PARRY_KNOCKBACK;
  }

  /**
   * Radiant Burst: deal light damage and stun every enemy within `radius` of
   * the player. Dead enemies are filtered out by the next `update()` pass.
   */
  public radiantBurst(x: number, y: number, radius: number, damage: number, stunDuration: number): void {
    for (const enemy of this.enemies) {
      const d = Math.hypot(enemy.x - x, enemy.y - y);
      if (d > radius) continue;
      if (enemy.roninInvuln !== undefined && enemy.roninInvuln > 0) continue;
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
      if (enemy.roninInvuln !== undefined && enemy.roninInvuln > 0) continue;

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

      // Riposte: a swing against a staggered enemy deals 2x damage.
      const riposte = enemy.staggerTimer > 0 ? 2 : 1;
      enemy.hp -= this.swordDamage * riposte;
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
        if (this.engine.isParryActive() && d < DEFLECT_RANGE) {
          this.deflectProjectile(p);
          consumed = true;
        } else if (d < PLAYER_RADIUS + p.radius) {
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

  /** Reverse a spore orb into a fast friendly projectile along the player aim. */
  private deflectProjectile(p: EnemyProjectile): void {
    let dx = this.engine.aimX;
    let dy = this.engine.aimY;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) {
      dx = 0;
      dy = 1;
    } else {
      dx /= len;
      dy /= len;
    }

    this.friendly.push({
      x: p.x,
      y: p.y,
      vx: dx * FRIENDLY_PROJECTILE_SPEED,
      vy: dy * FRIENDLY_PROJECTILE_SPEED,
      life: FRIENDLY_PROJECTILE_LIFE,
      damage: DEFLECT_DAMAGE,
      radius: FRIENDLY_PROJECTILE_RADIUS,
    });
    this.engine.onParrySuccess();
  }

  private updateFriendlyProjectiles(dt: number): void {
    const remaining: FriendlyProjectile[] = [];
    for (const f of this.friendly) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.life -= dt;

      let consumed = f.life <= 0;
      if (!consumed) {
        for (const enemy of this.enemies) {
          if (enemy.roninInvuln !== undefined && enemy.roninInvuln > 0) continue;
          const archetype = AssetRegistry.getEnemyArchetype(enemy.assetId);
          const d = Math.hypot(enemy.x - f.x, enemy.y - f.y);
          if (d < archetype.radius + f.radius) {
            enemy.hp -= f.damage;
            enemy.hitFlashTimer = HIT_FLASH_DURATION;
            consumed = true;
            break;
          }
        }
      }

      if (!consumed) remaining.push(f);
    }
    this.friendly = remaining;
  }

  /** Record a bright parry clash at the midpoint between player and enemy. */
  private spawnClashSpark(px: number, py: number, ex: number, ey: number): void {
    this.clashes.push({ x: (px + ex) / 2, y: (py + ey) / 2, age: 0 });
  }

  /** Age and retire clash sparks so EnemyLayer can fade their rings. */
  private updateClashes(dt: number): void {
    for (const c of this.clashes) c.age += dt;
    this.clashes = this.clashes.filter((c) => c.age < CLASH_SPARK_DURATION);
  }

  /** Age and retire shockwave rings. */
  private updateShockwaves(dt: number): void {
    for (const s of this.shockwaves) s.age += dt;
    this.shockwaves = this.shockwaves.filter((s) => s.age < s.life);
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
