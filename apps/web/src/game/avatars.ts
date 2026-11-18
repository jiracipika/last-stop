// Dustpan Recovery crew. These figures use articulated coat, sleeve and boot pieces.
import * as THREE from "three";
import { PLAYER, SEAT } from "@last-stop/shared";
import type { PlayerState } from "@last-stop/shared";
import { crewHex } from "./palette.js";

function nameSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 27px monospace";
  ctx.textAlign = "center";
  const w = Math.min(252, ctx.measureText(text).width + 24);
  ctx.fillStyle = "rgba(8,10,14,0.82)";
  ctx.fillRect(128 - w / 2, 8, w, 44);
  ctx.fillStyle = color;
  ctx.fillRect(128 - w / 2, 8, w, 2);
  ctx.fillText(text, 128, 39, 232);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.65, 0.41, 1);
  sprite.position.y = 2.18;
  return sprite;
}

export type AvatarPose = Pick<PlayerState,
  "x" | "y" | "z" | "yaw" | "pitch" | "hidden" | "dead" | "downed" | "seat" | "carrying" | "carryBody" | "flashlight"
>;

const hatColors = [0xd1a044, 0xd0bf8e, 0x42646c, 0x30343a, 0x54372d];
const skinColors = [0xd7ae89, 0x9e6442, 0xb48066, 0x754b37];

function mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(x, y, z);
  parent.add(part);
  return part;
}

function box(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number): THREE.Mesh {
  return mesh(parent, new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

export class AvatarView {
  readonly group = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms = [new THREE.Group(), new THREE.Group()];
  private readonly legs = [new THREE.Group(), new THREE.Group()];
  private readonly flashlight = new THREE.SpotLight(0xfff2cc, 0, 16, 0.42, 0.5, 1.2);
  private readonly flashlightTarget = new THREE.Object3D();
  private readonly name: THREE.Sprite;
  private walkPhase = 0;
  private lastX = 0;
  private lastZ = 0;
  private speed = 0;

  constructor(readonly sid: string, readonly colorIdx: number, readonly nick: string, readonly hat: number, fabric: THREE.Texture) {
    const suitColor = new THREE.Color(crewHex(colorIdx));
    const cloth = (color: number | THREE.Color) => new THREE.MeshLambertMaterial({ color, map: fabric });
    const suit = cloth(suitColor);
    const pants = cloth(0x414c58);
    const trim = new THREE.MeshLambertMaterial({ color: 0x22282d });
    const skin = new THREE.MeshLambertMaterial({ color: skinColors[colorIdx % skinColors.length] });
    const strip = new THREE.MeshLambertMaterial({ color: 0xe7d4a5, emissive: 0x554930 });
    const hatMat = cloth(hatColors[hat] ?? hatColors[0]!);

    this.body.position.y = 1.03;
    this.group.add(this.body, this.head, ...this.arms, ...this.legs);
    const torso = mesh(this.body, new THREE.CapsuleGeometry(0.30, 0.31, 3, 8), suit, 0, 0.02, 0);
    torso.scale.set(1.07, 1, 0.66);
    mesh(this.body, new THREE.CylinderGeometry(0.23, 0.28, 0.13, 8), trim, 0, 0.37, 0);
    box(this.body, trim, 0, -0.05, 0.20, 0.025, 0.53, 0.025);
    for (const side of [-1, 1]) {
      box(this.body, strip, side * 0.15, 0.02, 0.194, 0.042, 0.5, 0.03).rotation.z = side * 0.2;
      box(this.body, suit, side * 0.15, -0.16, 0.205, 0.13, 0.11, 0.05);
      box(this.body, strip, side * 0.14, 0.06, -0.192, 0.042, 0.43, 0.025);
    }
    box(this.body, trim, -0.16, 0.16, 0.224, 0.13, 0.09, 0.035);
    box(this.body, strip, -0.16, 0.16, 0.245, 0.085, 0.026, 0.01);
    box(this.body, trim, 0, -0.29, -0.015, 0.49, 0.07, 0.36);
    box(this.body, trim, 0.18, -0.27, -0.20, 0.12, 0.24, 0.11);
    box(this.body, trim, 0.18, -0.08, -0.20, 0.018, 0.2, 0.018);

    const face = mesh(this.head, new THREE.SphereGeometry(0.2, 9, 7), skin, 0, 0, 0);
    face.scale.set(0.91, 1.03, 0.86);
    box(this.head, skin, 0, -0.035, 0.166, 0.056, 0.071, 0.058);
    for (const side of [-1, 1]) {
      box(this.head, trim, side * 0.07, 0.03, 0.159, 0.032, 0.034, 0.026);
    }
    if (hat === 0 || hat === 1 || hat === 2 || hat === 4) {
      const radius = hat === 1 ? 0.245 : 0.202;
      mesh(this.head, new THREE.SphereGeometry(radius, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), hatMat, 0, 0.1, -0.015);
      if (hat === 0) box(this.head, hatMat, 0, 0.112, 0.18, 0.31, 0.033, 0.20);
      if (hat === 1) {
        mesh(this.head, new THREE.CylinderGeometry(0.275, 0.275, 0.035, 12), hatMat, 0, 0.11, 0);
        box(this.head, strip, 0, 0.225, 0.183, 0.095, 0.055, 0.03);
      }
      if (hat === 2) mesh(this.head, new THREE.CylinderGeometry(0.208, 0.204, 0.075, 10), hatMat, 0, 0.1, -0.013);
    } else {
      mesh(this.head, new THREE.TorusGeometry(0.211, 0.026, 6, 12, Math.PI), hatMat, 0, 0.025, 0).rotation.y = Math.PI / 2;
      for (const side of [-1, 1]) {
        mesh(this.head, new THREE.CylinderGeometry(0.075, 0.078, 0.065, 8), hatMat, side * 0.186, 0, 0).rotation.z = Math.PI / 2;
      }
    }

    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const arm = this.arms[i]!;
      arm.position.set(side * 0.32, 1.29, 0);
      mesh(arm, new THREE.CapsuleGeometry(0.105, 0.26, 2, 7), suit, side * 0.035, -0.15, 0);
      mesh(arm, new THREE.CylinderGeometry(0.087, 0.083, 0.05, 8), strip, side * 0.035, -0.32, 0);
      box(arm, trim, side * 0.035, -0.39, 0.012, 0.145, 0.15, 0.143);

      const leg = this.legs[i]!;
      leg.position.set(side * 0.145, 0.77, 0);
      mesh(leg, new THREE.CapsuleGeometry(0.105, 0.40, 2, 7), pants, 0, -0.30, 0);
      box(leg, trim, 0, -0.39, 0.079, 0.15, 0.169, 0.076);
      box(leg, trim, 0, -0.665, 0.048, 0.22, 0.205, 0.31);
      box(leg, pants, 0, -0.746, 0.065, 0.222, 0.046, 0.34);
    }

    this.name = nameSprite(nick, crewHex(colorIdx));
    this.flashlight.target = this.flashlightTarget;
    this.flashlight.position.set(-0.19, 1.43, 0.15);
    this.group.add(this.name, this.flashlight, this.flashlightTarget);
  }

  hideBody(): void {
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) o.visible = false;
    });
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) materials.add(mesh.material as THREE.Material);
    });
    geometries.forEach((geo) => geo.dispose());
    materials.forEach((material) => material.dispose());
    this.name.material.map?.dispose();
  }

  update(dt: number, p: AvatarPose, t: number): void {
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    this.group.visible = !p.hidden;
    this.flashlight.intensity = p.flashlight && !p.dead && !p.downed && !p.hidden ? 26 : 0;
    this.flashlightTarget.position.set(-0.19, 1.43 + Math.sin(p.pitch) * 8, 0.15 + Math.cos(p.pitch) * 8);
    if (p.hidden) return;

    const seated = p.seat > 0;
    const fallen = p.dead || p.downed;
    const movingSpeed = moved < 1.3 && !seated && !fallen ? Math.min(PLAYER.SPRINT, moved / Math.max(dt, 1e-3)) : 0;
    this.speed += (movingSpeed - this.speed) * Math.min(1, 8 * dt);
    const moving = this.speed > 0.4 && !seated && !fallen;
    this.walkPhase += moving ? dt * this.speed * 3.2 : 0;
    const stride = moving ? Math.sin(this.walkPhase) : 0;
    this.group.position.set(p.x, fallen ? 0.36 : seated ? (SEAT.isCart(p.seat) ? 0.25 : 0.48) : p.y, p.z);
    this.group.rotation.set(p.dead ? Math.PI / 2 : p.downed ? Math.PI / 2 - 0.15 : 0, p.yaw, 0, "YXZ");
    this.name.visible = !fallen;
    this.body.rotation.z = fallen || seated ? 0 : stride * 0.06 + Math.sin(t * 1.8) * 0.012;
    this.head.position.y = 1.59 + Math.abs(stride) * 0.04 - (seated ? 0.25 : 0);
    this.head.rotation.set(fallen ? 0 : -p.pitch * 0.35, 0, -stride * 0.06);
    this.body.position.y = seated ? 0.86 : 1.03;

    const carrying = !!(p.carrying || p.carryBody);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      this.legs[i]!.position.y = seated ? 0.56 : 0.77;
      this.legs[i]!.rotation.x = seated ? -1.05 : stride * side * 0.66;
      this.arms[i]!.position.y = seated ? 1.10 : 1.29;
      this.arms[i]!.rotation.set(carrying ? -1.23 : seated ? -0.73 : -stride * side * 0.52, 0, carrying ? -side * 0.10 : 0);
    }
  }
}
