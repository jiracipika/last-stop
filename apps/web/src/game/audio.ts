// All audio is synthesized with WebAudio — zero asset downloads.
// Unlocked on the first user gesture (the Play button).
export class GameAudio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private chaseGain: GainNode | null = null;
  private chaseTimer = 0;
  /** Listener is tucked in a junker: world events arrive muffled. */
  hiddenMuffle = 1;
  volume = 0.8;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    // shared noise buffer
    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startAmbient();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private startAmbient(): void {
    const ctx = this.ctx!;
    // wind: filtered noise, slow LFO
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 420;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.045;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(this.windGain.gain);
    wind.connect(windFilter).connect(this.windGain).connect(this.master!);
    wind.start();
    lfo.start();

    // chase layer: dissonant drone, faded in when hunted
    const osc1 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.value = 55;
    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.value = 58.3;
    const chaseFilter = ctx.createBiquadFilter();
    chaseFilter.type = "lowpass";
    chaseFilter.frequency.value = 300;
    this.chaseGain = ctx.createGain();
    this.chaseGain.gain.value = 0;
    osc1.connect(chaseFilter);
    osc2.connect(chaseFilter);
    chaseFilter.connect(this.chaseGain).connect(this.master!);
    osc1.start();
    osc2.start();
  }

  setChaseIntensity(v: number): void {
    if (this.chaseGain) this.chaseGain.gain.value = Math.min(0.14, v * 0.14);
  }

  private now(): number {
    return this.ctx!.currentTime;
  }

  private env(gain: GainNode, peak: number, attack: number, decay: number): void {
    const t = this.now();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noise(peak: number, decay: number, filterFreq: number, type: BiquadFilterType = "lowpass", pan = 0): void {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(filter).connect(gain).connect(panner).connect(this.master!);
    this.env(gain, peak, 0.005, decay);
    src.start();
    src.stop(this.now() + decay + 0.1);
  }

  private tone(freq: number, peak: number, decay: number, type: OscillatorType = "sine", wobble = 0, pan = 0): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    if (wobble > 0) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = wobble;
      const lg = this.ctx.createGain();
      lg.gain.value = freq * 0.06;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start();
      lfo.stop(this.now() + decay + 0.2);
    }
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(gain).connect(panner).connect(this.master!);
    this.env(gain, peak, 0.008, decay);
    osc.start();
    osc.stop(this.now() + decay + 0.1);
  }

  // ---- positional helper: pan and attenuate by camera-relative position ----
  private spatial(x: number, z: number, cam: { x: number; z: number; yaw: number }): { pan: number; atten: number } {
    const dx = x - cam.x;
    const dz = z - cam.z;
    const dist = Math.hypot(dx, dz);
    const atten = 1 / (1 + dist * dist * 0.012);
    // right vector = (cos yaw, -sin yaw)? forward=(sin,cos); right=(cos,-sin)
    const rx = Math.cos(cam.yaw);
    const rz = -Math.sin(cam.yaw);
    const pan = dist > 0.01 ? ((dx * rx + dz * rz) / dist) * 0.8 : 0;
    return { pan, atten };
  }

  footstep(sprint: boolean): void {
    this.noise(sprint ? 0.05 : 0.03, 0.09, sprint ? 900 : 600);
  }

  grab(): void {
    this.tone(300, 0.08, 0.08, "triangle", 40);
  }

  drop(heavy: boolean, pan = 0): void {
    this.tone(heavy ? 60 : 90, heavy ? 0.24 : 0.12, heavy ? 0.3 : 0.16, "sine");
    this.noise(heavy ? 0.16 : 0.08, 0.14, 500, "lowpass", pan);
  }

  glass(pan = 0): void {
    this.noise(0.2, 0.3, 4200, "highpass", pan);
    this.tone(2400, 0.06, 0.2, "triangle", 0, pan);
    this.tone(3100, 0.04, 0.14, "triangle", 0, pan);
  }

  bell(pan = 0): void {
    this.tone(1760, 0.12, 0.9, "sine", 0, pan);
    this.tone(2637, 0.05, 0.6, "sine", 0, pan);
  }

  door(pan = 0): void {
    this.tone(140, 0.07, 0.22, "sawtooth", 14, pan);
    this.noise(0.05, 0.12, 800, "lowpass", pan);
  }

  vanDoor(pan = 0): void {
    this.tone(90, 0.16, 0.4, "sine", 0, pan);
    this.noise(0.1, 0.2, 400, "lowpass", pan);
  }

  horn(): void {
    this.tone(392, 0.3, 0.5, "square");
    this.tone(466, 0.3, 0.5, "square");
  }

  bang(pan = 0): void {
    this.tone(70, 0.35, 0.35, "sine", 0, pan);
    this.noise(0.28, 0.25, 300, "lowpass", pan);
  }

  bump(v: number): void {
    const k = Math.min(1, v / 10);
    this.tone(55, 0.3 * k, 0.4, "sine");
    this.noise(0.2 * k, 0.3, 260);
  }

  hurt(): void {
    this.tone(220, 0.2, 0.25, "sawtooth", 60);
    this.noise(0.12, 0.2, 700);
  }

  down(): void {
    this.tone(180, 0.2, 0.8, "sawtooth", 3);
  }

  revive(): void {
    this.tone(520, 0.1, 0.3, "triangle");
    setTimeout(() => this.tone(780, 0.1, 0.4, "triangle"), 140);
  }

  stored(): void {
    this.tone(660, 0.09, 0.2, "triangle");
    setTimeout(() => this.tone(880, 0.09, 0.3, "triangle"), 110);
  }

  quotaDing(): void {
    this.tone(880, 0.12, 0.5, "sine");
    setTimeout(() => this.tone(1174, 0.12, 0.7, "sine"), 150);
  }

  gate(): void {
    this.tone(48, 0.3, 1.6, "sawtooth", 2);
    this.noise(0.12, 1.4, 220);
  }

  escalate(): void {
    this.tone(110, 0.22, 1.2, "sawtooth", 0.5);
    this.tone(116, 0.22, 1.2, "sawtooth", 0.5);
  }

  sting(): void {
    // enemy spotted you
    this.tone(880, 0.16, 0.5, "sawtooth", 24);
    this.tone(466, 0.16, 0.6, "sawtooth", 18);
  }

  /** Caretaker footstep: heavy slow thud plus gravel scrape. */
  private estep(pan: number, vol: number): void {
    this.tone(50 + Math.random() * 10, 0.32 * vol, 0.3, "sine", 0, pan);
    this.noise(0.13 * vol, 0.24, 260, "lowpass", pan);
  }

  /** Loose metal on the lantern swinging about. */
  private clink(pan: number, vol: number): void {
    const f = 1900 + Math.random() * 600;
    this.tone(f, 0.05 * vol, 0.1, "triangle", 0, pan);
    this.tone(f * 1.62, 0.03 * vol, 0.07, "triangle", 0, pan);
  }

  /** Busted: a body dragged out of a junker — muffled thump + scrape. */
  private drag(pan: number, vol: number): void {
    this.tone(64, 0.34 * vol, 0.45, "sine", 0, pan);
    this.noise(0.2 * vol, 0.85, 380, "lowpass", pan);
  }

  click(): void {
    this.tone(700, 0.04, 0.05, "triangle");
  }

  resultsJingle(win: boolean): void {
    const notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 261];
    notes.forEach((n, i) => setTimeout(() => this.tone(n, 0.12, 0.5, "triangle"), i * 160));
  }

  engineLoop(): void {
    if (!this.ctx || this.engineOsc) return;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 46;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 240;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(filter).connect(this.engineGain).connect(this.master!);
    this.engineOsc.start();
  }

  engine(speed: number, running: boolean): void {
    if (!this.engineOsc || !this.engineGain) return;
    const target = running ? 0.05 + Math.min(0.09, Math.abs(speed) * 0.012) : 0;
    this.engineGain.gain.value += (target - this.engineGain.gain.value) * 0.12;
    this.engineOsc.frequency.value = 42 + Math.abs(speed) * 7;
  }

  heartbeat(dt: number, intensity: number): void {
    if (intensity <= 0) return;
    this.chaseTimer -= dt;
    if (this.chaseTimer <= 0) {
      this.chaseTimer = Math.max(0.45, 1.1 - intensity * 0.5);
      this.tone(58, 0.16 * intensity, 0.16, "sine");
      setTimeout(() => this.tone(52, 0.13 * intensity, 0.14, "sine"), 160);
    }
  }

  /** Play a world-positioned event by kind. */
  playEventAt(kind: string, x: number, z: number, cam: { x: number; z: number; yaw: number }): void {
    const { pan, atten } = this.spatial(x, z, cam);
    if (atten < 0.03) return;
    switch (kind) {
      case "drop": this.drop(false, pan * atten * 2); break;
      case "door": this.door(pan); break;
      case "bell": this.bell(pan); break;
      case "bang": this.bang(pan); break;
      case "horn": this.horn(); break;
      case "bump": this.bump(6); break;
      case "estep": this.estep(pan, atten * this.hiddenMuffle); break;
      case "clink": this.clink(pan, atten * this.hiddenMuffle); break;
      case "drag": this.drag(pan, atten); break;
      default: break;
    }
  }
}

export const audio = new GameAudio();
