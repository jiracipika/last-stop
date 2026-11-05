// The Magpie — the crew's barely-legal recovery van.
import * as THREE from "three";
import { VAN } from "@last-stop/shared";

export class VanView {
  group = new THREE.Group();
  private doorL: THREE.Group;
  private doorR: THREE.Group;
  private headL: THREE.SpotLight;
  private headR: THREE.SpotLight;
  private headMat: THREE.MeshBasicMaterial;
  private tailMat: THREE.MeshBasicMaterial;
  private interiorLight: THREE.PointLight;
  private wheels: THREE.Mesh[] = [];
  private cargoGroup = new THREE.Group();

  constructor() {
    const body = new THREE.MeshLambertMaterial({ color: 0x7a6a4d });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2c30 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x16222e, transparent: true, opacity: 0.85 });

    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      return mesh;
    };

    // main body (local: +z forward)
    box(2.1, 1.5, 4.8, body, 0, 1.05, 0);
    // cab
    box(2.0, 0.75, 1.15, body, 0, 1.85, 1.55);
    // windshield + side windows
    const shield = box(1.7, 0.5, 0.06, glass, 0, 1.9, 2.14);
    shield.rotation.x = 0.22;
    box(0.06, 0.42, 0.9, glass, -1.01, 1.88, 1.5);
    box(0.06, 0.42, 0.9, glass, 1.01, 1.88, 1.5);
    // bumper + grille
    box(2.2, 0.35, 0.25, dark, 0, 0.55, 2.45);
    box(1.4, 0.3, 0.08, dark, 0, 0.95, 2.43);
    box(2.2, 0.35, 0.25, dark, 0, 0.55, -2.45);
    // roof rack
    box(1.7, 0.08, 2.6, dark, 0, 2.45, -0.8);
    // strap rails
    box(0.1, 0.06, 2.2, new THREE.MeshLambertMaterial({ color: 0x8a4a3a }), 0.95, 0.55, -1.0);
    box(0.1, 0.06, 2.2, new THREE.MeshLambertMaterial({ color: 0x8a4a3a }), -0.95, 0.55, -1.0);
    // mud flaps, spare tire on the back
    const spare = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.14, 8, 14), dark);
    spare.position.set(0, 1.1, -2.46);
    this.group.add(spare);

    // wheels
    for (const [wx, wz] of [[-1.0, 1.55], [1.0, 1.55], [-1.0, -1.45], [1.0, -1.45]] as [number, number][]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.42, wz);
      this.group.add(wheel);
      this.wheels.push(wheel);
    }

    // rear doors (hinged at the sides)
    this.doorL = new THREE.Group();
    this.doorR = new THREE.Group();
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x6d5e42 });
    const dl = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.7, 0.08), doorMat);
    dl.position.x = 0.48;
    this.doorL.add(dl);
    const dr = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.7, 0.08), doorMat);
    dr.position.x = -0.48;
    this.doorR.add(dr);
    this.doorL.position.set(-1.02, 1.15, -2.4);
    this.doorR.position.set(1.02, 1.15, -2.4);
    this.group.add(this.doorL, this.doorR);

    // lights
    this.headMat = new THREE.MeshBasicMaterial({ color: 0x2e2a20 });
    box(0.34, 0.2, 0.06, this.headMat, -0.7, 0.95, 2.42);
    box(0.34, 0.2, 0.06, this.headMat, 0.7, 0.95, 2.42);
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x3a1414 });
    box(0.3, 0.18, 0.06, this.tailMat, -0.75, 1.0, -2.44);
    box(0.3, 0.18, 0.06, this.tailMat, 0.75, 1.0, -2.44);

    const headTarget = new THREE.Object3D();
    headTarget.position.set(0, 0.4, 14);
    this.group.add(headTarget);
    this.headL = new THREE.SpotLight(0xffe8b8, 0, 26, 0.5, 0.55, 1.4);
    this.headR = this.headL.clone();
    this.headL.position.set(-0.7, 0.95, 2.5);
    this.headR.position.set(0.7, 0.95, 2.5);
    this.headL.target = headTarget;
    this.headR.target = headTarget;
    this.group.add(this.headL, this.headR);

    this.interiorLight = new THREE.PointLight(0xffc37a, 0, 4.5, 1.8);
    this.interiorLight.position.set(0, 1.6, -1.0);
    this.group.add(this.interiorLight);

    this.group.add(this.cargoGroup);
    void VAN;
  }

  /** Cargo items get little strapped-in boxes inside the bay. */
  syncCargo(count: number, strapped: boolean, t: number): void {
    while (this.cargoGroup.children.length < count) {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.5, 0.55),
        new THREE.MeshLambertMaterial({ color: 0x5c5142 }),
      );
      const i = this.cargoGroup.children.length;
      crate.position.set(((i % 2) - 0.5) * 0.7, 0.6 + Math.floor(i / 2) * 0.1, -1.6 + (i % 2) * 0.5);
      this.cargoGroup.add(crate);
    }
    while (this.cargoGroup.children.length > count) this.cargoGroup.remove(this.cargoGroup.children[0]!);
    this.cargoGroup.visible = count > 0;
    // unsecured cargo jiggles while driving
    const jig = strapped ? 0 : Math.sin(t * 18) * 0.03;
    this.cargoGroup.position.y = Math.abs(this.cargoGroup.position.y * 0) + jig;
  }

  update(x: number, z: number, yaw: number, speed: number, doorsOpen: boolean, lightsOn: boolean, t: number): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
    const doorTarget = doorsOpen ? -1.9 : 0;
    this.doorL.rotation.y += (doorTarget - this.doorL.rotation.y) * 0.15;
    this.doorR.rotation.y += (-doorTarget - this.doorR.rotation.y) * 0.15;
    const lights = lightsOn;
    this.headL.intensity = lights ? 38 : 0;
    this.headR.intensity = lights ? 38 : 0;
    this.headMat.color.setHex(lights ? 0xffeeaa : 0x2e2a20);
    this.tailMat.color.setHex(lights ? 0xff4433 : 0x3a1414);
    this.interiorLight.intensity = doorsOpen ? 7 : 0;
    // wheel spin
    const spin = (speed * t) % (Math.PI * 2);
    for (const w of this.wheels) w.rotation.x = spin;
  }
}
