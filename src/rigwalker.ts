import * as THREE from "three";

export type Rigwalker = {
  group: THREE.Group;
  update: (elapsed: number) => void;
};

const armor = new THREE.MeshStandardMaterial({
  color: 0x596266,
  metalness: 0.72,
  roughness: 0.44,
});
const darkMetal = new THREE.MeshStandardMaterial({
  color: 0x252b2d,
  metalness: 0.82,
  roughness: 0.4,
});
const jointMaterial = new THREE.MeshStandardMaterial({
  color: 0x858d8f,
  metalness: 0.9,
  roughness: 0.3,
});
const orange = new THREE.MeshStandardMaterial({
  color: 0xf29a3f,
  emissive: 0x8c3b0d,
  emissiveIntensity: 0.75,
  metalness: 0.4,
  roughness: 0.35,
});
const visor = new THREE.MeshStandardMaterial({
  color: 0x8ce7f0,
  emissive: 0x46c9dc,
  emissiveIntensity: 2.4,
  metalness: 0.2,
  roughness: 0.18,
});

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createLeg(side: -1 | 1): {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
} {
  const hip = new THREE.Group();
  hip.position.set(side * 0.28, 1.55, 0);

  addMesh(
    hip,
    new THREE.SphereGeometry(0.15, 8, 6),
    jointMaterial,
    [0, 0, 0],
  );
  addMesh(
    hip,
    new THREE.BoxGeometry(0.23, 0.72, 0.27),
    armor,
    [0, -0.42, 0],
  );

  const knee = new THREE.Group();
  knee.position.y = -0.8;
  hip.add(knee);
  addMesh(
    knee,
    new THREE.CylinderGeometry(0.15, 0.15, 0.28, 8),
    orange,
    [0, 0, 0],
  ).rotation.z = Math.PI / 2;
  addMesh(
    knee,
    new THREE.BoxGeometry(0.21, 0.72, 0.24),
    darkMetal,
    [0, -0.43, 0.02],
  );

  const ankle = new THREE.Group();
  ankle.position.y = -0.82;
  knee.add(ankle);
  addMesh(
    ankle,
    new THREE.BoxGeometry(0.34, 0.18, 0.55),
    armor,
    [0, -0.06, 0.13],
  );
  addMesh(
    ankle,
    new THREE.BoxGeometry(0.23, 0.08, 0.18),
    orange,
    [0, 0.06, 0.44],
  );

  return { hip, knee, ankle };
}

function createArm(side: -1 | 1): {
  shoulder: THREE.Group;
  elbow: THREE.Group;
} {
  const shoulder = new THREE.Group();
  shoulder.position.set(side * 0.68, 2.72, 0);

  addMesh(
    shoulder,
    new THREE.SphereGeometry(0.19, 8, 6),
    orange,
    [0, 0, 0],
  );
  addMesh(
    shoulder,
    new THREE.BoxGeometry(0.24, 0.72, 0.27),
    armor,
    [0, -0.44, 0],
  );

  const elbow = new THREE.Group();
  elbow.position.y = -0.85;
  shoulder.add(elbow);
  addMesh(
    elbow,
    new THREE.SphereGeometry(0.13, 8, 6),
    jointMaterial,
    [0, 0, 0],
  );
  addMesh(
    elbow,
    new THREE.BoxGeometry(0.21, 0.62, 0.24),
    darkMetal,
    [0, -0.39, 0],
  );
  addMesh(
    elbow,
    new THREE.BoxGeometry(0.29, 0.24, 0.3),
    armor,
    [0, -0.76, 0.03],
  );

  return { shoulder, elbow };
}

export function createRigwalker(): Rigwalker {
  const group = new THREE.Group();
  group.name = "Rigwalker";

  const animatedRoot = new THREE.Group();
  group.add(animatedRoot);

  const leftLeg = createLeg(-1);
  const rightLeg = createLeg(1);
  animatedRoot.add(leftLeg.hip, rightLeg.hip);

  addMesh(
    animatedRoot,
    new THREE.BoxGeometry(0.72, 0.38, 0.52),
    darkMetal,
    [0, 1.65, 0],
  );
  addMesh(
    animatedRoot,
    new THREE.BoxGeometry(1.08, 1.12, 0.62),
    armor,
    [0, 2.35, 0],
  );
  addMesh(
    animatedRoot,
    new THREE.BoxGeometry(0.92, 0.16, 0.68),
    orange,
    [0, 2.68, 0.03],
  );
  addMesh(
    animatedRoot,
    new THREE.BoxGeometry(0.62, 0.86, 0.28),
    darkMetal,
    [0, 2.28, -0.56],
  );

  const leftArm = createArm(-1);
  const rightArm = createArm(1);
  animatedRoot.add(leftArm.shoulder, rightArm.shoulder);

  const head = new THREE.Group();
  head.position.y = 3.15;
  animatedRoot.add(head);
  addMesh(
    head,
    new THREE.BoxGeometry(0.58, 0.52, 0.52),
    darkMetal,
    [0, 0, 0],
  );
  addMesh(
    head,
    new THREE.BoxGeometry(0.46, 0.14, 0.07),
    visor,
    [0, 0.06, 0.295],
  );
  addMesh(
    head,
    new THREE.BoxGeometry(0.13, 0.21, 0.15),
    orange,
    [0.28, 0.18, -0.04],
  );

  addMesh(
    animatedRoot,
    new THREE.CylinderGeometry(0.035, 0.035, 0.75, 6),
    jointMaterial,
    [0.38, 3.65, -0.16],
  );
  addMesh(
    animatedRoot,
    new THREE.SphereGeometry(0.09, 8, 6),
    visor,
    [0.38, 4.03, -0.16],
  );

  function update(elapsed: number): void {
    const stride = Math.sin(elapsed * 4.2);
    const oppositeStride = -stride;
    const stepLift = Math.abs(Math.cos(elapsed * 4.2));

    leftLeg.hip.rotation.x = stride * 0.52;
    rightLeg.hip.rotation.x = oppositeStride * 0.52;
    leftLeg.knee.rotation.x = Math.max(0, -stride) * 0.72;
    rightLeg.knee.rotation.x = Math.max(0, stride) * 0.72;
    leftLeg.ankle.rotation.x = -leftLeg.hip.rotation.x * 0.35;
    rightLeg.ankle.rotation.x = -rightLeg.hip.rotation.x * 0.35;

    leftArm.shoulder.rotation.x = oppositeStride * 0.42;
    rightArm.shoulder.rotation.x = stride * 0.42;
    leftArm.elbow.rotation.x = -0.25 - Math.max(0, stride) * 0.3;
    rightArm.elbow.rotation.x = -0.25 - Math.max(0, -stride) * 0.3;

    animatedRoot.position.y = 0.07 + stepLift * 0.08;
    animatedRoot.rotation.z = stride * 0.025;
    head.rotation.y = Math.sin(elapsed * 1.1) * 0.07;
  }

  return { group, update };
}
