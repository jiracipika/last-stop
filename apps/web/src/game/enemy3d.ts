// The Caretaker: tall silhouette, swinging lantern, readable telegraphs.
import * as THREE from "three";

export class EnemyView {
  group = new THREE.Group();
  private coat = new THREE.Group();
  private tails: THREE.Mesh[] = [];
  private legs: THREE.Group[] = [];
  private head: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private lantern: THREE.Group;
  private lanternLight: THREE.PointLight;
  private eyes: THREE.Group;
  private lanternGlass: THREE.MeshBasicMaterial;
  private faceCalm: THREE.MeshBasicMaterial;
  private faceAlert: THREE.MeshBasicMaterial;
  private pool: THREE.Mesh;
  private poolMat: THREE.MeshBasicMaterial;
  private sway = 0;

  constructor(fabric: THREE.Texture) {
    const coatMat = new THREE.MeshLambertMaterial({ color: 0x5c6664, map: fabric });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x282d2e });
    const patchMat = new THREE.MeshLambertMaterial({ color: 0x827354, map: fabric });
    const brass = new THREE.MeshLambertMaterial({ color: 0x916742 });
    const porcelain = new THREE.MeshLambertMaterial({ color: 0xbbb39c, emissive: 0x211c14 });
    const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const part = new THREE.Mesh(geo, mat);
      part.position.set(x, y, z);
      parent.add(part);
      return part;
    };
    const box = (parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) =>
      mesh(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);

    this.coat.position.y = 1.57;
    this.group.add(this.coat);
    const chest = mesh(this.coat, new THREE.CylinderGeometry(0.35, 0.29, 0.85, 7), coatMat, 0, 0.25, 0);
    chest.scale.z = 0.65;
    mesh(this.coat, new THREE.CylinderGeometry(0.26, 0.42, 0.27, 7), trimMat, 0, 0.67, 0).scale.z = 0.73;
    for (const side of [-1, 1]) {
      const tail = mesh(this.coat, new THREE.BoxGeometry(0.32, 0.91, 0.41), coatMat, side * 0.18, -0.51, -0.05);
      tail.rotation.z = side * 0.09;
      this.tails.push(tail);
      box(this.coat, trimMat, side * 0.12, 0.39, 0.235, 0.10, 0.48, 0.035).rotation.z = -side * 0.3;
    }
    box(this.coat, trimMat, 0, -0.02, 0, 0.65, 0.075, 0.47);
    box(this.coat, brass, 0.04, -0.01, 0.245, 0.134, 0.095, 0.035);
    box(this.coat, patchMat, 0.19, -0.42, 0.17, 0.18, 0.24, 0.035).rotation.z = -0.17;
    box(this.coat, brass, -0.18, 0.36, 0.258, 0.12, 0.075, 0.025);

    this.head = new THREE.Group();
    const hood = mesh(this.head, new THREE.SphereGeometry(0.29, 9, 7), trimMat, 0, 0.016, -0.05);
    hood.scale.set(1.07, 1.24, 0.99);
    const mask = mesh(this.head, new THREE.SphereGeometry(0.233, 7, 6), porcelain, 0, -0.02, 0.165);
    mask.scale.set(0.78, 1.17, 0.38);
    box(this.head, trimMat, 0.038, -0.13, 0.247, 0.018, 0.13, 0.019).rotation.z = -0.34;
    box(this.head, trimMat, 0, -0.132, 0.242, 0.12, 0.022, 0.023);
    this.faceCalm = new THREE.MeshBasicMaterial({ color: 0xffd2a0 });
    this.faceAlert = new THREE.MeshBasicMaterial({ color: 0xff5636 });
    this.eyes = new THREE.Group();
    for (const side of [-1, 1]) {
      box(this.head, trimMat, side * 0.077, 0.037, 0.236, 0.093, 0.072, 0.032);
      box(this.eyes, this.faceCalm, side * 0.077, 0.038, 0.257, 0.041, 0.021, 0.013);
    }
    this.head.add(this.eyes);
    this.head.position.set(0, 2.40, 0.035);
    this.group.add(this.head);

    const arm = (side: number) => {
      const joint = new THREE.Group();
      joint.position.set(side * 0.38, 2.01, 0);
      mesh(joint, new THREE.CapsuleGeometry(0.118, 0.53, 2, 7), coatMat, side * 0.055, -0.33, 0);
      box(joint, patchMat, side * 0.055, -0.59, 0, 0.20, 0.09, 0.21);
      box(joint, trimMat, side * 0.055, -0.72, 0.05, 0.144, 0.23, 0.17);
      this.group.add(joint);
      return joint;
    };
    this.armL = arm(-1);
    this.armR = arm(1);
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.155, 1.02, -0.02);
      mesh(leg, new THREE.CapsuleGeometry(0.109, 0.66, 2, 7), trimMat, 0, -0.39, 0);
      box(leg, trimMat, 0, -0.88, 0.08, 0.24, 0.24, 0.37);
      this.legs.push(leg);
      this.group.add(leg);
    }

    // The cage follows the striking hand instead of swinging independently.
    this.lantern = new THREE.Group();
    this.lantern.position.set(0.08, -0.75, 0.14);
    this.armR.add(this.lantern);
    mesh(this.lantern, new THREE.TorusGeometry(0.083, 0.018, 6, 9), brass, 0, -0.055, 0);
    this.lanternGlass = new THREE.MeshBasicMaterial({ color: 0xffcc7e });
    mesh(this.lantern, new THREE.CylinderGeometry(0.093, 0.101, 0.24, 6), this.lanternGlass, 0, -0.235, 0);
    mesh(this.lantern, new THREE.CylinderGeometry(0.10, 0.14, 0.064, 6), brass, 0, -0.094, 0);
    mesh(this.lantern, new THREE.CylinderGeometry(0.13, 0.106, 0.062, 6), brass, 0, -0.374, 0);
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      box(this.lantern, trimMat, Math.sin(angle) * 0.11, -0.23, Math.cos(angle) * 0.11, 0.025, 0.23, 0.025);
    }
    this.lanternLight = new THREE.PointLight(0xffb45e, 16, 12, 1.7);
    this.lanternLight.position.set(0.09, -0.24, 0.12);
    this.lantern.add(this.lanternLight);

    // warm light pool cast on the ground under the lantern (additive decal)
    this.poolMat = new THREE.MeshBasicMaterial({
      map: EnemyView.makePoolTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), this.poolMat); // radius ~3
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.y = 0.02;
    this.group.add(this.pool);
  }

  /** Radial warm gradient for the lantern's ground pool. */
  private static makePoolTexture(): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(128, 128, 6, 128, 128, 128);
    grad.addColorStop(0, "rgba(255,180,94,0.9)");
    grad.addColorStop(0.4, "rgba(255,164,72,0.32)");
    grad.addColorStop(1, "rgba(255,164,72,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }

  update(dt: number, e: { x: number; z: number; yaw: number; ai: number }, t: number): void {
    this.group.position.set(e.x, 0, e.z);
    this.group.rotation.y = e.yaw;

    const speedLike = e.ai === 2 ? 1 : e.ai === 1 ? 0.55 : e.ai === 3 || e.ai === 5 ? 0.1 : 0.3;
    this.sway += dt * (2.2 + speedLike * 4);
    const sw = Math.sin(this.sway);

    // lurching walk
    this.coat.rotation.z = sw * 0.07 * speedLike;
    this.tails.forEach((tail, i) => { tail.rotation.x = (i === 0 ? sw : -sw) * 0.14 * speedLike; });
    this.legs.forEach((leg, i) => { leg.rotation.x = (i === 0 ? sw : -sw) * 0.54 * speedLike; });
    this.group.position.y = Math.abs(sw) * 0.05 * speedLike;
    this.armL.rotation.x = -sw * 0.4 * speedLike;
    this.armR.rotation.x = sw * 0.4 * speedLike;

    // lantern swings and dims/brightens with intent
    this.lantern.rotation.z = sw * 0.35;
    const flare = e.ai === 3 ? 2.4 : e.ai === 2 ? 1.5 : 1;
    this.lanternLight.intensity = (12 + Math.sin(t * 5) * 2) * flare;
    this.eyes.scale.y = e.ai === 3 ? 1.65 : 1;
    this.eyes.children.forEach((eye) => { (eye as THREE.Mesh).material = e.ai === 3 ? this.faceAlert : this.faceCalm; });
    this.lanternGlass.color.setHex(e.ai === 3 ? 0xff854b : 0xffcc7e);

    // ground pool tracks the same flare; forcing a door strobes with the pounding
    let poolOp = 0.3 * flare;
    if (e.ai === 5) poolOp *= 0.45 + 0.55 * Math.abs(Math.sin(t * 12));
    this.poolMat.opacity = Math.min(1, poolOp);
    // pin the decal to the floor while the body bobs
    this.pool.position.y = 0.02 - this.group.position.y;

    this.coat.rotation.x = 0;
    this.head.rotation.z = 0;
    // windup telegraph: arms rise, head tracks
    if (e.ai === 3) {
      this.armL.rotation.x = -2.4;
      this.armR.rotation.x = -2.4;
      this.head.rotation.z = Math.sin(t * 30) * 0.06;
    } else if (e.ai === 4) {
      // recover: slouch
      this.coat.rotation.x = 0.25;
    } else {
      this.coat.rotation.x = 0;
    }

    // forcing a door: pounding animation
    if (e.ai === 5) {
      const pound = Math.sin(t * 12);
      this.armR.rotation.x = -1.6 + pound * 0.5;
    }
  }

  dispose(): void {
    const materials = new Set<THREE.Material>([this.faceCalm, this.faceAlert]);
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) materials.add(mesh.material as THREE.Material);
    });
    materials.forEach((mat) => mat.dispose());
    this.poolMat.map?.dispose();
  }
}
