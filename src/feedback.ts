import * as THREE from "three";

type Marker = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
};

const MARKER_LIFETIME = 0.75;

export class MovementMarkers {
  private readonly scene: THREE.Scene;
  private readonly markers: Marker[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  add(position: THREE.Vector3): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffb35d,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.24, 24),
      material,
    );
    mesh.position.copy(position);
    mesh.position.y += 0.08;
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    this.markers.push({ mesh, age: 0 });
  }

  update(delta: number): void {
    for (let index = this.markers.length - 1; index >= 0; index -= 1) {
      const marker = this.markers[index];
      marker.age += delta;
      const progress = marker.age / MARKER_LIFETIME;
      marker.mesh.scale.setScalar(1 + progress * 3.4);
      marker.mesh.material.opacity = Math.max(0, 1 - progress);

      if (marker.age >= MARKER_LIFETIME) {
        this.scene.remove(marker.mesh);
        marker.mesh.geometry.dispose();
        marker.mesh.material.dispose();
        this.markers.splice(index, 1);
      }
    }
  }
}
