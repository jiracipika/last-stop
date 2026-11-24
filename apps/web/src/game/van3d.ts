// The Magpie — the crew's barely-legal recovery van. Warm anchor of the lot:
// cream-and-teal livery, amber beacon, tungsten interior glow.
import * as THREE from "three";
import { VAN } from "@last-stop/shared";
import { PAL, type Tex } from "./textures.js";

export class VanView {
  group = new THREE.Group();
  private doorL: THREE.Group;
  private doorR: THREE.Group;
  private cabDoors: { hinge: THREE.Group; side: number; remaining: number }[] = [];
  private borrowedPaint: THREE.Texture;
  private headL: THREE.SpotLight;
  private headR: THREE.SpotLight;
  private headMat: THREE.MeshBasicMaterial;
  private tailMat: THREE.MeshBasicMaterial;
  private beaconMat: THREE.MeshBasicMaterial;
  private interiorLight: THREE.PointLight;
  private cabLight: THREE.PointLight;
  private pools: THREE.Mesh[] = [];
  private wheels: THREE.Mesh[] = [];
  private cargoGroup = new THREE.Group();

  constructor(tex: Tex) {
    this.borrowedPaint = tex.vanPaint;
    const paint = new THREE.MeshLambertMaterial({ map: tex.vanPaint });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2c30 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x16222e, transparent: true, opacity: 0.24, depthWrite: false });

    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      return mesh;
    };

    // main body (local: +z forward)
    // Build a shell: opening the rear doors must reveal the cargo bay.
    box(2.1, 0.18, 4.8, dark, 0, 0.4, 0);
    box(0.1, 1.75, 3.25, paint, -1, 1.35, -0.775);
    box(0.1, 1.75, 3.25, paint, 1, 1.35, -0.775);
    box(2.1, 0.12, 4.4, paint, 0, 2.25, -0.2);
    box(2.0, 0.85, 1.45, paint, 0, 0.9, 1.675);
    // Door skins, window frames and inner trim all move with the hinge.
    const cabHandle = new THREE.MeshLambertMaterial({ color: 0xc9b18c });
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.name = side < 0 ? "cab-door-driver" : "cab-door-passenger";
      hinge.position.set(side * 1.0, 0, 2.14);
      hinge.add(box(0.1, 0.7, 1.29, paint, 0, 1.15, -0.64));
      hinge.add(box(0.058, 0.42, 0.94, glass, 0, 1.88, -0.65));
      hinge.add(box(0.06, 0.045, 0.12, cabHandle, side * 0.066, 1.42, -1.07));
      hinge.add(box(0.058, 0.05, 1.03, dark, 0, 1.64, -0.66));
      hinge.add(box(0.055, 0.045, 1.03, dark, 0, 2.10, -0.66));
      for (const edge of [-0.16, -1.16]) hinge.add(box(0.055, 0.50, 0.045, dark, 0, 1.87, edge));
      hinge.add(box(0.045, 0.29, 1.16, dark, -side * 0.065, 1.27, -0.63));
      hinge.add(box(0.085, 0.045, 0.34, cabHandle, -side * 0.09, 1.39, -0.69));
      this.cabDoors.push({ hinge, side, remaining: 0 });
      this.group.add(hinge);
    }
    const vinyl = new THREE.MeshLambertMaterial({ color: 0x765842, emissive: 0x18100b });
    const seam = new THREE.MeshLambertMaterial({ color: 0xb18c62 });
    for (const [i, seat] of VAN.SEATS.entries()) {
      box(0.42, 0.20, 0.38, dark, seat.x, 0.70, seat.z);
      box(0.54, 0.15, 0.48, vinyl, seat.x, 0.86, seat.z);
      box(0.54, 0.49, 0.12, vinyl, seat.x, 1.13, seat.z - 0.24);
      box(0.45, 0.025, 0.035, seam, seat.x, 0.94, seat.z + 0.18);
      if (i < 2) box(0.26, 0.17, 0.13, vinyl, seat.x, 1.44, seat.z - 0.26);
    }

    const dash = new THREE.MeshLambertMaterial({ color: 0x3e4440, emissive: 0x111410 });
    const chrome = new THREE.MeshLambertMaterial({ color: 0xb4a587, emissive: 0x1d160e });
    const gauges = new THREE.MeshBasicMaterial({ color: 0xc9a66c });
    const driverX = VAN.SEATS[0].x;
    box(1.84, 0.21, 0.30, dash, 0, 1.43, 2.00);
    box(0.54, 0.12, 0.16, dark, driverX, 1.58, 1.94);
    for (const dx of [-0.14, 0.01, 0.15]) {
      const dial = new THREE.Mesh(new THREE.CircleGeometry(dx === 0.01 ? 0.043 : 0.032, 12), gauges);
      dial.position.set(driverX + dx, 1.58, 1.858);
      dial.rotation.y = Math.PI;
      this.group.add(dial);
    }
    box(0.08, 0.08, 0.32, dark, driverX, 1.36, 1.65);
    const wheel = new THREE.Group();
    wheel.name = "van-steering-wheel";
    wheel.position.set(driverX, 1.44, 1.59);
    wheel.rotation.x = -0.42;
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.033, 8, 24), vinyl));
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.045), chrome);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.06), dark);
    wheel.add(spoke, hub);
    this.group.add(wheel);

    box(0.23, 0.34, 0.48, dash, 0, 0.93, 1.45);
    box(0.15, 0.05, 0.15, dark, 0, 1.13, 1.52);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.025, 0.17, 8), chrome);
    lever.position.set(0, 1.23, 1.52);
    this.group.add(lever);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), vinyl);
    knob.name = "van-shift-knob";
    knob.position.set(0, 1.33, 1.52);
    this.group.add(knob);
    // cab
    for (const side of [-1, 1]) box(0.1, 0.65, 0.1, paint, side, 1.88, 2.1);
    box(2.0, 0.1, 1.15, paint, 0, 2.22, 1.55);
    // windshield + side windows
    const shield = box(1.7, 0.5, 0.06, glass, 0, 1.9, 2.14);
    shield.rotation.x = 0.22;
    const bumperTrim = new THREE.MeshLambertMaterial({ color: 0xb8b9a8 });
    for (let i = 0; i < 4; i++) box(1.06, 0.025, 0.035, bumperTrim, 0, 0.85 + i * 0.067, 2.49);
    // bumper + grille
    box(2.2, 0.35, 0.25, dark, 0, 0.55, 2.45);
    box(1.4, 0.3, 0.08, dark, 0, 0.95, 2.43);
    box(2.2, 0.35, 0.25, dark, 0, 0.55, -2.45);
    // roof rack
    box(1.7, 0.08, 2.6, dark, 0, 2.45, -0.8);
    // Side mirrors and tie-down rails make the silhouette readable from the lot.
    for (const side of [-1, 1]) {
      box(0.25, 0.035, 0.05, dark, side * 1.04, 1.69, 2.04);
      box(0.13, 0.24, 0.08, dark, side * 1.20, 1.75, 2.04);
      box(0.096, 0.197, 0.012, bumperTrim, side * 1.20, 1.75, 1.992);
    }
    // strap rails
    box(0.1, 0.06, 2.2, new THREE.MeshLambertMaterial({ color: 0x8a4a3a }), 0.95, 0.55, -1.0);
    box(0.1, 0.06, 2.2, new THREE.MeshLambertMaterial({ color: 0x8a4a3a }), -0.95, 0.55, -1.0);
    // spare tire on the back
    const spare = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.14, 8, 14), dark);
    spare.position.set(0, 1.1, -2.46);


    // livery: DUSTPAN RECOVERY CO. on both flanks + rear
    const liveryTex = tex.decal(512, (ctx, sz) => {
      ctx.clearRect(0, 0, sz, sz);
      ctx.fillStyle = "#d8d2c0";
      ctx.font = "bold 54px monospace";
      ctx.textAlign = "center";
      ctx.fillText("DUSTPAN", sz / 2, sz * 0.4);
      ctx.fillText("RECOVERY", sz / 2, sz * 0.56);
      ctx.font = "bold 26px monospace";
      ctx.fillStyle = PAL.tungsten;
      ctx.fillText("WE TOW REGRETS", sz / 2, sz * 0.74);
    });
    const liveryMat = new THREE.MeshBasicMaterial({ map: liveryTex, transparent: true });
    for (const side of [1, -1]) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), liveryMat);
      decal.position.set(side * 1.06, 1.15, -0.7);
      decal.rotation.y = side * Math.PI / 2;
      this.group.add(decal);
    }

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
    const doorMat = new THREE.MeshLambertMaterial({ map: tex.vanPaint, color: 0xcfc4a8 });
    const dl = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.7, 0.08), doorMat);
    dl.position.x = 0.505;
    this.doorL.add(dl);
    const dr = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.7, 0.08), doorMat);
    dr.position.x = -0.505;
    this.doorR.add(dr);
    this.doorL.position.set(-VAN.REAR_HINGE.x, 1.15, VAN.REAR_HINGE.z);
    this.doorR.position.set(VAN.REAR_HINGE.x, 1.15, VAN.REAR_HINGE.z);
    this.doorL.name = "rear-door-left";
    this.doorR.name = "rear-door-right";
    spare.position.set(-0.48, -0.05, -0.12);
    this.doorR.add(spare);
    const handleMat = new THREE.MeshLambertMaterial({ color: 0x252b2e });
    for (const [door, sign] of [[this.doorL, 1], [this.doorR, -1]] as const) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.1), handleMat);
      handle.position.set(sign * VAN.REAR_HANDLE_OFFSET, 0, -0.08);
      door.add(handle);
    }
    this.group.add(this.doorL, this.doorR);

    // amber roof beacon
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0x4a3418 });
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.16, 8), this.beaconMat);
    beacon.position.set(0, 2.56, 0.9);
    this.group.add(beacon);

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

    // headlight pools on the asphalt ahead (additive, local frame)
    const poolTex = tex.decal(256, (ctx, sz) => {
      const g = ctx.createRadialGradient(sz / 2, sz / 2, 4, sz / 2, sz / 2, sz / 2);
      g.addColorStop(0, "rgba(255,232,180,0.55)");
      g.addColorStop(0.6, "rgba(255,224,168,0.18)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, sz, sz);
    });
    for (const px of [-0.75, 0.75]) {
      const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 6.5),
        new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(px, 0.02, 6.2);
      this.group.add(pool);
      this.pools.push(pool);
    }

    this.interiorLight = new THREE.PointLight(0xffc37a, 0, 4.5, 1.8);
    this.interiorLight.position.set(0, 1.6, -1.0);
    this.group.add(this.interiorLight);
    this.cabLight = new THREE.PointLight(0xffc68d, 2, 2.6);
    this.cabLight.position.set(0, 2.08, 1.15);
    this.group.add(this.cabLight);

    this.group.add(this.cargoGroup);
  }

  /** Cargo items get little strapped-in boxes inside the bay. */
  syncCargo(count: number, strapped: boolean, t: number, speed = 0): void {
    while (this.cargoGroup.children.length < count) {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.5, 0.55),
        new THREE.MeshLambertMaterial({ color: 0x5c5142 }),
      );
      const i = this.cargoGroup.children.length;
      crate.position.set(((i % 2) - 0.5) * 0.7, 0.6 + Math.floor(i / 2) * 0.1, -1.6 + (i % 2) * 0.5);
      this.cargoGroup.add(crate);
    }
    while (this.cargoGroup.children.length > count) {
      const crate = this.cargoGroup.children[0] as THREE.Mesh;
      this.cargoGroup.remove(crate);
      crate.geometry.dispose();
      (crate.material as THREE.Material).dispose();
    }
    this.cargoGroup.visible = count > 0;
    // unsecured cargo jiggles while driving
    const jig = strapped || Math.abs(speed) < 0.1 ? 0 : Math.sin(t * 18) * 0.03;
    this.cargoGroup.position.y = jig;
  }

  swingCabDoor(side: number): void {
    const door = this.cabDoors.find((d) => d.side === side);
    if (door) door.remaining = 0.85;
  }

  update(x: number, z: number, yaw: number, speed: number, doorsOpen: boolean, lightsOn: boolean, t: number, dt = 1 / 60, seated = false): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
    const doorTarget = doorsOpen ? VAN.REAR_SWING : 0;
    const ease = 1 - Math.exp(-10 * dt);
    this.doorL.rotation.y += (doorTarget - this.doorL.rotation.y) * ease;
    this.doorR.rotation.y += (-doorTarget - this.doorR.rotation.y) * ease;
    for (const door of this.cabDoors) {
      door.remaining = Math.max(0, door.remaining - dt);
      const angle = Math.abs(speed) > 1.5 || door.remaining <= 0 ? 0 : -door.side * 1.15;
      door.hinge.rotation.y += (angle - door.hinge.rotation.y) * ease;
    }
    const lights = lightsOn;
    this.headL.intensity = lights ? 38 : 0;
    this.headR.intensity = lights ? 38 : 0;
    this.headMat.color.setHex(lights ? 0xffeeaa : 0x2e2a20);
    this.tailMat.color.setHex(lights ? 0xff4433 : 0x3a1414);
    this.interiorLight.intensity += ((doorsOpen ? 8 : 0) - this.interiorLight.intensity) * ease;
    const cabOpen = this.cabDoors.some((door) => Math.abs(door.hinge.rotation.y) > 0.1);
    this.cabLight.intensity += ((seated || cabOpen ? 3.5 : 0.6) - this.cabLight.intensity) * ease;
    for (const p of this.pools) p.visible = lights;
    this.beaconMat.color.set(lights ? PAL.tungsten : "#4a3418");
    // wheel spin
    for (const w of this.wheels) w.rotateY(speed * dt / 0.42);
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else if (mat) {
        const anyMat = mat as THREE.Material & { map?: THREE.Texture };
        if (anyMat.map && anyMat.map !== this.borrowedPaint) anyMat.map.dispose();
        mat.dispose();
      }
    });
  }
}
