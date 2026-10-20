import type * as THREE from "three";

/** Una vista de la escena (mapa estelar, sistema…). El motor solo dibuja la activa. */
export interface View {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  activate(): void;
  deactivate(): void;
  update(dt: number): void;
  resize(width: number, height: number): void;
  /** Clic simple (sin arrastre), en coordenadas normalizadas. */
  onClick(ndcX: number, ndcY: number): void;
  onDoubleClick(ndcX: number, ndcY: number): void;
  onHover(ndcX: number, ndcY: number): void;
  onKey(code: string): void;
  dispose(): void;
}
