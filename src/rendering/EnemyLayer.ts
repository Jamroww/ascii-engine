import * as THREE from 'three';
import type { FrameContext, IRenderLayer } from '../core/types';
import { MELEE_TELEGRAPH_GLINT_WINDOW } from '../core/EnemyManager';
import type { Enemy, EnemyManager } from '../core/EnemyManager';
import { ENEMY_MODEL_FACTORIES, type EnemyAssetId } from './Enemies';
import { disposeModelTree, setCastShadow } from './modelUtils';

const HIT_FLASH_DURATION = 0.12;
const CLASH_SPARK_DURATION = 0.22;

interface EnemyMaterialRef {
  mat: THREE.MeshStandardMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
}

interface EnemyModelEntry {
  id: string;
  assetId: string;
  model: THREE.Group;
  materials: EnemyMaterialRef[];
  glintRing: THREE.Mesh;
}

/**
 * Spawns real 3D enemy models directly in the world scene, facing their
 * movement/target direction, with emissive hit-flash / telegraph pulse and
 * glowing spore spheres for projectiles. Enemy state stays owned by
 * `EnemyManager`; this layer only reads it.
 */
export class EnemyLayer implements IRenderLayer {
  public readonly object3D = new THREE.Group();

  private readonly manager: EnemyManager;
  private readonly entries = new Map<string, EnemyModelEntry>();

  private readonly projectileGeometry = new THREE.SphereGeometry(0.32, 8, 6);
  private readonly projectileMeshes: THREE.Mesh[] = [];
  private readonly friendlyProjectileGeometry = new THREE.SphereGeometry(0.22, 8, 6);
  private readonly friendlyProjectileMeshes: THREE.Mesh[] = [];
  private readonly ringGeometry = new THREE.RingGeometry(0.5, 0.6, 24);
  private readonly clashMeshes: THREE.Mesh[] = [];

  constructor(manager: EnemyManager) {
    this.manager = manager;
  }

  public update(ctx: FrameContext): void {
    this.updateEnemies(ctx);
    this.updateProjectiles(ctx);
    this.updateFriendlyProjectiles(ctx);
    this.updateClashes();
  }

  public dispose(): void {
    for (const entry of this.entries.values()) {
      this.disposeEntry(entry);
    }
    this.entries.clear();
    for (const mesh of this.projectileMeshes) {
      (mesh.material as THREE.Material).dispose();
    }
    this.projectileMeshes.length = 0;
    for (const mesh of this.friendlyProjectileMeshes) {
      (mesh.material as THREE.Material).dispose();
    }
    this.friendlyProjectileMeshes.length = 0;
    for (const mesh of this.clashMeshes) {
      (mesh.material as THREE.Material).dispose();
    }
    this.clashMeshes.length = 0;
    this.projectileGeometry.dispose();
    this.friendlyProjectileGeometry.dispose();
    this.ringGeometry.dispose();
    this.object3D.clear();
  }

  // --- Per-frame updates -----------------------------------------------------

  private updateEnemies(ctx: FrameContext): void {
    const enemies = this.manager.getEnemies();
    const seen = new Set<string>();

    for (const enemy of enemies) {
      seen.add(enemy.id);
      let entry = this.entries.get(enemy.id);
      if (!entry) {
        entry = this.createEntry(enemy.id, enemy.assetId);
        this.entries.set(enemy.id, entry);
      } else if (entry.assetId !== enemy.assetId) {
        this.disposeEntry(entry);
        entry = this.createEntry(enemy.id, enemy.assetId);
        this.entries.set(enemy.id, entry);
      }
      this.applyEnemy(entry, enemy, ctx);
    }

    const stale: string[] = [];
    for (const id of this.entries.keys()) {
      if (!seen.has(id)) stale.push(id);
    }
    for (const id of stale) {
      const entry = this.entries.get(id);
      if (entry) this.disposeEntry(entry);
      this.entries.delete(id);
    }
  }

  private applyEnemy(entry: EnemyModelEntry, enemy: Enemy, ctx: FrameContext): void {
    const model = entry.model;
    model.position.set(enemy.x, 0, -enemy.y);

    // Face movement, or the player when stationary.
    let fx = enemy.vx;
    let fy = enemy.vy;
    if (Math.hypot(fx, fy) < 0.001) {
      fx = ctx.playerPos.x - enemy.x;
      fy = ctx.playerPos.y - enemy.y;
    }
    model.rotation.y = Math.atan2(fx, -fy);

    // Telegraph wind-up pulse + a bright white/gold glint in the final window.
    const telegraph = enemy.state === 'telegraph';
    const telegraphPulse = 0.5 + 0.5 * Math.sin(ctx.elapsed * 26);
    const glint = telegraph && enemy.stateTimer <= MELEE_TELEGRAPH_GLINT_WINDOW;
    const glintPulse = 0.5 + 0.5 * Math.sin(ctx.elapsed * 34);

    let baseScale = 1.0;
    if (enemy.assetId === 'blight_stalker') baseScale = 1.7;
    else if (enemy.assetId === 'castle_warden') baseScale = 1.35;
    model.scale.setScalar(baseScale * (telegraph ? 1.0 + telegraphPulse * 0.2 : 1.0));

    // Emissive hit-flash / telegraph / stagger / stun tint.
    const flash =
      enemy.hitFlashTimer > 0 ? Math.min(1, enemy.hitFlashTimer / HIT_FLASH_DURATION) : 0;
    const staggered = enemy.staggerTimer > 0;
    const stunned = enemy.stunTimer > 0;
    const stunPulse = 0.6 + 0.4 * Math.sin(ctx.elapsed * 22);

    for (const ref of entry.materials) {
      const mat = ref.mat;
      if (flash > 0) {
        mat.emissive.setRGB(1, 1, 1);
        mat.emissiveIntensity = ref.baseIntensity + flash * 2.5;
      } else if (telegraph) {
        if (glint) {
          mat.emissive.setRGB(1.0, 1.0, 1.0);
          mat.emissiveIntensity = ref.baseIntensity + glintPulse * 2.2;
        } else {
          mat.emissive.setRGB(1.0, 0.9, 0.45);
          mat.emissiveIntensity = ref.baseIntensity + telegraphPulse * 0.8;
        }
      } else if (staggered) {
        mat.emissive.setRGB(0.82, 0.88, 0.98);
        mat.emissiveIntensity = ref.baseIntensity + stunPulse * 0.55;
      } else if (stunned) {
        mat.emissive.setRGB(1.0, 0.8, 0.3);
        mat.emissiveIntensity = ref.baseIntensity + stunPulse * 0.6;
      } else {
        mat.emissive.copy(ref.baseEmissive);
        mat.emissiveIntensity = ref.baseIntensity;
      }
    }

    // Small expanding glint ring during the final coil moment.
    const ring = entry.glintRing;
    const ringMat = ring.material as THREE.MeshBasicMaterial;
    if (glint) {
      const g = 1 - enemy.stateTimer / MELEE_TELEGRAPH_GLINT_WINDOW;
      ring.visible = true;
      ring.position.set(enemy.x, 0.15, -enemy.y);
      ring.scale.setScalar(0.6 + g * 1.3);
      ringMat.opacity = (0.25 + 0.75 * g) * (0.6 + 0.4 * glintPulse);
    } else {
      ring.visible = false;
    }
  }

  private updateProjectiles(ctx: FrameContext): void {
    const projectiles = this.manager.getProjectiles();

    while (this.projectileMeshes.length < projectiles.length) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0x44ff66,
        emissiveIntensity: 2.0,
        roughness: 0.3,
      });
      const mesh = new THREE.Mesh(this.projectileGeometry, mat);
      mesh.castShadow = false;
      this.object3D.add(mesh);
      this.projectileMeshes.push(mesh);
    }

    for (let i = 0; i < this.projectileMeshes.length; i++) {
      const mesh = this.projectileMeshes[i];
      const proj = projectiles[i];
      if (!proj) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(proj.x, 0.6, -proj.y);

      const mat = mesh.material as THREE.MeshStandardMaterial;
      const violet = i % 2 === 0;
      mat.emissive.setRGB(violet ? 0.7 : 0.35, violet ? 0.4 : 0.95, violet ? 0.95 : 0.5);
      const pulse = 0.75 + 0.25 * Math.sin(ctx.elapsed * 18 + i * 1.7);
      mat.emissiveIntensity = 2.0 * pulse;

      const size = 0.72 + Math.sin(ctx.elapsed * 20 + i * 1.3) * 0.14;
      mesh.scale.setScalar(size);
    }
  }

  private updateFriendlyProjectiles(ctx: FrameContext): void {
    const projectiles = this.manager.getFriendlyProjectiles();

    while (this.friendlyProjectileMeshes.length < projectiles.length) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xffffff,
        emissiveIntensity: 2.6,
        roughness: 0.25,
      });
      const mesh = new THREE.Mesh(this.friendlyProjectileGeometry, mat);
      mesh.castShadow = false;
      this.object3D.add(mesh);
      this.friendlyProjectileMeshes.push(mesh);
    }

    for (let i = 0; i < this.friendlyProjectileMeshes.length; i++) {
      const mesh = this.friendlyProjectileMeshes[i];
      const proj = projectiles[i];
      if (!proj) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(proj.x, 0.6, -proj.y);

      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissive.setRGB(0.9, 0.96, 1.0);
      const pulse = 0.85 + 0.15 * Math.sin(ctx.elapsed * 24 + i * 1.3);
      mat.emissiveIntensity = 2.6 * pulse;

      const size = 0.6 + Math.sin(ctx.elapsed * 22 + i * 1.7) * 0.1;
      mesh.scale.setScalar(size);
    }
  }

  private updateClashes(): void {
    const clashes = this.manager.getClashes();

    while (this.clashMeshes.length < clashes.length) {
      this.clashMeshes.push(this.createRingMesh());
    }

    for (let i = 0; i < this.clashMeshes.length; i++) {
      const mesh = this.clashMeshes[i];
      const clash = clashes[i];
      if (!clash) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(clash.x, 0.15, -clash.y);
      const p = Math.min(1, clash.age / CLASH_SPARK_DURATION);
      mesh.scale.setScalar(0.3 + p * 2.2);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 1 - p;
    }
  }

  // --- Helpers ---------------------------------------------------------------

  private createEntry(id: string, assetId: string): EnemyModelEntry {
    const factory = ENEMY_MODEL_FACTORIES[assetId as EnemyAssetId];
    const model = factory ? factory() : new THREE.Group();
    model.name = id;
    setCastShadow(model, true);
    this.object3D.add(model);

    const materials: EnemyMaterialRef[] = [];
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const mat = node.material;
      if (mat instanceof THREE.MeshStandardMaterial) {
        materials.push({
          mat,
          baseEmissive: mat.emissive.clone(),
          baseIntensity: mat.emissiveIntensity,
        });
      }
    });

    const glintRing = this.createRingMesh();

    return { id, assetId, model, materials, glintRing };
  }

  private createRingMesh(): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.ringGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.frustumCulled = false;
    mesh.visible = false;
    this.object3D.add(mesh);
    return mesh;
  }

  private disposeEntry(entry: EnemyModelEntry): void {
    this.object3D.remove(entry.model);
    this.object3D.remove(entry.glintRing);
    (entry.glintRing.material as THREE.Material).dispose();
    disposeModelTree(entry.model);
  }
}
