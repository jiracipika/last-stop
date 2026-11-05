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

  constructor(sid: string, colorIdx: number, nick: string) {
    this.sid = sid;
    const color = new THREE.Color(COLORS[colorIdx % COLORS.length] ?? "#ffb347");
    const uniform = new THREE.MeshLambertMaterial({ color: 0x3d4652 });
    const suit = new THREE.MeshLambertMaterial({ color });
    const skin = new THREE.MeshLambertMaterial({ color: 0xc9a07a });

    // torso: chunky capsule-ish box
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 3, 8), suit);
    this.body.position.y = 1.0;
    this.group.add(this.body);

    // oversized jacket collar
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.18, 8), suit);
    collar.position.y = 1.35;
    this.group.add(collar);

    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), skin);
    this.head.add(skull);
    // hi-vis cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.14, 8), new THREE.MeshLambertMaterial({ color: 0xe8d24a }));
    cap.position.y = 0.2;
    this.head.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.18), new THREE.MeshLambertMaterial({ color: 0xe8d24a }));
    brim.position.set(0, 0.15, 0.24);
    this.head.add(brim);
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
