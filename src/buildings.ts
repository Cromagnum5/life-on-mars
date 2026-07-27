import * as THREE from "three";

type MaterialSet = {
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
};

/** A building with a door on it: something walks out of here on a timer. */
export type ProducerBuilding = {
  label: string;
  group: THREE.Group;
  door: THREE.Group;
  selectionRing: THREE.Mesh;
  spawnPosition: THREE.Vector2;
};

export type StarterBase = {
  group: THREE.Group;
  assemblyBay: ProducerBuilding;
  stoneworks: ProducerBuilding;
  accent: number;
  corporation: string;
};

export const CORPORATIONS = [
  { name: "Helios", accent: 0x32b9ff, center: new THREE.Vector2(-27.84, 18.24), rotation: -Math.PI / 4 },
  { name: "Vanguard", accent: 0xff4f57, center: new THREE.Vector2(27.84, -18.24), rotation: (3 * Math.PI) / 4 },
] as const;

const LOCAL_BUILDING_SITES = [
  new THREE.Vector2(-12, -8),
  new THREE.Vector2(10, -6),
  new THREE.Vector2(0, 12),
  new THREE.Vector2(-14, 8),
] as const;
const BUILDING_RADII = [4.8, 6.2, 5.1, 5.6] as const;
/**
 * How far in front of a building its batch stands when the door opens, along
 * the way the door faces. Far enough out to be clear of the shutter and of the
 * footprint units steer around.
 */
const DOOR_STANDOFF = 4.2;

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
/** Martian rock as feedstock, kept close to the colour of the scattered rocks. */
const stone = new THREE.MeshStandardMaterial({
  color: 0x5a2a1c,
  metalness: 0.04,
  roughness: 0.92,
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

/** The ring that says a building is selected, sized to its own footprint. */
function addSelectionRing(building: THREE.Group, radius: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + 0.2, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffb35d,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.name = `${building.name} selection ring`;
  ring.position.y = 0.08;
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  building.add(ring);
  return ring;
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

type Producer = {
  group: THREE.Group;
  door: THREE.Group;
  selectionRing: THREE.Mesh;
};

function createAssemblyBay(accent: number): Producer {
  const building = new THREE.Group();
  building.name = "Assembly Bay";
  const material = materials(accent);
  addFoundation(building, 11.5, 9, material.accent);
  const selectionRing = addSelectionRing(building, 6.1);

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
  return { group: building, door, selectionRing };
}

/**
 * Where Hurlers come from: a crusher that eats boulders off a feed ramp and
 * turns out fighters with a cache of rocks on the hip. Squatter and heavier
 * than the Assembly Bay, and with a single-width door, because what walks out
 * of it comes one at a time.
 */
function createStoneworks(accent: number): Producer {
  const building = new THREE.Group();
  building.name = "Stoneworks";
  const material = materials(accent);
  addFoundation(building, 10, 9, material.accent);
  const selectionRing = addSelectionRing(building, 5.6);

  addMesh(
    building,
    new THREE.BoxGeometry(8.4, 3.4, 6.6),
    material.panel,
    [0, 2.15, 0],
  );
  addMesh(
    building,
    new THREE.BoxGeometry(9, 0.5, 7.1),
    material.dark,
    [0, 4.1, 0],
  );

  // The intake: a six-sided hopper flaring open at the top, with a lit rim.
  addMesh(
    building,
    new THREE.CylinderGeometry(2.6, 1.2, 2.8, 6),
    material.dark,
    [0, 5.55, 0],
  );
  addMesh(
    building,
    new THREE.TorusGeometry(2.6, 0.14, 8, 24),
    material.accent,
    [0, 6.9, 0],
    [Math.PI / 2, 0, 0],
  );

  addMesh(
    building,
    new THREE.CylinderGeometry(0.42, 0.52, 3.2, 8),
    material.metal,
    [3.3, 5.55, -2.1],
  );
  addMesh(
    building,
    new THREE.SphereGeometry(0.26, 10, 8),
    material.accent,
    [3.3, 7.35, -2.1],
  );

  const door = new THREE.Group();
  door.name = "Stoneworks door";
  door.position.set(0, 2.25, 3.44);
  building.add(door);
  addMesh(door, new THREE.BoxGeometry(3.6, 2.9, 0.28), material.dark, [0, 0, 0]);

  // Braced across rather than up: a shutter that reads as heavier than the
  // bay's, from the same distance and the same angle.
  for (const y of [-0.9, 0, 0.9]) {
    addMesh(
      door,
      new THREE.BoxGeometry(3.4, 0.12, 0.12),
      material.metal,
      [0, y, 0.17],
    );
  }

  addMesh(
    building,
    new THREE.BoxGeometry(3.9, 0.18, 0.2),
    material.accent,
    [0, 3.82, 3.55],
  );

  // The feed ramp, climbing into the hopper with rock on it. It runs up the
  // right-hand side rather than the back: the camera is fixed, and the two
  // faces away from it are never seen.
  const rampTilt = -0.5;
  const ramp = addMesh(
    building,
    new THREE.BoxGeometry(5.4, 0.32, 1.9),
    material.metal,
    [3.9, 3.2, -0.2],
    [0, 0, rampTilt],
  );
  for (const z of [-0.8, 0.4]) {
    addMesh(
      building,
      new THREE.BoxGeometry(0.3, 1.95, 0.3),
      material.metal,
      [5.9, 0.98, z],
    );
  }
  for (const along of [-1.8, 0, 1.8]) {
    const rock = addMesh(
      building,
      new THREE.DodecahedronGeometry(0.34, 0),
      stone,
      [
        ramp.position.x + along * Math.cos(rampTilt),
        ramp.position.y + along * Math.sin(rampTilt) + 0.44,
        ramp.position.z,
      ],
    );
    rock.rotation.set(along, along * 1.7, 0.4);
  }

  // The stock, piled clear of the door.
  for (const [x, z, size] of [
    [4, 3, 0.9],
    [3.2, 3.5, 0.62],
    [4.2, 2.1, 0.7],
  ] as const) {
    const boulder = addMesh(
      building,
      new THREE.DodecahedronGeometry(size, 0),
      stone,
      [x, 0.45 + size * 0.55, z],
    );
    boulder.rotation.set(size * 3, size * 5, size);
  }

  return { group: building, door, selectionRing };
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
    const stoneworks = createStoneworks(corporation.accent);
    const instances = [
      createReactor(corporation.accent),
      assemblyBay.group,
      createExtractor(corporation.accent),
      stoneworks.group,
    ];
    instances.forEach((building, index) => {
      const site = LOCAL_BUILDING_SITES[index];
      const worldSite = toWorldSite(site, corporation.center, corporation.rotation);
      building.position.set(site.x, terrainHeightAt(worldSite.x, worldSite.y) + 0.2, site.y);
      base.add(building);
    });

    /** Every door faces local +z, so a batch stands that far out in front. */
    const producer = (
      label: string,
      { door, selectionRing, group }: Producer,
      siteIndex: number,
    ): ProducerBuilding => {
      const site = LOCAL_BUILDING_SITES[siteIndex];
      return {
        label,
        group,
        door,
        selectionRing,
        spawnPosition: toWorldSite(
          new THREE.Vector2(site.x, site.y + DOOR_STANDOFF),
          corporation.center,
          corporation.rotation,
        ),
      };
    };

    return {
      group: base,
      assemblyBay: producer("Assembly Bay", assemblyBay, 1),
      stoneworks: producer("Stoneworks", stoneworks, 3),
      accent: corporation.accent,
      corporation: corporation.name,
    };
  });
}
