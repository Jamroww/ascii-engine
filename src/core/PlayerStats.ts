/** Brief window after taking a hit during which further damage is ignored. */
const INVULN_DURATION = 0.6;

// Dash tuning.
const DASH_DURATION = 0.16;
const DASH_COOLDOWN = 0.65;
const BLIGHT_DASH_COOLDOWN = 0.5;
const DASH_STAMINA_COST = 20;
const DASH_SPEED = 24;
const BLIGHT_DASH_SPEED_MULTIPLIER = 1.35;
const BLIGHT_DASH_CORRUPTION = 25;
/** Each 30 corruption grants an additional +12% passive move speed. */
const MOVE_SPEED_THRESHOLD = 30;

export class PlayerStats {
  health = 100;
  stamina = 200;

  private bonusMaxHp = 0;
  private bonusMaxStamina = 0;
  private damageReduction = 0;

  /** Live corruption read each frame by the engine (drives Blight Dash + move speed). */
  corruption = 0;

  private invulnTimer = 0;
  private dashTimer = 0;
  private dashCooldown = 0;
  private dashActive = false;

  get maxHealth(): number {
    return 100 + this.bonusMaxHp;
  }

  get maxStamina(): number {
    return 200 + this.bonusMaxStamina;
  }

  /** Apply equipment-derived bonuses (called once per gameplay frame). */
  applyEquipment(bonusMaxHp: number, bonusMaxStamina: number, damageReduction: number): void {
    this.bonusMaxHp = bonusMaxHp;
    this.bonusMaxStamina = bonusMaxStamina;
    this.damageReduction = damageReduction;
    // Clamp current pools if a swap lowered the caps.
    this.health = Math.min(this.health, this.maxHealth);
    this.stamina = Math.min(this.stamina, this.maxStamina);
  }

  get isDead(): boolean {
    return this.health <= 0;
  }

  get isDashing(): boolean {
    return this.dashActive;
  }

  /** Blight Dash is active whenever corruption crosses its unlock threshold. */
  get isBlightDash(): boolean {
    return this.corruption >= BLIGHT_DASH_CORRUPTION;
  }

  /** Passive move-speed bonus from corruption thresholds (0, 0.12, 0.24, …). */
  get moveSpeedBonus(): number {
    return Math.floor(this.corruption / MOVE_SPEED_THRESHOLD) * 0.12;
  }

  /** Dash velocity in world units / second (Blight Dash is ~35% faster). */
  get dashSpeed(): number {
    return this.isBlightDash ? DASH_SPEED * BLIGHT_DASH_SPEED_MULTIPLIER : DASH_SPEED;
  }

  /** 0..1 of the remaining dash cooldown (0 when ready). */
  get dashCooldownFraction(): number {
    const max = this.isBlightDash ? BLIGHT_DASH_COOLDOWN : DASH_COOLDOWN;
    return this.dashCooldown > 0 ? this.dashCooldown / max : 0;
  }

  get dashCooldownRemaining(): number {
    return this.dashCooldown;
  }

  /** True when a dash can be started right now (cooldown + stamina gate). */
  get dashReady(): boolean {
    return this.dashCooldown <= 0 && !this.dashActive && this.stamina >= DASH_STAMINA_COST;
  }

  /**
   * Apply a hit from an enemy. Returns true only if the damage actually landed;
   * hits during the invulnerability window or a dash are swallowed.
   */
  takeDamage(amount: number): boolean {
    if (amount <= 0 || this.isInvulnerable()) return false;
    const mitigated = amount * (1 - this.damageReduction);
    this.health = Math.max(0, this.health - mitigated);
    this.invulnTimer = INVULN_DURATION;
    return true;
  }

  /** True while a hit's mercy window or a dash i-frame window is active. */
  isInvulnerable(): boolean {
    return this.invulnTimer > 0 || this.dashActive;
  }

  /** Restore health without exceeding the cap (ignored while dead). */
  heal(amount: number): void {
    if (amount <= 0 || this.health <= 0) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  /** Spend stamina; returns false when the pool is too small. */
  spendStamina(amount: number): boolean {
    if (this.stamina < amount) return false;
    this.stamina -= amount;
    return true;
  }

  /** Refund stamina (e.g. a successful parry) without exceeding the cap. */
  restoreStamina(amount: number): void {
    if (amount <= 0 || this.stamina <= 0) return;
    this.stamina = Math.min(this.maxStamina, this.stamina + amount);
  }

  /** Start a dash if cooldown + stamina allow; returns true when it began. */
  tryStartDash(): boolean {
    if (this.dashCooldown > 0 || this.dashActive) return false;
    if (this.stamina < DASH_STAMINA_COST) return false;
    this.stamina -= DASH_STAMINA_COST;
    this.dashActive = true;
    this.dashTimer = DASH_DURATION;
    this.dashCooldown = this.isBlightDash ? BLIGHT_DASH_COOLDOWN : DASH_COOLDOWN;
    return true;
  }

  /** Advance dash timers (called each gameplay frame). */
  updateDash(dt: number): void {
    if (this.dashTimer > 0) {
      this.dashTimer = Math.max(0, this.dashTimer - dt);
      if (this.dashTimer <= 0) this.dashActive = false;
    }
    if (this.dashCooldown > 0) {
      this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    }
  }

  /** Restore full health/stamina and clear transient timers (respawn / level load). */
  reset(): void {
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.invulnTimer = 0;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashActive = false;
  }

  /**
   * Advance health and stamina. Returns whether sprinting is currently allowed.
   */
  update(dt: number, wantSprint: boolean, moving: boolean, wading: boolean): boolean {
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);

    const sprinting = wantSprint && moving && !this.dashActive;

    // Sprinting burns stamina; resting recovers it. Dashing pauses both.
    // Regen is bumped ~1.35x (16 -> 22) so the doubled pool refills snappily.
    if (sprinting && this.stamina > 0) {
      this.stamina = Math.max(0, this.stamina - 28 * dt);
    } else if (!sprinting && !this.dashActive) {
      this.stamina = Math.min(this.maxStamina, this.stamina + 22 * dt);
    }

    // The cold river saps warmth; solid ground lets the traveler recover.
    if (wading) {
      this.health = Math.max(0, this.health - 5 * dt);
    } else if (this.health > 0) {
      this.health = Math.min(this.maxHealth, this.health + 3.5 * dt);
    }

    return this.stamina > 0;
  }
}
