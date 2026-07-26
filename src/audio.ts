/**
 * Synthesized combat audio. No sample files and no dependency: every sound is
 * built from oscillators and a noise buffer at call time.
 *
 * Browsers refuse to start an AudioContext before a user gesture, so the whole
 * layer stays silent and cheap until the first click or key press unlocks it.
 */

const MAX_VOICES_PER_FRAME = 5;
const HEARING_RANGE = 46;

type SoundName =
  | "swing" | "block" | "glance" | "hit" | "whiff" | "riposte" | "defeat";

/**
 * Telephone keypad tones. Touch-tone keys are dual frequency: one from the row
 * group and one from the column group, sounded together at equal strength.
 *
 * Nothing on the battlefield plays these. A tone on every plan was too much
 * under fighting, and the ring under the fighter carries that moment on its
 * own. They are kept for interface sounds, where one press per press is the
 * point; reach them through `playKey`. The strategy mapping is kept with them
 * so a menu can stay in the same vocabulary as the fighting.
 */
const DTMF_ROWS = [697, 770, 852, 941] as const;
const DTMF_COLUMNS = [1209, 1336, 1477] as const;

export const STRATEGY_KEYS: Record<string, number> = {
  rush: 1, react: 2, "size-up": 3, feint: 4, "distance-trap": 5, beat: 6, riposte: 7,
};

/** Row and column frequency for keys 1-9 laid out as on a telephone. */
export function keyTones(key: number): [number, number] {
  const index = Math.max(1, Math.min(9, Math.round(key))) - 1;
  return [DTMF_ROWS[Math.floor(index / 3)], DTMF_COLUMNS[index % 3]];
}

type Listener = {
  x: number;
  z: number;
  /** Camera right vector on the ground plane, for screen-relative panning. */
  rightX: number;
  rightZ: number;
  /** World units visible across the viewport, used to scale panning. */
  span: number;
};

export class CombatAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private voicesThisFrame = 0;
  private listener: Listener = { x: 0, z: 0, rightX: 1, rightZ: 0, span: 60 };
  private muted = false;

  /**
   * Attaches one-shot gesture handlers. Calling this before any user
   * interaction is safe; the context is only created once a gesture arrives.
   */
  installUnlockHandlers(target: EventTarget = window): void {
    const unlock = () => {
      this.ensureContext();
      target.removeEventListener("pointerdown", unlock);
      target.removeEventListener("keydown", unlock);
    };
    target.addEventListener("pointerdown", unlock);
    target.addEventListener("keydown", unlock);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.context.currentTime, 0.05);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setListener(
    x: number, z: number, rightX: number, rightZ: number, span: number,
  ): void {
    this.listener = { x, z, rightX, rightZ, span };
  }

  /** Resets the per-frame voice budget. Call once per rendered frame. */
  beginFrame(): void {
    this.voicesThisFrame = 0;
  }

  /** One keypad press, unattenuated and centred. For interface sounds. */
  playKey(key: number, gain = 0.22): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || this.muted) return;
    this.keypad(master, context.currentTime, key, gain);
  }

  play(name: SoundName, x: number, z: number, intensity = 1): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master || this.muted) return;
    if (this.voicesThisFrame >= MAX_VOICES_PER_FRAME) return;

    const distance = Math.hypot(x - this.listener.x, z - this.listener.z);
    if (distance > HEARING_RANGE) return;
    // Rolls off toward silence at the edge of hearing so a large battle does
    // not sum every distant clang into mush.
    const attenuation = Math.max(0, 1 - distance / HEARING_RANGE) ** 1.6;
    if (attenuation < 0.02) return;
    this.voicesThisFrame += 1;

    // Pan along the camera's right vector rather than world X: the view is
    // three-quarter orthographic, so world X alone does not mean screen left.
    const offsetX = x - this.listener.x;
    const offsetZ = z - this.listener.z;
    const screenX = offsetX * this.listener.rightX + offsetZ * this.listener.rightZ;
    const pan = Math.max(-1, Math.min(1, screenX / (this.listener.span / 2)));
    const now = context.currentTime;
    const output = context.createStereoPanner();
    output.pan.value = pan;
    output.connect(master);
    // The source nodes disconnect themselves, but the panner would otherwise
    // stay wired to master for the life of the page.
    window.setTimeout(() => output.disconnect(), 1400);

    const gain = attenuation * Math.max(0.15, intensity);
    switch (name) {
      case "swing":
        this.noise(output, now, { duration: 0.16, gain: gain * 0.28, filter: 1400, sweep: 620 });
        break;
      case "whiff":
        this.noise(output, now, { duration: 0.24, gain: gain * 0.34, filter: 900, sweep: 320 });
        break;
      case "block":
        // Metal on metal: two detuned partials plus a bright noise transient.
        this.tone(output, now, { frequency: 1850, duration: 0.5, gain: gain * 0.3, type: "triangle" });
        this.tone(output, now, { frequency: 2630, duration: 0.42, gain: gain * 0.2, type: "triangle" });
        this.noise(output, now, { duration: 0.09, gain: gain * 0.42, filter: 5200, sweep: -2600 });
        break;
      case "glance":
        this.tone(output, now, { frequency: 1280, duration: 0.22, gain: gain * 0.2, type: "triangle" });
        this.noise(output, now, { duration: 0.13, gain: gain * 0.3, filter: 3200, sweep: -1400 });
        break;
      case "hit":
        // A dull structural thud: low body, short bright edge, no ring.
        this.tone(output, now, { frequency: 168, duration: 0.3, gain: gain * 0.72, type: "sine", drop: 68 });
        this.tone(output, now, { frequency: 96, duration: 0.24, gain: gain * 0.52, type: "square", drop: 40 });
        this.noise(output, now, { duration: 0.11, gain: gain * 0.39, filter: 1700, sweep: -1100 });
        break;
      case "riposte":
        this.tone(output, now, { frequency: 880, duration: 0.3, gain: gain * 0.22, type: "sawtooth", drop: -520 });
        break;
      case "defeat":
        this.tone(output, now, { frequency: 122, duration: 0.85, gain: gain * 0.6, type: "sine", drop: 62 });
        this.noise(output, now, { duration: 0.6, gain: gain * 0.45, filter: 1100, sweep: -820 });
        this.tone(output, now, { frequency: 1500, duration: 0.5, gain: gain * 0.14, type: "triangle" });
        break;
    }
  }

  /**
   * One touch-tone press. Both partials are sine waves at equal gain, which is
   * what makes a keypad tone sound like a keypad tone rather than a chord.
   */
  private keypad(
    destination: AudioNode, now: number, key: number, gain: number,
  ): void {
    const [row, column] = keyTones(key);
    for (const frequency of [row, column]) {
      // Held flat and then released, not decayed from the attack: a keypad
      // press is a steady burst, and a decaying one reads as a game blip.
      this.tone(destination, now, {
        frequency, duration: 0.13, gain, type: "sine", hold: 0.72,
      });
    }
  }

  private ensureContext(): void {
    if (this.context) {
      if (this.context.state === "suspended") void this.context.resume();
      return;
    }
    const Constructor = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return;
    const context = new Constructor();
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : 0.5;
    master.connect(context.destination);
    this.context = context;
    this.master = master;

    const length = Math.floor(context.sampleRate * 0.7);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
  }

  private tone(
    destination: AudioNode,
    now: number,
    options: {
      frequency: number; duration: number; gain: number;
      type: OscillatorType; drop?: number;
      /** Fraction of the duration held at full gain before the release. */
      hold?: number;
    },
  ): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(options.frequency, now);
    if (options.drop) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, options.frequency - options.drop), now + options.duration,
      );
    }
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(options.gain, now + 0.004);
    if (options.hold) {
      envelope.gain.setValueAtTime(options.gain, now + options.duration * options.hold);
    }
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
    oscillator.connect(envelope).connect(destination);
    oscillator.start(now);
    oscillator.stop(now + options.duration + 0.02);
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
    };
  }

  private noise(
    destination: AudioNode,
    now: number,
    options: { duration: number; gain: number; filter: number; sweep: number },
  ): void {
    const context = this.context!;
    if (!this.noiseBuffer) return;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.85 + Math.random() * 0.3;
    const bandpass = context.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.Q.value = 1.1;
    bandpass.frequency.setValueAtTime(options.filter, now);
    bandpass.frequency.exponentialRampToValueAtTime(
      Math.max(80, options.filter + options.sweep), now + options.duration,
    );
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(options.gain, now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);
    source.connect(bandpass).connect(envelope).connect(destination);
    source.start(now);
    source.stop(now + options.duration + 0.02);
    source.onended = () => {
      source.disconnect();
      bandpass.disconnect();
      envelope.disconnect();
    };
  }
}
