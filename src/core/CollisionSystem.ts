import type { CircleCollider } from './types';

export class CollisionSystem {
  private readonly colliders: CircleCollider[] = [];

  add(collider: CircleCollider): void {
    this.colliders.push(collider);
  }

  addMany(colliders: CircleCollider[]): void {
    for (const c of colliders) this.colliders.push(c);
  }

  clear(): void {
    this.colliders.length = 0;
  }

  get count(): number {
    return this.colliders.length;
  }

  /**
   * Push a moving circle out of every overlapping collider. Runs a couple of
   * passes so adjacent trunks / rocks settle into a stable position.
   */
  resolve(pos: { x: number; y: number }, radius: number, passes = 2): void {
    for (let pass = 0; pass < passes; pass++) {
      for (const c of this.colliders) {
        const dx = pos.x - c.x;
        const dy = pos.y - c.y;
        const minDist = c.radius + radius;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDist * minDist) continue;

        const dist = Math.sqrt(distSq);
        if (dist < 1e-5) {
          // Player is exactly on the collider centre: nudge straight up.
          pos.y = c.y + minDist;
          continue;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        pos.x = c.x + nx * minDist;
        pos.y = c.y + ny * minDist;
      }
    }
  }
}
