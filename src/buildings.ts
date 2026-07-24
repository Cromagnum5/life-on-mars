import * as THREE from "three";

type MaterialSet = {
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
};

export type StarterBase = {
  group: THREE.Group;
  assemblyDoor: THREE.Group;
  spawnPosition: THREE.Vector2;
  accent: number;
};

export const CORPORATIONS = [
  { name: "Helios", accent: 0x32b9ff, center: new THREE.Vector2(-58, 38), rotation: -Math.PI / 4 },
  { name: "Vanguard", accent: 0xff4f57, center: new THREE.Vector2(58, -38), rotation: (3 * Math.PI) / 4 },
] as const;

const LOCAL_BUILDING_SITES = [
  new THREE.Vector2(-12, -8),
  new THREE.Vector2(10, -6),
  new THREE.Vector2(0, 12),
] as const;
const BUILDING_RADII = [4.8, 6.2, 5.1] as const;

function toWorldSite(site: THREE.Vector2, center: THREE.Vector2, rotation: number): THREE.Vector2 {
  return site.clone().rotateAround(new THREE.Vector2(), rotation).add(center);
}

export const BUILDING_SITES = CORPORATIONS.flatMap((corporation) =>
  LOCAL_BUILDING_SITES.map((site) => toWorldSite(site, corporation.center, corporation.rotation)),
);
export const BUILDING_OBSTACLES = BUILDING_SITES.map((center, index) => ({
  center,
  radius: BUILDING_RADII[index % BUILDING_RADII.length],
}));

const dark = new THREE.MeshStandardMaterial({
  color: 0x303638,
  metalness: 0.75,
  roughness: 0.48,
});
const metal = new THREE.MeshStandardMaterial({
  color: 0x596166,
  metalness: 0.82,
  roughness: 0.38,
});
const panel = new THREE.MeshStandardMaterial({
  color: 0x485155,
  metalness: 0.62,
  roughness: 0.58,
});
const foundationMaterial = new THREE.MeshStandardMaterial({
  color: 0x2b2927,
  metalness: 0.3,
  roughness: 0.82,
});

function accentMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.8,
    metalness: 0.35,
    roughness: 0.3,
  });
}

function materials(accent: number): MaterialSet {
  return { dark, metal, panel, accent: accentMaterial(accent) };
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  rotation?: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  if (rotation) {
    mesh.rotation.set(...rotation);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addFoundation(
  parent: THREE.Object3D,
  width: number,
  depth: number,
  accent: THREE.Material,
): void {
  addMesh(
    parent,
    new THREE.BoxGeometry(width, 0.45, depth),
    foundationMaterial,
    [0, 0.23, 0],
  );

  const corners: [number, number, number][] = [
    [-width / 2 + 0.45, 0.5, -depth / 2 + 0.45],
    [width / 2 - 0.45, 0.5, -depth / 2 + 0.45],
    [-width / 2 + 0.45, 0.5, depth / 2 - 0.45],
    [width / 2 - 0.45, 0.5, depth / 2 - 0.45],
  ];
  for (const corner of corners) {
    addMesh(parent, new THREE.BoxGeometry(0.45, 0.12, 0.45), accent, corner);
  }
}

function createReactor(accent: number): THREE.Group {
  const building = new THREE.Group();
  building.name = "Reactor";
  const material = materials(accent);
  addFoundation(building, 8.5, 8.5, material.accent);

  addMesh(
    building,
    new THREE.CylinderGeometry(3.1, 3.6, 1.5, 8),
    material.dark,
    [0, 1.15, 0],
  );
  addMesh(
    building,
    new THREE.CylinderGeometry(1.55, 1.9, 5.5, 12),
    material.panel,
    [0, 4.1, 0],
  );
  addMesh(
    building,
    new THREE.CylinderGeometry(1.1, 1.1, 4.4, 16),
    material.accent,
    [0, 4.25, 0],
  );

  for (const y of [2.3, 4.1, 5.9]) {
    addMesh(
      building,
      new THREE.TorusGeometry(1.85, 0.18, 8, 24),
      material.metal,
      [0, y, 0],
      [Math.PI / 2, 0, 0],
    );
  }

  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
    addMesh(
      building,
      new THREE.BoxGeometry(0.48, 4.4, 0.48),
      material.metal,
      [Math.cos(angle) * 2.25, 3.85, Math.sin(angle) * 2.25],
    ).rotation.y = -angle;
  }

  addMesh(
    building,
    new THREE.CylinderGeometry(2.2, 1.65, 0.8, 8),
    material.dark,
    [0, 7.15, 0],
  );
  return building;
}

function createAssemblyBay(accent: number): { group: THREE.Group; door: THREE.Group } {
  const building = new THREE.Group();
  building.name = "Assembly Bay";
  const material = materials(accent);
  addFoundation(building, 11.5, 9, material.accent);

  addMesh(
    building,
    new THREE.BoxGeometry(9.5, 3.8, 6.8),
    material.panel,
    [0, 2.35, 0],
  );
  addMesh(
    building,
    new THREE.BoxGeometry(10.1, 0.55, 7.35),
    material.dark,
    [0, 4.5, 0],
  );
  const door = new THREE.Group();
  door.name = "Assembly Bay door";
  door.position.set(0, 2.25, 3.54);
  building.add(door);
  addMesh(
    door,
    new THREE.BoxGeometry(5.5, 2.9, 0.28),
    material.dark,
    [0, 0, 0],
  );

  for (const x of [-2.15, -1.05, 0, 1.05, 2.15]) {
    addMesh(
      door,
      new THREE.BoxGeometry(0.12, 2.5, 0.12),
      material.metal,
      [x, 0, 0.17],
    );
  }

  addMesh(
    building,
    new THREE.BoxGeometry(5.8, 0.18, 0.2),
    material.accent,
    [0, 3.82, 3.72],
  );
  addMesh(
    building,
    new THREE.BoxGeometry(2.7, 1.5, 2.4),
    material.metal,
    [-3.15, 5.5, -0.4],
  );
  addMesh(
    building,
    new THREE.BoxGeometry(0.22, 0.72, 1.5),
    material.accent,
    [-3.15, 5.55, 0.84],
  );
  addMesh(
    building,
    new THREE.CylinderGeometry(0.12, 0.12, 2.6, 8),
    material.metal,
    [3.2, 5.85, -1.6],
  );
  addMesh(
    building,
    new THREE.SphereGeometry(0.28, 10, 8),
    material.accent,
    [3.2, 7.15, -1.6],
  );
  return { group: building, door };
}

function createExtractor(accent: number): THREE.Group {
  const building = new THREE.Group();
  building.name = "Extractor";
  const material = materials(accent);
  addFoundation(building, 9, 9, material.accent);

  addMesh(
    building,
    new THREE.CylinderGeometry(2.9, 3.4, 1.35, 8),
    material.dark,
    [0, 1.05, 0],
  );
  addMesh(
    building,
    new THREE.CylinderGeometry(2.4, 1.35, 3.1, 8),
    material.panel,
    [0, 3.25, 0],
  );
  addMesh(
    building,
    new THREE.CylinderGeometry(1.35, 1.35, 2.1, 8),
    material.metal,
    [0, 5.85, 0],
  );
  addMesh(
    building,
    new THREE.CylinderGeometry(0.75, 0.75, 3.8, 10),
    material.dark,
    [0, 0.25, 0],
  );
  addMesh(
    building,
    new THREE.ConeGeometry(1.1, 2.2, 8),
    material.metal,
    [0, -1.85, 0],
    [Math.PI, 0, 0],
  );

  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2;
    const leg = addMesh(
      building,
      new THREE.BoxGeometry(0.5, 4.5, 0.5),
      material.metal,
      [Math.cos(angle) * 3.1, 3.15, Math.sin(angle) * 3.1],
      [0, -angle, Math.sin(angle) * 0.12],
    );
    leg.rotation.x = Math.cos(angle) * 0.12;
  }

  addMesh(
    building,
    new THREE.TorusGeometry(1.65, 0.18, 8, 24),
    material.accent,
    [0, 5.35, 0],
    [Math.PI / 2, 0, 0],
  );
  addMesh(
    building,
    new THREE.BoxGeometry(3.5, 0.65, 1.25),
    material.dark,
    [2.65, 3.25, -2.25],
    [0, -0.55, 0],
  );
  return building;
}

export function createBuildings(
  terrainHeightAt: (x: number, z: number) => number,
): StarterBase[] {
  return CORPORATIONS.map((corporation) => {
    const base = new THREE.Group();
    base.name = `${corporation.name} Base`;
    base.position.set(corporation.center.x, 0, corporation.center.y);
    base.rotation.y = -corporation.rotation;
    const assemblyBay = createAssemblyBay(corporation.accent);
    const instances = [createReactor(corporation.accent), assemblyBay.group, createExtractor(corporation.accent)];
    instances.forEach((building, index) => {
      const site = LOCAL_BUILDING_SITES[index];
      const worldSite = toWorldSite(site, corporation.center, corporation.rotation);
      building.position.set(site.x, terrainHeightAt(worldSite.x, worldSite.y) + 0.2, site.y);
      base.add(building);
    });
    return {
      group: base,
      assemblyDoor: assemblyBay.door,
      spawnPosition: toWorldSite(new THREE.Vector2(10, -1.8), corporation.center, corporation.rotation),
      accent: corporation.accent,
    };
  });
}
