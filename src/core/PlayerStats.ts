/** Brief window after taking a hit during which further damage is ignored. */
const INVULN_DURATION = 0.6;

export class PlayerStats {
  health = 100;
  readonly maxHealth = 100;
  stamina = 100;
  readonly maxStamina = 100;

  private invulnTimer = 0;

  get isDead(): boolean {
    return this.health <= 0;
  }

  /**
   * Apply a hit from an enemy. Returns true only if the damage actually landed;
   * hits during the invulnerability window are swallowed so a pack can't delete
   * the player in a couple of frames.
   */
  takeDamage(amount: number): boolean {
    if (amount <= 0 || this.invulnTimer > 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.invulnTimer = INVULN_DURATION;
    return true;
  }

  /** Restore full health/stamina and clear invulnerability (respawn / level load). */
  reset(): void {
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.invulnTimer = 0;
  }

  /**
   * Advance health and stamina. Returns whether sprinting is currently allowed.
   */
  update(dt: number, wantSprint: boolean, moving: boolean, wading: boolean): boolean {
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);

    const sprinting = wantSprint && moving;

    // Sprinting burns stamina; resting recovers it.
    if (sprinting && this.stamina > 0) {
      this.stamina = Math.max(0, this.stamina - 28 * dt);
    } else if (!sprinting) {
      this.stamina = Math.min(this.maxStamina, this.stamina + 16 * dt);
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
