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
  private lastWindupAt = -10;
  private rainSrc: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private rainOn = false;
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
    // setRain() may have been called before the first user gesture; catch up
    if (this.rainOn) this.setRain(true);
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

  /** Listener tucked state, pushed by the engine every frame. Rain is ambient
   *  (no position), so it follows the muffle here instead of via playEventAt. */
  setHidden(hidden: boolean): void {
    const m = hidden ? 0.45 : 1;
    if (m === this.hiddenMuffle) return;
    this.hiddenMuffle = m;
    this.applyRainGain();
  }

  /** STORM CELL rain: quiet filtered hiss off the shared noise buffer.
   *  Ambient, unpositioned; the loop nodes live for the session like the wind
   *  and simply fade to silence when the phase leaves the mission. */
  setRain(on: boolean): void {
    this.rainOn = on;
    if (!this.ctx) return; // remembered; built on unlock
    if (on && !this.rainSrc) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1400;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      // slow swell so the hiss breathes like gusts across a roof
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.09;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.008;
      lfo.connect(lfoGain).connect(this.rainGain.gain);
      src.connect(filter).connect(this.rainGain).connect(this.master!);
      src.start();
      lfo.start();
      this.rainSrc = src;
    }
    this.applyRainGain();
  }

  private applyRainGain(): void {
    if (!this.rainGain || !this.ctx) return;
    const target = this.rainOn ? 0.035 * this.hiddenMuffle : 0;
    this.rainGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.8);
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

  grab(pan = 0, vol = 1): void {
    this.tone(300, 0.08 * vol, 0.08, "triangle", 40, pan);
  }

  drop(heavy: boolean, pan = 0, vol = 1): void {
    this.tone(heavy ? 60 : 90, (heavy ? 0.24 : 0.12) * vol, heavy ? 0.3 : 0.16, "sine", 0, pan);
    this.noise((heavy ? 0.16 : 0.08) * vol, 0.14, 500, "lowpass", pan);
  }

  glass(pan = 0): void {
    this.noise(0.2, 0.3, 4200, "highpass", pan);
    this.tone(2400, 0.06, 0.2, "triangle", 0, pan);
    this.tone(3100, 0.04, 0.14, "triangle", 0, pan);
  }

  bell(pan = 0, vol = 1): void {
    this.tone(1760, 0.12 * vol, 0.9, "sine", 0, pan);
    this.tone(2637, 0.05 * vol, 0.6, "sine", 0, pan);
  }

  door(pan = 0): void {
    this.tone(140, 0.07, 0.22, "sawtooth", 14, pan);
    this.noise(0.05, 0.12, 800, "lowpass", pan);
  }

  vanDoor(pan = 0): void {
    this.tone(90, 0.16, 0.4, "sine", 0, pan);
    this.noise(0.1, 0.2, 400, "lowpass", pan);
  }

  /** Cloth rustle: squeezing into or climbing out of a hiding spot. */
  rustle(): void {
    this.noise(0.05, 0.14, 1500, "bandpass");
    setTimeout(() => this.noise(0.035, 0.1, 1900, "bandpass"), 90);
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

  stored(pan = 0, vol = 1): void {
    this.tone(660, 0.09 * vol, 0.2, "triangle", 0, pan);
    setTimeout(() => this.tone(880, 0.09 * vol, 0.3, "triangle", 0, pan), 110);
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

  /** Distant thunder: low non-positional rumble, scheduled 0.6-2.5 s after
   *  the flash so the storm reads far away. Peak stays under the chase
   *  drone's 0.14 ceiling so it can never cover the hunt. */
  thunder(): void {
    if (!this.ctx) return;
    const t = this.now() + 0.6 + Math.random() * 1.9;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true; // 1.2 s buffer; the envelope fades it out before it repeats
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(130, t);
    filter.frequency.exponentialRampToValueAtTime(45, t + 2.4);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.09 * this.hiddenMuffle, t + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + 3);
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

  /** Teammate footstep: the local footstep's gravel scuff plus a soft heel
   *  tap. Deliberately far under the Caretaker's estep presence — the peak
   *  stays at or below half the sting reference, so a full crew walking
   *  together cannot stack over the hunt mix. */
  private pstep(pan: number, vol: number, sprint: boolean): void {
    this.tone(85 + Math.random() * 25, 0.05 * vol, 0.09, "sine", 0, pan);
    this.noise(0.026 * vol, 0.09, sprint ? 900 : 600, "lowpass", pan);
  }

  /** Leash slip: the load is yanked out of a fumbler's hands and thuds down
   *  beside them — a quicker, quieter cousin of the heavy drop. */
  private slip(pan: number, vol: number): void {
    this.tone(72, 0.05 * vol, 0.22, "sine", 0, pan);
    this.noise(0.03 * vol, 0.18, 450, "lowpass", pan);
  }

  /** Busted: a body dragged out of a junker — muffled thump + scrape. */
  private drag(pan: number, vol: number): void {
    this.tone(64, 0.34 * vol, 0.45, "sine", 0, pan);
    this.noise(0.2 * vol, 0.85, 380, "lowpass", pan);
  }

  /** Chase entry: sharp rising sting — it locked onto someone nearby. */
  private spotted(pan: number, vol: number): void {
    if (!this.ctx) return;
    const t = this.now();
    const voice = (f0: number, f1: number, peak: number, attack: number, decay: number): void => {
      const osc = this.ctx!.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + attack);
      const gain = this.ctx!.createGain();
      const panner = this.ctx!.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      osc.connect(gain).connect(panner).connect(this.master!);
      this.env(gain, peak, attack, decay);
      osc.start();
      osc.stop(t + attack + decay + 0.1);
    };
    voice(300, 920, 0.13 * vol, 0.2, 0.35);
    voice(150, 460, 0.1 * vol, 0.18, 0.42);
  }

  /** Lost the trail: a low deflating groan plus a breathy exhale. */
  private lost(pan: number, vol: number): void {
    if (!this.ctx) return;
    const t = this.now();
    // groan sagging downward
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(68, t + 0.55);
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(gain).connect(panner).connect(this.master!);
    this.env(gain, 0.07 * vol, 0.05, 0.7);
    osc.start();
    osc.stop(t + 0.9);
    // breathy exhale: noise through a filter that sags shut
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(280, t + 0.5);
    const ng = this.ctx.createGain();
    const npan = this.ctx.createStereoPanner();
    npan.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(filter).connect(ng).connect(npan).connect(this.master!);
    this.env(ng, 0.05 * vol, 0.06, 0.55);
    src.start();
    src.stop(t + 0.75);
  }

  /** Investigate texture: one faint dry cloth tick (randomized per call). */
  private itick(pan: number, vol: number): void {
    const f = 1600 + Math.random() * 800;
    this.noise(0.022 * vol, 0.05 + Math.random() * 0.04, f, "bandpass", pan);
  }

  /** Windup telegraph: rising tremolo rattle that peaks at the strike. */
  private windup(pan: number, vol: number): void {
    if (!this.ctx) return;
    const t = this.now();
    if (t - this.lastWindupAt < 1.2) return; // cadence-safe: never overlaps a previous windup
    this.lastWindupAt = t;
    const dur = 0.85; // matches the server's WINDUP_TIME
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(105, t);
    osc.frequency.linearRampToValueAtTime(185, t + dur);
    // tremolo tightens (9 -> 17 Hz) and deepens as the strike approaches
    const trem = this.ctx.createOscillator();
    trem.frequency.setValueAtTime(9, t);
    trem.frequency.linearRampToValueAtTime(17, t + dur);
    const tremDepth = this.ctx.createGain();
    tremDepth.gain.setValueAtTime(0, t);
    tremDepth.gain.linearRampToValueAtTime(0.05 * vol, t + dur);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.07 * vol, t + dur);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(gain).connect(panner).connect(this.master!);
    trem.connect(tremDepth).connect(gain.gain);
    osc.start(t);
    trem.start(t);
    osc.stop(t + dur + 0.05);
    trem.stop(t + dur + 0.05);
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

  /** Play a world-positioned event by kind. `sprint` only shades "pstep"
   *  (brighter, faster scuff for a sprinting teammate). */
  playEventAt(kind: string, x: number, z: number, cam: { x: number; z: number; yaw: number }, sprint = false): void {
    const { pan, atten } = this.spatial(x, z, cam);
    if (atten < 0.03) return;
    const vol = atten * this.hiddenMuffle;
    switch (kind) {
      case "drop": this.drop(false, pan, vol); break;
      // two-hand cargo: the server stamps drops with a heavy flag
      case "dropHeavy": this.drop(true, pan, vol); break;
      case "grab": this.grab(pan, vol); break;
      case "slip": this.slip(pan, vol); break;
      case "store": this.stored(pan, vol); break;
      case "pstep": this.pstep(pan, vol, sprint); break;
      case "door": this.door(pan); break;
      case "bell": this.bell(pan, vol); break;
      case "bang": this.bang(pan); break;
      case "horn": this.horn(); break;
      case "bump": this.bump(6); break;
      case "estep": this.estep(pan, vol); break;
      case "clink": this.clink(pan, vol); break;
      case "drag": this.drag(pan, atten); break;
      case "spotted": this.spotted(pan, vol); break;
      case "lost": this.lost(pan, vol); break;
      case "lostYou":
        // the exhale lands on its ex-target: attenuation is floored so it
        // reads personal, yet stays well under the spotted sting's peak
        this.lost(pan, Math.max(atten, 0.65) * this.hiddenMuffle);
        break;
      case "itick": this.itick(pan, vol); break;
      case "windup": this.windup(pan, vol); break;
      default: break;
    }
  }
}

export const audio = new GameAudio();
