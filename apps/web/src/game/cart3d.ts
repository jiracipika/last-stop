// The lot's golf cart — the crew's runabout shuttle. Open bench seats, a
// canvas-ish top on posts, and a headlight dot; same low-poly language as the
// van (Lambert + primitive boxes, local frame: +z forward).
import * as THREE from "three";
import { CART } from "@last-stop/shared";
import type { Tex } from "./textures.js";

export class CartView {
  group = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private headMat: THREE.MeshBasicMaterial;
  private plate: THREE.CanvasTexture;

  constructor(tex: Tex, fabric: THREE.Texture) {
    const body = new THREE.MeshLambertMaterial({ map: tex.metalWorn, color: 0xf4cf85 }); // safety-lemon
    const frame = new THREE.MeshLambertMaterial({ color: 0x3a3d33 });
    const seatMat = new THREE.MeshLambertMaterial({ map: fabric, color: 0x71614e });
    const canvasTop = new THREE.MeshLambertMaterial({ map: fabric, color: 0xc9bea4 });

    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      return mesh;
    };

    // floor pan + bumper skirts
    box(1.12, 0.1, 2.2, frame, 0, 0.24, 0);
    box(1.16, 0.16, 0.18, frame, 0, 0.3, 1.12);
    box(1.16, 0.16, 0.18, frame, 0, 0.3, -1.1);
    box(1.15, 0.26, 0.22, body, 0, 0.49, -1.06);
    box(1.18, 0.14, 0.07, frame, 0, 0.36, -1.19);
    // side steps
    box(0.1, 0.06, 1.5, frame, -0.6, 0.22, 0);
    box(0.1, 0.06, 1.5, frame, 0.6, 0.22, 0);
    // cowl + steering column (driver bench is the +z seat)
    box(1.0, 0.34, 0.3, body, 0, 0.52, 0.72);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 6), frame);
    column.position.set(0, 0.72, 0.66);
    column.rotation.x = 0.5;
    this.group.add(column);
    const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 14), frame);
    wheelRing.position.set(0, 0.86, 0.58);
    wheelRing.rotation.x = 1.05;
    this.group.add(wheelRing);
    // benches (both seats face forward)
    for (const s of CART.SEATS) {
      box(0.98, 0.1, 0.62, seatMat, 0, 0.46, s.z);
      box(0.98, 0.44, 0.1, seatMat, 0, 0.7, s.z - 0.3);
    }
    // battery box between the benches
    box(0.7, 0.3, 0.5, frame, 0, 0.42, -0.24);
    // Canvas roof clears the first-person sightline and remote seated hats.
    for (const x of [-0.5, 0.5]) {
      for (const z of [-0.76, 0.76]) box(0.065, 1.54, 0.065, frame, x, 1.25, z);
      box(0.045, 0.08, 2.08, frame, x * 1.27, 2.01, 0);
      box(0.10, 0.19, 1.87, body, x * 1.14, 0.41, 0);
    }
    box(1.31, 0.075, 2.14, canvasTop, 0, 2.045, 0);
    const plate = tex.decal(128, (ctx, size) => {
      ctx.fillStyle = "#d5bb77";
      ctx.fillRect(10, 28, size - 20, 72);
      ctx.fillStyle = "#22272b";
      ctx.textAlign = "center";
      ctx.font = "bold 28px monospace";
      ctx.fillText("LOT", size / 2, 58);
      ctx.fillText("02", size / 2, 88);
    });
    this.plate = plate;
    const fleet = new THREE.MeshBasicMaterial({ map: plate, transparent: true });
    for (const side of [-1, 1]) {
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.33), fleet);
      label.position.set(side * 0.627, 0.50, 0.34);
      label.rotation.y = side * Math.PI / 2;
      this.group.add(label);
    }
    // headlight
    this.headMat = new THREE.MeshBasicMaterial({ color: 0x2e2a20 });
    box(0.22, 0.14, 0.05, this.headMat, 0, 0.56, 1.28);
    // taillight
    const tail = new THREE.MeshBasicMaterial({ color: 0x7a1d1d });
    box(0.16, 0.1, 0.04, tail, 0, 0.5, -1.18);

    // wheels (smaller than the van's, no fenders)
    for (const [wx, wz] of [[-0.62, 0.78], [0.62, 0.78], [-0.62, -0.78], [0.62, -0.78]] as [number, number][]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 10), frame);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.3, wz);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.21, 9), body);
      w.add(hub);
      this.group.add(w);
      this.wheels.push(w);
    }
  }

  update(x: number, z: number, yaw: number, speed: number, dt = 1 / 60): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
    for (const w of this.wheels) w.rotateY((speed * dt) / 0.3);
    // headlight glows while under way (always-on lot cart)
    this.headMat.color.setHex(Math.abs(speed) > 0.2 ? 0xffeeaa : 0x2e2a20);
  }

  dispose(): void {
    this.plate.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else if (mat) mat.dispose();
    });
  }
}
