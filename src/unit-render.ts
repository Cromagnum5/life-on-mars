import * as THREE from "three";

/**
 * Draws an army in a few dozen calls instead of a few thousand.
 *
 * ## What was wrong
 *
 * A Rigwalker is thirty-three separate rigid meshes — nine hundred and sixty
 * triangles in total — hung off a seventeen-bone armature. Nothing in the model
 * is skinned, and every animation channel in the GLB targets a bone, so each of
 * those thirty-three parts has a local transform that never changes. That shape
 * is fine for one fighter and ruinous for a hundred and twenty-eight:
 *
 * | | at sixty-four a side |
 * | --- | --- |
 * | body meshes in the scene | 128 × 33 = 4,224 |
 * | the sun's shadow pass draws them again | + ~4,200 |
 * | health bars, once units are hurt | up to + 256 |
 * | **draw calls a frame** | **≈ 8,700** |
 * | triangles those calls carry | ~123,000 |
 *
 * Eight and a half thousand calls for a hundred and twenty-three thousand
 * triangles. The triangles were never the problem. Three.js spends a few
 * microseconds of JavaScript on every draw — program and material state, a
 * model-view multiply and a normal-matrix inverse-transpose per object, uniform
 * uploads — and eight and a half thousand of those is the forty-odd
 * milliseconds the perf panel was charging to `render`.
 *
 * ## What this does instead
 *
 * Because the parts are rigid, every fighter's version of a given part differs
 * only by a matrix. So each distinct geometry-and-material pair becomes one
 * `InstancedMesh` holding the whole army's copies of that part, and the body's
 * own group is hidden. Thirty-three draws a fighter become thirty-three draws
 * a *field*, and the count stops depending on how many fighters are on it.
 *
 * ## Why it is hidden rather than dismantled
 *
 * The scene graph is left standing, exactly as it was, with only
 * `group.visible` turned off. That is deliberate and it is the whole reason
 * this approach was picked over merging the model in Blender:
 *
 * - `projectObject` returns the moment it meets an invisible object, so the
 *   renderer skips the entire fifty-two node subtree for the price of one
 *   check, and the parts cost nothing to keep.
 * - `updateMatrixWorld` does *not* care about visibility, so every part's world
 *   matrix goes on being correct — which is what this reads to fill the
 *   instances, and also what `sampleBlade`, `getContactPoint`, `describeFeet`,
 *   `freeArmClearance` in the animation tool, and the by-name probes in
 *   `parry.test.ts` and `stone.test.ts` all go on reading.
 * - Raycasting ignores visibility too, so click selection still hits a body.
 *
 * Nothing about poses, the mixer, the clips, the GLB or the Blender tools
 * changes. If the picture is ever in doubt, `?batch=0` puts the meshes back and
 * the two must be pixel-identical.
 */

/**
 * All this needs of a fighter. Structural rather than `Rigwalker` so the batch
 * can be tested against a bare `Object3D` without a GLB to load.
 */
export type BatchedBody = {
  readonly group: THREE.Object3D;
};

/** One draw call: every body's copy of one part. */
type PartBatch = {
  /** A part this batch was built from, for its geometry, material and flags. */
  readonly source: THREE.Mesh;
  mesh: THREE.InstancedMesh | null;
  /** `mesh.instanceMatrix.array`, held so filling a slot is a raw write. */
  matrices: Float32Array;
  /** Instances written this frame. */
  count: number;
  /** Parts registered against it, which is the capacity it has to hold. */
  demand: number;
  capacity: number;
};

type BodyPart = {
  readonly object: THREE.Object3D;
  /**
   * The ancestors between this part and its body's group. All of them have to
   * be visible for the part to be drawn, which is what keeps the existing
   * rules working untouched: a health bar hidden by its group, a sword shown
   * only in combat, a selection ring, a hurler's rock.
   */
  readonly gates: readonly THREE.Object3D[];
  readonly batch: PartBatch;
};

/**
 * Where a batch starts before anybody has registered against it. Small, because
 * most pages hold a handful of units and the growth below is cheap; the sim
 * passes the size of the matchup and skips the growing entirely.
 */
const INITIAL_CAPACITY = 32;

export class RigwalkerBatch {
  private readonly batches = new Map<string, PartBatch>();
  private readonly bodies = new Map<BatchedBody, readonly BodyPart[]>();
  private readonly hint: number;

  /**
   * @param scene the scene the bodies are already in; the instanced parts join
   *              it, and its matrix update becomes this object's business.
   * @param capacity how many bodies to size the first allocation for. Only an
   *              opening bid — batches grow — but a page that knows it is about
   *              to stage sixty-four a side may as well say so.
   */
  constructor(private readonly scene: THREE.Scene, capacity = INITIAL_CAPACITY) {
    this.hint = Math.max(1, capacity);
    // The batch takes over the scene's matrix update from here.
    //
    // It has to: the instances are filled from world matrices, so they must be
    // current *before* the draw, and `renderer.render` would otherwise walk the
    // same seven thousand nodes a second time immediately afterwards. The
    // renderer skips its pass when this is false, which leaves exactly one
    // traversal a frame — the one `sync` does.
    scene.matrixWorldAutoUpdate = false;
  }

  /**
   * Brings the instances up to date with the roster and this frame's poses.
   *
   * Call once a frame, after everything that moves a body and immediately
   * before the draw. Bodies appearing and disappearing are picked up from the
   * roster itself, so spawning and the corpse sweep need no hooks here.
   */
  sync(bodies: readonly BatchedBody[]): void {
    this.register(bodies);
    this.scene.updateMatrixWorld();
    this.fill();
  }

  /**
   * Hands every body back and empties the instances. The instanced meshes stay
   * in the scene, sized as they were, ready to be filled again.
   */
  clear(): void {
    for (const body of [...this.bodies.keys()]) this.forget(body);
    this.fill();
  }

  private register(bodies: readonly BatchedBody[]): void {
    for (const body of bodies) {
      if (!this.bodies.has(body)) this.remember(body);
    }
    if (this.bodies.size === bodies.length) return;
    // Something left the roster. Rare enough — a corpse finishing its sink, or
    // a restart — to be worth a set rather than a scan a frame.
    const live = new Set(bodies);
    for (const body of [...this.bodies.keys()]) {
      if (!live.has(body)) this.forget(body);
    }
  }

  /**
   * Walks a body once and files each of its meshes against a batch.
   *
   * Parts are found by traversal, never by a list of names, so re-exporting the
   * GLB with a new part on it keeps working without anybody remembering this
   * file exists.
   */
  private remember(body: BatchedBody): void {
    const parts: BodyPart[] = [];
    const gates: THREE.Object3D[] = [];
    const walk = (object: THREE.Object3D): void => {
      if (object instanceof THREE.Mesh) {
        parts.push({ object, gates: gates.slice(), batch: this.batchFor(object) });
      }
      // Descended into even from a mesh: nothing in the model hangs geometry
      // off geometry, but a hurler's rock hangs off a bone and an attachment
      // added later could hang off anything.
      gates.push(object);
      for (const child of object.children) walk(child);
      gates.pop();
    };
    for (const child of body.group.children) walk(child);

    this.bodies.set(body, parts);
    body.group.visible = false;
  }

  private forget(body: BatchedBody): void {
    const parts = this.bodies.get(body);
    if (!parts) return;
    for (const part of parts) part.batch.demand -= 1;
    this.bodies.delete(body);
    // Given back whole, so a body that leaves the batch is drawn by whatever
    // takes it next — which is what `?batch=0` and the animation tool expect.
    body.group.visible = true;
  }

  private batchFor(mesh: THREE.Mesh): PartBatch {
    const material = mesh.material;
    const materialKey = Array.isArray(material)
      ? material.map((entry) => entry.uuid).join("+")
      : material.uuid;
    const key = `${mesh.geometry.uuid}:${materialKey}`;

    let batch = this.batches.get(key);
    if (!batch) {
      batch = {
        source: mesh, mesh: null, matrices: new Float32Array(0),
        count: 0, demand: 0, capacity: 0,
      };
      this.batches.set(key, batch);
    }
    batch.demand += 1;
    if (batch.demand > batch.capacity) this.grow(batch);
    return batch;
  }

  /** Reallocates a batch big enough for everything registered against it. */
  private grow(batch: PartBatch): void {
    const capacity = Math.max(this.hint, batch.capacity * 2, batch.demand);
    const source = batch.source;
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, capacity);
    mesh.name = `Batched ${source.name || "part"}`;
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    // Every instance moves every frame, so a bounding volume computed from one
    // fill would cull the whole army the moment it walked out of it. There is
    // nothing to save anyway: at the zoom these matchups are watched from, the
    // army is the picture.
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;

    if (batch.mesh) {
      this.scene.remove(batch.mesh);
      // Frees the instance buffer only. The geometry and material belong to the
      // bodies and to every other batch that shares them.
      batch.mesh.dispose();
    }
    this.scene.add(mesh);
    batch.mesh = mesh;
    batch.matrices = mesh.instanceMatrix.array as Float32Array;
    batch.capacity = capacity;
  }

  private fill(): void {
    for (const batch of this.batches.values()) batch.count = 0;

    for (const parts of this.bodies.values()) {
      for (const part of parts) {
        if (!part.object.visible) continue;
        let shown = true;
        for (const gate of part.gates) {
          if (!gate.visible) {
            shown = false;
            break;
          }
        }
        if (!shown) continue;
        const batch = part.batch;
        part.object.matrixWorld.toArray(batch.matrices, batch.count * 16);
        batch.count += 1;
      }
    }

    for (const batch of this.batches.values()) {
      const mesh = batch.mesh;
      if (!mesh) continue;
      mesh.count = batch.count;
      // An empty batch is skipped before it reaches the draw list rather than
      // after: a part nobody on the field is wearing should not cost even the
      // frustum check.
      mesh.visible = batch.count > 0;
      if (batch.count === 0) continue;
      // Only the slots in use. Flagging the attribute alone would upload the
      // whole capacity every frame, most of it stale padding.
      mesh.instanceMatrix.addUpdateRange(0, batch.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
