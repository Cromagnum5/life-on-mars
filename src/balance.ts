export const MARS_GRAVITY = 3.71;

export type BalanceInput = {
  delta: number;
  localVelocityX: number;
  localVelocityZ: number;
  impactX?: number;
  impactZ?: number;
  combatLoadX?: number;
  combatLoadZ?: number;
};

export type BalancePose = {
  leanX: number;
  leanZ: number;
  stance: number;
  crouch: number;
  step: number;
  stepSide: -1 | 0 | 1;
};

/** A testable inverted-pendulum controller, independent of rendering. */
export class BalanceController {
  private velocityX = 0;
  private velocityZ = 0;
  private leanX = 0;
  private leanZ = 0;
  private leanVelocityX = 0;
  private leanVelocityZ = 0;
  private disturbanceX = 0;
  private disturbanceZ = 0;
  private stepTime = 0;
  private stepSide: -1 | 0 | 1 = 0;

  update(input: BalanceInput): BalancePose {
    const delta = Math.min(Math.max(input.delta, 0), 1 / 20);
    if (delta === 0) return this.pose();
    const accelerationX = (input.localVelocityX - this.velocityX) / delta;
    const accelerationZ = (input.localVelocityZ - this.velocityZ) / delta;
    this.velocityX = input.localVelocityX;
    this.velocityZ = input.localVelocityZ;
    this.disturbanceX += input.impactX ?? 0;
    this.disturbanceZ += input.impactZ ?? 0;

    // Mars' lower gravity produces slower corrections and needs more body
    // displacement to oppose a given acceleration than Earth gravity would.
    const targetX = clamp(
      accelerationX / MARS_GRAVITY * 0.12 + (input.combatLoadX ?? 0) + this.disturbanceX,
      -0.34, 0.34,
    );
    const targetZ = clamp(
      -accelerationZ / MARS_GRAVITY * 0.1 + (input.combatLoadZ ?? 0) + this.disturbanceZ,
      -0.3, 0.3,
    );
    const spring = 23;
    const damping = 8.2;
    this.leanVelocityX += ((targetX - this.leanX) * spring - this.leanVelocityX * damping) * delta;
    this.leanVelocityZ += ((targetZ - this.leanZ) * spring - this.leanVelocityZ * damping) * delta;
    this.leanX += this.leanVelocityX * delta;
    this.leanZ += this.leanVelocityZ * delta;

    const instability = Math.hypot(
      this.leanX + this.disturbanceX * 0.45,
      this.leanZ + this.disturbanceZ * 0.45,
    );
    if (this.stepTime <= 0 && instability > 0.115) {
      this.stepTime = 0.62;
      this.stepSide = this.leanX >= 0 ? 1 : -1;
    }
    if (this.stepTime > 0) {
      this.stepTime = Math.max(0, this.stepTime - delta);
      if (this.stepTime === 0) {
        this.leanVelocityX *= 0.35;
        this.leanVelocityZ *= 0.5;
        this.disturbanceX *= 0.22;
        this.disturbanceZ *= 0.3;
        this.stepSide = 0;
      }
    }
    const decay = Math.exp(-3.1 * delta);
    this.disturbanceX *= decay;
    this.disturbanceZ *= decay;
    return this.pose();
  }

  private pose(): BalancePose {
    const instability = Math.min(1, Math.hypot(this.leanX, this.leanZ) / 0.24);
    const stepProgress = this.stepTime > 0 ? 1 - this.stepTime / 0.62 : 0;
    return {
      leanX: this.leanX,
      leanZ: this.leanZ,
      stance: 0.035 + instability * 0.16,
      crouch: instability * 0.13,
      step: this.stepTime > 0 ? Math.sin(stepProgress * Math.PI) : 0,
      stepSide: this.stepSide,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
