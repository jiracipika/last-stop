// Chunky recovery-crew characters with procedural waddle animation.
import * as THREE from "three";
import { COLORS } from "@last-stop/shared";
import type { PlayerState } from "@last-stop/shared";

function nameSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 30px monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(8,10,14,0.65)";
  const w = Math.min(250, ctx.measureText(text).width + 22);
  ctx.fillRect(128 - w / 2, 8, w, 44);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(1.7, 0.42, 1);
  sprite.position.y = 2.15;
  return sprite;
}

export class AvatarView {
  group = new THREE.Group();
  private body: THREE.Mesh;
  private head: THREE.Group;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private flashlight: THREE.SpotLight;
  private flashlightTarget = new THREE.Object3D();
  private name: THREE.Sprite;
  private walkPhase = 0;
  private lastX = 0;
  private lastZ = 0;
  private speed = 0;
  sid: string;

  constructor(sid: string, colorIdx: number, nick: string, hat = 0) {
    this.sid = sid;
    const color = new THREE.Color(COLORS[colorIdx % COLORS.length] ?? "#ffb347");
    const uniform = new THREE.MeshLambertMaterial({ color: 0x3d4652 });
    const suit = new THREE.MeshLambertMaterial({ color });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc9a07a });

    // torso: chunky capsule-ish box
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 3, 8), suit);
    this.body.position.y = 1.0;
    this.group.add(this.body);

    // hi-vis vest: two reflective strips across the jacket
    const strip = new THREE.MeshBasicMaterial({ color: 0xd8d2b8 });
    for (const sx of [-0.12, 0.12]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.03), strip);
      s.position.set(sx, 1.0, 0.31);
      this.group.add(s);
    }

    // oversized jacket collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.18, 8), suit);
    collar.position.y = 1.35;
    this.group.add(collar);

    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), skin);
    this.head.add(skull);
    // headgear: 0 hi-vis cap (default) · 1 hard hat · 2 beanie · 3 headphones · 4 none
    const hatMat = (c: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color: c });
    if (hat === 0) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.14, 8), hatMat(0xe8d24a));
      cap.position.y = 0.2;
      this.head.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.18), hatMat(0xe8d24a));
      brim.position.set(0, 0.15, 0.24);
      this.head.add(brim);
    } else if (hat === 1) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.23, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat(0xC6B99B));
      dome.position.y = 0.13;
      this.head.add(dome);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.035, 12), hatMat(0xC6B99B));
      brim.position.y = 0.14;
      this.head.add(brim);
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.34), hatMat(0xC6B99B));
      ridge.position.y = 0.3;
      this.head.add(ridge);
    } else if (hat === 2) {
      const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat(0x33565a));
      beanie.position.y = 0.11;
      this.head.add(beanie);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.225, 0.09, 10), hatMat(0x2a474a));
      cuff.position.y = 0.1;
      this.head.add(cuff);
    } else if (hat === 3) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.035, 6, 12, Math.PI), hatMat(0x22262c));
      band.rotation.y = Math.PI / 2;
      band.position.y = 0.16;
      this.head.add(band);
      for (const ex of [-0.19, 0.19]) {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 8), hatMat(0x2c3138));
        pad.rotation.z = Math.PI / 2;
        pad.position.set(ex, 0.06, 0);
        this.head.add(pad);
      }
    }
    this.head.position.y = 1.62;
    this.group.add(this.head);

    const armGeo = new THREE.CapsuleGeometry(0.09, 0.42, 2, 6);
    this.armL = new THREE.Mesh(armGeo, suit);
    this.armR = new THREE.Mesh(armGeo, suit);
    this.armL.position.set(-0.44, 1.1, 0);
    this.armR.position.set(0.44, 1.1, 0);
    this.group.add(this.armL, this.armR);

    const legGeo = new THREE.CapsuleGeometry(0.11, 0.4, 2, 6);
    this.legL = new THREE.Mesh(legGeo, uniform);
    this.legR = new THREE.Mesh(legGeo, uniform);
    this.legL.position.set(-0.16, 0.38, 0);
    this.legR.position.set(0.16, 0.38, 0);
    this.group.add(this.legL, this.legR);

    this.name = nameSprite(nick, COLORS[colorIdx % COLORS.length] ?? "#ffb347");
    this.group.add(this.name);

    this.flashlight = new THREE.SpotLight(0xfff2cc, 0, 16, 0.45, 0.5, 1.2);
    this.flashlight.target = this.flashlightTarget;
    this.flashlight.position.set(0.2, 1.5, 0);
    this.group.add(this.flashlight, this.flashlightTarget);
  }

  update(dt: number, p: PlayerState, t: number): void {
    // tucked inside a junker: avatar + nametag vanish (the open door tells the story)
    if (p.hidden) {
      this.group.visible = false;
      this.lastX = p.x;
      this.lastZ = p.z;
      return;
    }
    this.group.visible = true;
    // estimate speed for the waddle
    const dx = p.x - this.lastX;
    const dz = p.z - this.lastZ;
    this.lastX = p.x;
    this.lastZ = p.z;
    const inst = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
    this.speed += (inst - this.speed) * Math.min(1, 8 * dt);

    this.group.position.set(p.x, p.y, p.z);
    this.group.rotation.y = p.yaw;

    if (p.dead) {
      this.group.rotation.x = Math.PI / 2;
      this.group.position.y = 0.35;
      this.name.visible = false;
      return;
    }
    this.group.rotation.x = 0;
    this.name.visible = true;

    if (p.downed) {
      this.group.rotation.x = Math.PI / 2 - 0.15;
      this.group.position.y = 0.4;
    } else if (p.seat > 0) {
      this.group.position.y = 0.25;
      this.group.scale.setScalar(0.92);
    } else {
      this.group.scale.setScalar(1);
    }

    // procedural waddle: legs scissor, torso leans into motion, head bobs
    const moving = this.speed > 0.4 && !p.downed;
    this.walkPhase += dt * (moving ? this.speed * 3.4 : 0);
    const sw = Math.sin(this.walkPhase);
    this.legL.rotation.x = sw * (moving ? 0.7 : 0);
    this.legR.rotation.x = -sw * (moving ? 0.7 : 0);
    this.body.rotation.z = moving ? sw * 0.08 : Math.sin(t * 1.8) * 0.02;
    this.head.rotation.z = moving ? -sw * 0.12 : 0;
    this.head.position.y = 1.62 + (moving ? Math.abs(sw) * 0.05 : 0);

    // arms: forward when carrying, swing otherwise
    if (p.carrying) {
      this.armL.rotation.x = -1.25;
      this.armR.rotation.x = -1.25;
      this.armL.rotation.z = 0.12;
      this.armR.rotation.z = -0.12;
    } else {
      this.armL.rotation.x = -sw * (moving ? 0.55 : 0);
      this.armR.rotation.x = sw * (moving ? 0.55 : 0);
      this.armL.rotation.z = 0;
      this.armR.rotation.z = 0;
    }

    // flashlight
    this.flashlight.intensity = p.flashlight ? 26 : 0;
    this.flashlightTarget.position.set(Math.sin(p.yaw) * 6, 1.4 - p.pitch * 3, Math.cos(p.yaw) * 6);
  }
}
