import * as THREE from "three";
import { MARS_GRAVITY } from "./balance";
import { ROCK_MATERIAL, createRockGeometry } from "./rigwalker";

/**
 * Pooled, world-space combat effects: sparks struck off the blade, a brief
 * flash at the contact point, and ground rings that telegraph a plan.
 *
 * Everything is preallocated. A busy melee spawns hundreds of particles per
 * second, so the update path must not allocate or touch dead slots.
 */

const MAX_SPARKS = 720;
const MAX_FLASHES = 24;
const MAX_RINGS = 12;
const MAX_TRAILS = 16;
const MAX_ROCKS = 24;
/**
 * How high a thrown rock rides above the straight line to its target. Real
 * ballistics would put every one of these throws nearly flat — they are all
 * thrown far harder than the distance needs — so the arc is drawn from how slow
 * the throw is instead. A hurl streaks; a short toss visibly floats across.
 */
const ROCK_ARC_BASE = 0.35;
const ROCK_ARC_SLOWNESS = 1.6;
/**
 * Fixed reference the loop is measured against, not read from any one throw.
 * The hurl is thrown harder than this, so it sits pinned at the flat base and
 * only the two slower throws loop — which is the whole point of the scale.
 */
const ROCK_REFERENCE_SPEED = 26;
/** Blade samples held in a ribbon; longer smears the arc, shorter tightens it. */
const TRAIL_SAMPLES = 7;
/**
 * Peak brightness of a ribbon's leading edge. Additive over bright Martian
 * ground, a full-strength accent reads as an opaque wedge rather than a smear
 * of light, so the ribbon sits well under 1.
 */
export const TRAIL_BRIGHTNESS = 0.42;
/** How much dimmer the inner edge is than the leading edge. */
const TRAIL_INNER_FALLOFF = 0.22;
const TRAIL_FADE = 0.18;

const SPARK_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPixelsPerUnit;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_PointSize = aSize * uPixelsPerUnit;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SPARK_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    if (radius > 0.5) discard;
    float falloff = smoothstep(0.5, 0.0, radius);
    gl_FragColor = vec4(vColor * falloff, vAlpha * falloff);
  }
`;

type Spark = {
  life: number;
  maxLife: number;
  drag: number;
  velocity: THREE.Vector3;
};

type Flash = {
  life: number;
  maxLife: number;
  scale: number;
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
};

type Ring = {
  life: number;
  maxLife: number;
  radius: number;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
};

type Rock = {
  /** Seconds left in flight; zero when the slot is free. */
  life: number;
  flightTime: number;
  arc: number;
  /** Trailed only when it is fast enough for the streak to mean something. */
  trailed: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
  spin: THREE.Vector3;
  mesh: THREE.Mesh;
};

type Trail = {
  owner: number | null;
  idle: number;
  samples: number;
  positions: Float32Array;
  colors: Float32Array;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh;
};

/**
 * Appends one hilt/tip pair to a ribbon's position buffer and returns the new
 * sample count. Oldest sample stays at index 0; once the ribbon is full the
 * buffer shifts back by one pair. Unfilled slots are padded with the newest
 * pair so a partially built strip has no triangles reaching back to the origin.
 *
 * Extracted from the renderer so the bookkeeping is testable on its own.
 */
export function writeTrailSample(
  positions: Float32Array,
  samples: number,
  hilt: THREE.Vector3,
  tip: THREE.Vector3,
  maxSamples: number = TRAIL_SAMPLES,
): number {
  let nextSamples = samples;
  if (nextSamples >= maxSamples) {
    positions.copyWithin(0, 6);
    nextSamples = maxSamples;
  } else {
    nextSamples += 1;
  }
  const head = (nextSamples - 1) * 6;
  positions[head] = hilt.x;
  positions[head + 1] = hilt.y;
  positions[head + 2] = hilt.z;
  positions[head + 3] = tip.x;
  positions[head + 4] = tip.y;
  positions[head + 5] = tip.z;
  for (let sample = nextSamples; sample < maxSamples; sample += 1) {
    positions.copyWithin(sample * 6, head, head + 6);
  }
  return nextSamples;
}

/**
 * Ramps a ribbon from transparent at the tail to full accent at the newest
 * sample, keeping the hilt edge dimmer than the tip so it reads as a swept
 * edge rather than a flat sheet.
 */
export function writeTrailColors(
  colors: Float32Array,
  tint: THREE.Color,
  maxSamples: number = TRAIL_SAMPLES,
): void {
  for (let sample = 0; sample < maxSamples; sample += 1) {
    const age = maxSamples <= 1 ? 1 : sample / (maxSamples - 1);
    // Squared so the tail drops away quickly and the ribbon reads as a smear
    // trailing the edge rather than a solid sheet behind the whole arc.
    const strength = age * age * TRAIL_BRIGHTNESS;
    const base = sample * 6;
    colors[base] = tint.r * strength * TRAIL_INNER_FALLOFF;
    colors[base + 1] = tint.g * strength * TRAIL_INNER_FALLOFF;
    colors[base + 2] = tint.b * strength * TRAIL_INNER_FALLOFF;
    colors[base + 3] = tint.r * strength;
    colors[base + 4] = tint.g * strength;
    colors[base + 5] = tint.b * strength;
  }
}

const trailTint = new THREE.Color();

function flashTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(
    size / 2, size / 2, 0, size / 2, size / 2, size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,226,160,0.75)");
  gradient.addColorStop(1, "rgba(255,180,90,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Where a rock is at a given point in its flight. Straight line from hand to
 * target, lifted by a parabola that peaks halfway across.
 *
 * Split out from the renderer so the flight can be checked without a scene.
 */
export function rockFlightPoint(
  from: THREE.Vector3,
  to: THREE.Vector3,
  arc: number,
  progress: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const travelled = Math.max(0, Math.min(1, progress));
  out.copy(from).lerp(to, travelled);
  out.y += arc * 4 * travelled * (1 - travelled);
  return out;
}

/** Arc height for a throw: the slower it flies, the more it loops. */
export function rockArcHeight(speed: number): number {
  return ROCK_ARC_BASE + Math.max(0, 1 - speed / ROCK_REFERENCE_SPEED) * ROCK_ARC_SLOWNESS;
}

export class CombatEffects {
  private readonly sparkGeometry = new THREE.BufferGeometry();
  private readonly sparkPositions = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkColors = new Float32Array(MAX_SPARKS * 3);
  private readonly sparkSizes = new Float32Array(MAX_SPARKS);
  private readonly sparkAlphas = new Float32Array(MAX_SPARKS);
  private readonly sparks: Spark[] = [];
  private readonly sparkMaterial: THREE.ShaderMaterial;
  private readonly flashes: Flash[] = [];
  private readonly rings: Ring[] = [];
  private readonly trails: Trail[] = [];
  private readonly rocks: Rock[] = [];
  private readonly rockPoint = new THREE.Vector3();
  private readonly rockTrailTail = new THREE.Vector3();
  private nextSpark = 0;
  private nextFlash = 0;
  private nextRing = 0;
  private nextRock = 0;

  constructor(scene: THREE.Scene) {
    for (let index = 0; index < MAX_SPARKS; index += 1) {
      this.sparks.push({ life: 0, maxLife: 1, drag: 1, velocity: new THREE.Vector3() });
    }
    this.sparkGeometry.setAttribute(
      "position", new THREE.BufferAttribute(this.sparkPositions, 3),
    );
    this.sparkGeometry.setAttribute("aColor", new THREE.BufferAttribute(this.sparkColors, 3));
    this.sparkGeometry.setAttribute("aSize", new THREE.BufferAttribute(this.sparkSizes, 1));
    this.sparkGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.sparkAlphas, 1));
    this.sparkMaterial = new THREE.ShaderMaterial({
      uniforms: { uPixelsPerUnit: { value: 12 } },
      vertexShader: SPARK_VERTEX,
      fragmentShader: SPARK_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(this.sparkGeometry, this.sparkMaterial);
    points.name = "Combat sparks";
    // Positions are rewritten every frame, so a cached bounding sphere would
    // cull the whole system as soon as the first burst moved away from origin.
    points.frustumCulled = false;
    scene.add(points);

    const texture = flashTexture();
    for (let index = 0; index < MAX_FLASHES; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      scene.add(sprite);
      this.flashes.push({ life: 0, maxLife: 1, scale: 1, sprite, material });
    }

    const ringGeometry = new THREE.RingGeometry(0.86, 1, 40);
    for (let index = 0; index < MAX_RINGS; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        opacity: 0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ life: 0, maxLife: 1, radius: 1, mesh, material });
    }

    for (let index = 0; index < MAX_TRAILS; index += 1) {
      const positions = new Float32Array(TRAIL_SAMPLES * 2 * 3);
      const colors = new Float32Array(TRAIL_SAMPLES * 2 * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      // A strip of quads between consecutive hilt/tip pairs.
      const indices: number[] = [];
      for (let segment = 0; segment < TRAIL_SAMPLES - 1; segment += 1) {
        const base = segment * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
      geometry.setIndex(indices);
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      this.trails.push({
        owner: null, idle: 0, samples: 0, positions, colors, geometry, material, mesh,
      });
    }

    // Bigger in the air than in the hand, so it stays legible in flight.
    const rockGeometry = createRockGeometry(0.34, 7);
    for (let index = 0; index < MAX_ROCKS; index += 1) {
      const mesh = new THREE.Mesh(rockGeometry, ROCK_MATERIAL);
      mesh.castShadow = true;
      mesh.visible = false;
      scene.add(mesh);
      this.rocks.push({
        life: 0, flightTime: 1, arc: 0, trailed: false,
        from: new THREE.Vector3(), to: new THREE.Vector3(),
        spin: new THREE.Vector3(), mesh,
      });
    }
  }

  /**
   * Launches a thrown rock. The flight time comes from the director, so the
   * rock arrives on the same frame the strike resolves rather than being timed
   * separately and drifting out of step with its own impact.
   */
  rock(
    from: THREE.Vector3,
    to: THREE.Vector3,
    flightTime: number,
    speed: number,
    trailed: boolean,
  ): void {
    const slot = this.nextRock;
    this.nextRock = (this.nextRock + 1) % MAX_ROCKS;
    const rock = this.rocks[slot];
    rock.flightTime = Math.max(0.05, flightTime);
    rock.life = rock.flightTime;
    rock.arc = rockArcHeight(speed);
    rock.trailed = trailed;
    rock.from.copy(from);
    rock.to.copy(to);
    // Tumble rate scales with the throw: a hurl spins visibly faster than a lob.
    const rate = speed * 0.42;
    rock.spin.set(
      (Math.random() - 0.5) * rate, (Math.random() - 0.5) * rate, (Math.random() - 0.5) * rate,
    );
    rock.mesh.position.copy(from);
    rock.mesh.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    rock.mesh.visible = true;
  }

  /**
   * Feeds one frame of blade position into a unit's ribbon, claiming a slot on
   * first use. Stop calling it and the ribbon fades out and returns to the pool.
   */
  trail(
    owner: number,
    hilt: THREE.Vector3,
    tip: THREE.Vector3,
    color: THREE.ColorRepresentation,
  ): void {
    let trail = this.trails.find((item) => item.owner === owner);
    if (!trail) {
      trail = this.trails.find((item) => item.owner === null);
      if (!trail) return;
      trail.owner = owner;
      trail.samples = 0;
      // The material stays white: the accent rides on the vertex colors, and
      // tinting both would square the channels and darken the ribbon.
    }
    trail.idle = 0;
    trail.material.opacity = 1;
    trail.mesh.visible = true;

    trail.samples = writeTrailSample(trail.positions, trail.samples, hilt, tip);
    writeTrailColors(trail.colors, trailTint.set(color));
    trail.geometry.attributes.position.needsUpdate = true;
    trail.geometry.attributes.color.needsUpdate = true;
  }

  /**
   * Sprays sparks from a contact point. `direction` is the blade's travel, so
   * the shower trails the cut instead of puffing out symmetrically.
   */
  sparkBurst(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    count: number,
    speed: number,
    color: THREE.ColorRepresentation,
    spread = 0.75,
  ): void {
    const tint = new THREE.Color(color);
    for (let index = 0; index < count; index += 1) {
      const slot = this.nextSpark;
      this.nextSpark = (this.nextSpark + 1) % MAX_SPARKS;
      const spark = this.sparks[slot];
      spark.maxLife = 0.22 + Math.random() * 0.34;
      spark.life = spark.maxLife;
      spark.drag = 1.4 + Math.random() * 1.6;
      spark.velocity
        .copy(direction)
        .addScaledVector(
          new THREE.Vector3(
            Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5,
          ).normalize(),
          spread,
        )
        .normalize()
        .multiplyScalar(speed * (0.45 + Math.random() * 0.85));
      spark.velocity.y += speed * 0.28;

      const base = slot * 3;
      this.sparkPositions[base] = position.x;
      this.sparkPositions[base + 1] = position.y;
      this.sparkPositions[base + 2] = position.z;
      const heat = 0.72 + Math.random() * 0.28;
      this.sparkColors[base] = tint.r * heat;
      this.sparkColors[base + 1] = tint.g * heat;
      this.sparkColors[base + 2] = tint.b * heat;
      // World units. At the game's default zoom roughly 26 px cover one unit,
      // which lands sparks in the 4-9 px range: visible at RTS scale without
      // blooming into a smear.
      this.sparkSizes[slot] = 0.15 + Math.random() * 0.2;
      this.sparkAlphas[slot] = 1;
    }
  }

  flash(position: THREE.Vector3, scale: number, color: THREE.ColorRepresentation): void {
    const slot = this.nextFlash;
    this.nextFlash = (this.nextFlash + 1) % MAX_FLASHES;
    const flash = this.flashes[slot];
    flash.maxLife = 0.16;
    flash.life = flash.maxLife;
    flash.scale = scale;
    flash.material.color.set(color);
    flash.sprite.position.copy(position);
    flash.sprite.visible = true;
  }

  /** An expanding ground ring, used to telegraph a plan the player should notice. */
  ring(
    position: THREE.Vector3,
    radius: number,
    color: THREE.ColorRepresentation,
    duration = 0.5,
  ): void {
    const slot = this.nextRing;
    this.nextRing = (this.nextRing + 1) % MAX_RINGS;
    const ring = this.rings[slot];
    ring.maxLife = duration;
    ring.life = duration;
    ring.radius = radius;
    ring.material.color.set(color);
    ring.mesh.position.copy(position);
    ring.mesh.position.y += 0.06;
    ring.mesh.visible = true;
  }

  /** Retires every live particle at once, so a restarted fight starts clean. */
  clear(): void {
    for (let slot = 0; slot < MAX_SPARKS; slot += 1) {
      this.sparks[slot].life = 0;
      this.sparkAlphas[slot] = 0;
    }
    this.sparkGeometry.attributes.aAlpha.needsUpdate = true;
    for (const flash of this.flashes) {
      flash.life = 0;
      flash.sprite.visible = false;
    }
    for (const ring of this.rings) {
      ring.life = 0;
      ring.mesh.visible = false;
    }
    for (const trail of this.trails) {
      trail.owner = null;
      trail.samples = 0;
      trail.mesh.visible = false;
      trail.material.opacity = 0;
    }
    for (const rock of this.rocks) {
      rock.life = 0;
      rock.mesh.visible = false;
    }
  }

  /**
   * `drawingBufferHeight` must be the framebuffer height, not the CSS height:
   * gl_PointSize is in physical pixels, so a device pixel ratio above one would
   * otherwise halve the sparks.
   */
  update(delta: number, camera: THREE.OrthographicCamera, drawingBufferHeight: number): void {
    // Orthographic projection has no perspective divide, so point size in
    // pixels is a fixed world-to-screen ratio that only zoom changes.
    this.sparkMaterial.uniforms.uPixelsPerUnit.value =
      (drawingBufferHeight / (camera.top - camera.bottom)) * camera.zoom;

    let anySpark = false;
    for (let slot = 0; slot < MAX_SPARKS; slot += 1) {
      const spark = this.sparks[slot];
      if (spark.life <= 0) continue;
      anySpark = true;
      spark.life -= delta;
      if (spark.life <= 0) {
        this.sparkAlphas[slot] = 0;
        continue;
      }
      spark.velocity.y -= MARS_GRAVITY * delta;
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * delta));
      const base = slot * 3;
      this.sparkPositions[base] += spark.velocity.x * delta;
      this.sparkPositions[base + 1] += spark.velocity.y * delta;
      this.sparkPositions[base + 2] += spark.velocity.z * delta;
      const remaining = spark.life / spark.maxLife;
      this.sparkAlphas[slot] = remaining * remaining;
    }
    if (anySpark) {
      this.sparkGeometry.attributes.position.needsUpdate = true;
      this.sparkGeometry.attributes.aColor.needsUpdate = true;
      this.sparkGeometry.attributes.aSize.needsUpdate = true;
      this.sparkGeometry.attributes.aAlpha.needsUpdate = true;
    }

    for (const flash of this.flashes) {
      if (flash.life <= 0) continue;
      flash.life -= delta;
      if (flash.life <= 0) {
        flash.sprite.visible = false;
        continue;
      }
      const remaining = flash.life / flash.maxLife;
      flash.material.opacity = remaining;
      flash.sprite.scale.setScalar(flash.scale * (1.35 - remaining * 0.5));
    }

    // Before the trails, so a rock still in the air feeds its streak this frame
    // and one that has landed lets the ribbon start fading immediately.
    for (let slot = 0; slot < this.rocks.length; slot += 1) {
      const rock = this.rocks[slot];
      if (rock.life <= 0) continue;
      rock.life -= delta;
      if (rock.life <= 0) {
        rock.mesh.visible = false;
        continue;
      }
      const progress = 1 - rock.life / rock.flightTime;
      rockFlightPoint(rock.from, rock.to, rock.arc, progress, this.rockPoint);
      rock.mesh.position.copy(this.rockPoint);
      rock.mesh.rotation.x += rock.spin.x * delta;
      rock.mesh.rotation.y += rock.spin.y * delta;
      rock.mesh.rotation.z += rock.spin.z * delta;
      if (rock.trailed) {
        // Owner ids are negative so they can never collide with a unit's.
        rockFlightPoint(
          rock.from, rock.to, rock.arc,
          Math.max(0, progress - 0.06), this.rockTrailTail,
        );
        this.trail(-1 - slot, this.rockTrailTail, this.rockPoint, 0xffb083);
      }
    }

    for (const trail of this.trails) {
      if (trail.owner === null) continue;
      trail.idle += delta;
      if (trail.idle >= TRAIL_FADE) {
        trail.owner = null;
        trail.samples = 0;
        trail.mesh.visible = false;
        trail.material.opacity = 0;
        continue;
      }
      trail.material.opacity = 1 - trail.idle / TRAIL_FADE;
    }

    for (const ring of this.rings) {
      if (ring.life <= 0) continue;
      ring.life -= delta;
      if (ring.life <= 0) {
        ring.mesh.visible = false;
        continue;
      }
      const progress = 1 - ring.life / ring.maxLife;
      ring.material.opacity = (1 - progress) * 0.85;
      ring.mesh.scale.setScalar(ring.radius * (0.35 + progress * 0.9));
    }
  }
}
