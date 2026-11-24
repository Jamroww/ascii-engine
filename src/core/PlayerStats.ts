export class PlayerStats {
  health = 100;
  readonly maxHealth = 100;
  stamina = 100;
  readonly maxStamina = 100;

  /**
   * Advance health and stamina. Returns whether sprinting is currently allowed.
   */
  update(dt: number, wantSprint: boolean, moving: boolean, wading: boolean): boolean {
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
    } else {
      this.health = Math.min(this.maxHealth, this.health + 3.5 * dt);
    }

    return this.stamina > 0;
  }
}
