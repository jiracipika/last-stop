// The lot's golf cart — the crew's runabout shuttle. Open bench seats, a
// canvas-ish top on posts, and a headlight dot; same low-poly language as the
// van (Lambert + primitive boxes, local frame: +z forward).
import * as THREE from "three";
import { CART } from "@last-stop/shared";

export class CartView {
  group = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private headMat: THREE.MeshBasicMaterial;

  constructor() {
    const body = new THREE.MeshLambertMaterial({ color: 0xd9d267 }); // safety-lemon
    const frame = new THREE.MeshLambertMaterial({ color: 0x3a3d33 });
    const seatMat = new THREE.MeshLambertMaterial({ color: 0x4a4438 });
    const canvasTop = new THREE.MeshLambertMaterial({ color: 0x8f8a76 });

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
    // canvas top on four posts
    box(0.07, 0.9, 0.07, frame, -0.5, 0.95, 0.72);
    box(0.07, 0.9, 0.07, frame, 0.5, 0.95, 0.72);
    box(0.07, 0.9, 0.07, frame, -0.5, 0.95, -0.72);
    box(0.07, 0.9, 0.07, frame, 0.5, 0.95, -0.72);
    box(1.3, 0.07, 2.0, canvasTop, 0, 1.44, 0);
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
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else if (mat) mat.dispose();
    });
  }
}
