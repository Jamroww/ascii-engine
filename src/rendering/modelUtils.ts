import * as THREE from 'three';

/**
 * Dispose every geometry and material in a model subtree. Models built by the
 * procedural factories are only ever owned by a single layer, so callers pass
 * freshly built instances here when tearing them down.
 */
export function disposeModelTree(object: THREE.Object3D): void {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    }
  });
}

/** Toggle shadow casting on every mesh in a subtree. */
export function setCastShadow(object: THREE.Object3D, cast: boolean): void {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) node.castShadow = cast;
  });
}

/** Toggle shadow receiving on every mesh in a subtree. */
export function setReceiveShadow(object: THREE.Object3D, receive: boolean): void {
  object.traverse((node) => {
    if (node instanceof THREE.Mesh) node.receiveShadow = receive;
  });
}
