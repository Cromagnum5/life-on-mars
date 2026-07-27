import * as THREE from "three";
import { CombatAudio } from "./audio";
import {
  CombatDirector,
  isThrow,
  type CombatCue,
  type CombatEvent,
  type CombatFrame,
} from "./combat";
import { CombatEffects } from "./effects";
import type { NavigationObstacle, Rigwalker } from "./rigwalker";

/**
 * One frame of fighting, end to end: plan, present, damage, pose, and clean up
 * the dead. The game and the combat sim both drive this, so anything seen in
 * the sim is the same code path the player gets.
 */

export type BattleContext = {
  camera: THREE.OrthographicCamera;
  /** Where the camera is looking on the ground plane; the audio listener. */
  focus: THREE.Vector3;
  /** Framebuffer height, not CSS height; spark sizing depends on it. */
  drawingBufferHeight: number;
  terrainHeightAt: (x: number, z: number) => number;
  obstacles: readonly NavigationObstacle[];
};

export type BattleFrame = {
  cues: Map<number, CombatCue>;
  events: readonly CombatEvent[];
  /** Damage applied this frame, already dealt to the units. */
  damage: CombatFrame["damage"];
  /** Units defeated this frame, in the order they fell. */
  defeats: readonly Rigwalker[];
};

export type BattleOptions = {
  /** Injected for deterministic sims; defaults to `Math.random`. */
  random?: () => number;
  accentOf?: (corporation: string) => number;
};

const DEFAULT_ACCENT = 0xffb35d;
/**
 * Where along the blade the trail ribbon starts. Trailing the whole blade from
 * the hilt sweeps a wedge as wide as the fighter; starting past the middle
 * leaves a band that follows the edge doing the cutting.
 */
const TRAIL_INNER_EDGE = 0.62;

// Contacts are what the player needs to hear. Swings and releases are
// atmosphere, so they yield to a clang when a crowded frame exceeds the budget.
const EVENT_AUDIO_PRIORITY: Record<CombatEvent["type"], number> = {
  hit: 0, block: 1, glance: 2, riposte: 3, whiff: 4, plan: 5, swing: 6, throw: 7,
};
/** How far past a target a missed rock carries before it hits the dirt. */
const WHIFF_OVERSHOOT = 2.4;


export class BattleRuntime {
  /** Live and recently defeated units. Producers may push directly. */
  readonly units: Rigwalker[] = [];
  readonly effects: CombatEffects;
  readonly audio = new CombatAudio();

  private readonly director: CombatDirector;
  private readonly accentOf: (corporation: string) => number;
  private readonly defeated = new Set<number>();
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3();
  private readonly contactPoint = new THREE.Vector3();
  private readonly bladeDirection = new THREE.Vector3();
  private readonly trailHilt = new THREE.Vector3();
  private readonly trailTip = new THREE.Vector3();
  private readonly deathFlash = new THREE.Vector3();
  private readonly rockOrigin = new THREE.Vector3();
  private readonly rockLanding = new THREE.Vector3();
  private readonly rockLine = new THREE.Vector3();
  /** Dust off a ground strike goes up and out, not along a blade. */
  private readonly dustUp = new THREE.Vector3(0, 1, 0);
  private readonly orderedEvents: CombatEvent[] = [];
  private readonly frameDefeats: Rigwalker[] = [];

  constructor(private readonly scene: THREE.Scene, options: BattleOptions = {}) {
    this.effects = new CombatEffects(scene);
    this.director = new CombatDirector(options.random);
    this.accentOf = options.accentOf ?? (() => DEFAULT_ACCENT);
  }

  /** Adds a unit to the scene and the roster. */
  spawn(unit: Rigwalker): Rigwalker {
    this.scene.add(unit.group);
    this.units.push(unit);
    return unit;
  }

  /**
   * Empties the battlefield and forgets every encounter. The effect pools are
   * reused rather than rebuilt, so restarting a sim allocates nothing.
   */
  reset(): void {
    for (const unit of this.units) unit.group.removeFromParent();
    this.units.length = 0;
    this.defeated.clear();
    this.director.reset();
    this.effects.clear();
  }

  update(delta: number, elapsed: number, context: BattleContext): BattleFrame {
    const { camera } = context;
    this.audio.beginFrame();
    camera.updateMatrixWorld();
    camera.matrixWorld.extractBasis(this.cameraRight, this.cameraUp, this.cameraForward);
    this.audio.setListener(
      context.focus.x, context.focus.z,
      this.cameraRight.x, this.cameraRight.z,
      (camera.top - camera.bottom) / camera.zoom,
    );

    const frame = this.director.update(
      delta,
      this.units.map((unit) => ({
        id: unit.combatId, corporation: unit.corporation, role: unit.role,
        health: unit.health, maxHealth: unit.maxHealth, isAlive: unit.isAlive,
        x: unit.group.position.x, z: unit.group.position.z, profile: unit.combatProfile,
      })),
    );
    const byId = new Map(this.units.map((unit) => [unit.combatId, unit]));
    this.presentEvents(frame.events, byId);
    for (const event of frame.damage) {
      const target = byId.get(event.targetId);
      if (!target) continue;
      // A rock carries a direction and a cut does not. Handing the target the
      // line the rock came in on is what lets a killing throw knock it over
      // backwards instead of toppling it to its own right every time.
      const source = event.thrown ? byId.get(event.sourceId) : undefined;
      const line = source
        ? this.rockLine
          .copy(target.group.position).sub(source.group.position).setY(0)
        : null;
      target.applyCombatDamage(
        event.amount, event.side,
        line && line.lengthSq() > 0.0001 ? line.normalize() : null,
      );
    }

    this.frameDefeats.length = 0;
    for (const unit of this.units) {
      if (unit.isAlive || this.defeated.has(unit.combatId)) continue;
      this.defeated.add(unit.combatId);
      this.frameDefeats.push(unit);
      this.audio.play("defeat", unit.group.position.x, unit.group.position.z, 1);
      this.effects.flash(
        this.deathFlash.copy(unit.group.position).setY(unit.group.position.y + 2.2),
        2.4, 0xff8a4c,
      );
      this.effects.ring(unit.group.position, 3.2, this.accentOf(unit.corporation), 0.9);
    }

    for (const unit of this.units) {
      unit.update(
        delta, elapsed, context.terrainHeightAt, this.units, context.obstacles,
        camera.quaternion, frame.cues.get(unit.combatId),
      );
    }
    // Fed after unit.update so the ribbon samples this frame's pose. A trail
    // that stops being fed fades itself out and releases its pool slot.
    for (const unit of this.units) {
      if (!unit.isSwinging || !unit.sampleBlade(this.trailHilt, this.trailTip)) continue;
      this.trailHilt.lerp(this.trailTip, TRAIL_INNER_EDGE);
      this.effects.trail(
        unit.combatId, this.trailHilt, this.trailTip, this.accentOf(unit.corporation),
      );
    }
    this.effects.update(delta, camera, context.drawingBufferHeight);

    for (let index = this.units.length - 1; index >= 0; index -= 1) {
      const unit = this.units[index];
      if (!unit.canRemove) continue;
      unit.group.removeFromParent();
      this.defeated.delete(unit.combatId);
      this.units.splice(index, 1);
    }

    return {
      cues: frame.cues,
      events: frame.events,
      damage: frame.damage,
      defeats: this.frameDefeats,
    };
  }

  /**
   * Turns the director's discrete events into sparks and sound at the place the
   * blade actually is, so a block reads differently from a landed cut.
   */
  private presentEvents(
    events: readonly CombatEvent[],
    byId: Map<number, Rigwalker>,
  ): void {
    this.orderedEvents.length = 0;
    for (const event of events) this.orderedEvents.push(event);
    this.orderedEvents.sort(
      (left, right) => EVENT_AUDIO_PRIORITY[left.type] - EVENT_AUDIO_PRIORITY[right.type],
    );
    for (const event of this.orderedEvents) {
      const attacker = byId.get(event.attackerId);
      if (!attacker) continue;
      const defender = byId.get(event.defenderId);
      const thrown = isThrow(event.strategy);

      if (event.type === "throw") {
        if (event.projectile && defender) this.launchRock(attacker, defender, event.projectile);
        // A release is the same kind of moment as a swing: atmosphere under the
        // landing, graded by how much of the body went into it.
        this.audio.play(
          "swing", attacker.group.position.x, attacker.group.position.z, event.intensity,
        );
        continue;
      }

      // A cut resolves on the blade; a rock resolves on the body it reaches.
      // Reading the attacker's hand for a landing twelve metres away would put
      // every spark on the wrong fighter.
      if (thrown && defender) {
        defender.getImpactPoint(this.contactPoint);
        this.bladeDirection.copy(this.contactPoint).sub(attacker.group.position)
          .setY(0.5).normalize();
      } else {
        attacker.getContactPoint(this.contactPoint);
        attacker.getBladeVelocity(this.bladeDirection);
        if (this.bladeDirection.lengthSq() < 0.0001) {
          this.bladeDirection.set(0, 0.4, 0);
        }
        this.bladeDirection.normalize();
      }
      // Plans and ripostes are seen and not heard. Both draw a ring, and both
      // were playtested with a tone: announcing a decision as often as fighters
      // make them buries the contacts the sound is meant to punctuate.
      if (event.type !== "plan" && event.type !== "riposte") {
        this.audio.play(event.type, this.contactPoint.x, this.contactPoint.z, event.intensity);
      }

      switch (event.type) {
        case "block":
          // A parry throws the brightest, widest shower: it is the moment most
          // worth noticing, and nothing else in the fight looks like it. A
          // swatted rock bursts instead of sparking, and shatters downward.
          if (thrown) {
            this.effects.sparkBurst(
              this.contactPoint, this.bladeDirection, 22, 5.6 * event.intensity + 1.6,
              0xc79172, 1.25,
            );
            this.effects.flash(this.contactPoint, 0.9, 0xffd2a6);
          } else {
            this.effects.sparkBurst(this.contactPoint, this.bladeDirection, 26, 7.5, 0xdbe7ff, 1.15);
            this.effects.flash(this.contactPoint, 1.5, 0xcfe0ff);
          }
          break;
        case "glance":
          this.effects.sparkBurst(
            this.contactPoint, this.bladeDirection, thrown ? 14 : 12, 5.5,
            thrown ? 0xd8a179 : 0xffcf95, 0.85,
          );
          this.effects.flash(this.contactPoint, 0.85, 0xffc98a);
          break;
        case "hit":
          this.effects.sparkBurst(
            this.contactPoint, this.bladeDirection,
            thrown ? 20 : 18, thrown ? 3.6 * event.intensity + 1.4 : 4.4,
            thrown ? 0xbe8258 : 0xffa060, thrown ? 1.05 : 0.7,
          );
          this.effects.flash(this.contactPoint, thrown ? 1 : 1.25, 0xffb066);
          break;
        case "whiff":
          // A missed rock has to land somewhere, and the puff of dust where it
          // does is the only thing that tells the player it was ever thrown.
          if (thrown && defender) {
            this.landingBeyond(attacker, defender, this.rockLanding);
            this.effects.sparkBurst(
              this.rockLanding, this.dustUp, 14, 2.6, 0x9a6a4c, 1.3,
            );
          }
          break;
        case "riposte":
          // Telegraph the counter under the fighter turning it around.
          this.effects.ring(
            attacker.group.position, 2.1, this.accentOf(attacker.corporation), 0.55,
          );
          break;
        case "plan":
          // The same mark, smaller and quicker: a fighter settling on a plan is
          // worth noticing but must not read as loudly as turning one around.
          this.effects.ring(
            attacker.group.position, 1.35, this.accentOf(attacker.corporation), 0.38,
          );
          break;
      }
    }
  }

  /**
   * Puts a rock in the air. The flight time comes from the director, so it
   * lands on the frame the strike resolves; a miss is aimed past the target so
   * the rock is visibly seen to go wide rather than vanishing on arrival.
   */
  private launchRock(
    attacker: Rigwalker,
    defender: Rigwalker,
    projectile: NonNullable<CombatEvent["projectile"]>,
  ): void {
    attacker.getContactPoint(this.rockOrigin);
    attacker.releaseRock();
    if (projectile.outcome === "whiff") {
      this.landingBeyond(attacker, defender, this.rockLanding);
    } else {
      defender.getImpactPoint(this.rockLanding);
    }
    this.effects.rock(
      this.rockOrigin, this.rockLanding, projectile.flightTime, projectile.speed,
      // Only the hurl is fast enough for a streak to read as speed rather than
      // as a smear following a lob.
      projectile.throwType === "hurl",
    );
  }

  /** Where a rock that missed comes down: past the target, along the throw. */
  private landingBeyond(
    attacker: Rigwalker, defender: Rigwalker, out: THREE.Vector3,
  ): THREE.Vector3 {
    out.copy(defender.group.position).sub(attacker.group.position).setY(0);
    if (out.lengthSq() < 0.0001) out.set(0, 0, 1);
    out.normalize().multiplyScalar(WHIFF_OVERSHOOT).add(defender.group.position);
    out.y = defender.group.position.y + 0.15;
    return out;
  }
}
