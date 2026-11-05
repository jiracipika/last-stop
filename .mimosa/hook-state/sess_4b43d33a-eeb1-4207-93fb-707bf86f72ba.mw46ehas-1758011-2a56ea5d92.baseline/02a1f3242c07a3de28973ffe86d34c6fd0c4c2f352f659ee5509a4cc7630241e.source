// Builds the static 3D world from the shared handcrafted map data.
// Everything is procedural low-poly geometry — no external assets.
import * as THREE from "three";
import {
  WALL_BOXES, DOORS, doorAabb, PROPS, ROOMS, LAMPS, ROAD, GATE, MAP_BOUNDS, mulberry32, type DoorDef,
} from "@last-stop/shared";

export interface DoorView {
  def: DoorDef;
  group: THREE.Group;
  open: boolean;
}

export class World3D {
  group = new THREE.Group();
  doorViews: DoorView[] = [];
  gateGroup = new THREE.Group();
  lamps: { light: THREE.PointLight; head: THREE.Mesh }[] = [];
  signMaterial!: THREE.MeshBasicMaterial;

  constructor(blackout: boolean) {
    this.buildGround();
    this.buildWalls();
    this.buildRoomsAndRoofs();
    this.buildDoors();
    this.buildGate();
    this.buildProps();
    this.buildLamps(blackout);
    this.buildSky();
  }

  private mat(color: number, flat = false): THREE.Material {
    return new THREE.MeshLambertMaterial({ color, flatShading: flat });
  }

  private box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  private buildGround(): void {
    // asphalt lot
    const lot = this.box(70, 0.1, 54, this.mat(0x14161a), 0, -0.05, 0);
    this.group.add(lot);
    // escape road
    const road = this.box(ROAD.x1 - ROAD.x0 + 36, 0.1, ROAD.z1 - ROAD.z0 - 0.4, this.mat(0x15171b), ROAD.x0 + (ROAD.x1 - ROAD.x0) / 2 - 18, -0.04, 11);
    this.group.add(road);
    // center dashes on the road
    const dashMat = this.mat(0x8a8358);
    for (let x = -66; x < -30; x += 5) {
      this.group.add(this.box(2.2, 0.02, 0.16, dashMat, x, 0.03, 11));
    }
    // gravel patches (west side yard, around buildings)
    const gravel = this.mat(0x1a1a17);
    this.group.add(this.box(12, 0.06, 26, gravel, -28, 0.0, -8));
    this.group.add(this.box(6, 0.06, 22, gravel, 32, 0.0, -10));
    // parking bumpers
    const bump = this.mat(0x3a3d42);
    for (const [bx, bz] of [[-8, 6], [4, 6], [16, 6], [-8, 17], [4, 17]] as [number, number][]) {
      this.group.add(this.box(2.4, 0.14, 0.5, bump, bx, 0.07, bz));
    }
  }

  private buildWalls(): void {
    const wallMat = this.mat(0x3f3a44);
    const wallDark = this.mat(0x34303a);
    const fenceMat = this.mat(0x2a2c31);
    const railMat = this.mat(0x4a4238);
    for (const w of WALL_BOXES) {
      const { x0, z0, x1, z1 } = w.aabb;
      const width = x1 - x0;
      const depth = z1 - z0;
      const m = this.box(width, w.h, depth, w.kind === "wall" ? (w.h > 3.5 ? wallDark : wallMat) : w.kind === "rail" ? railMat : fenceMat, (x0 + x1) / 2, w.h / 2, (z0 + z1) / 2);
      this.group.add(m);
      // fence posts for flavor
      if (w.kind === "fence") {
        const post = this.mat(0x232529);
        const along = width > depth;
        const len = along ? width : depth;
        for (let d = 0; d < len; d += 4) {
          const px = along ? x0 + d : (x0 + x1) / 2;
          const pz = along ? (z0 + z1) / 2 : z0 + d;
          this.group.add(this.box(0.14, w.h + 0.15, 0.14, post, px, (w.h + 0.15) / 2, pz));
        }
      }
    }
  }

  private buildRoomsAndRoofs(): void {
    // room floors with per-room tint
    const floorMats = [
      this.mat(0x2c2622), this.mat(0x26282c), this.mat(0x2c2a24), this.mat(0x242a26),
      this.mat(0x2a2428), this.mat(0x30302e), this.mat(0x2e2a26), this.mat(0x262c30),
      this.mat(0x2a262e), this.mat(0x232824),
    ];
    ROOMS.forEach((room, i) => {
      const w = room.x1 - room.x0;
      const d = room.z1 - room.z0;
      const f = this.box(w, 0.06, d, floorMats[i % floorMats.length]!, (room.x0 + room.x1) / 2, 0.03, (room.z0 + room.z1) / 2);
      this.group.add(f);
    });
    // walkway floor
    this.group.add(this.box(32, 0.08, 3, this.mat(0x33342f), -6, 0.04, -6.5));
    // roofs: motel + garage with slight overhang
    const roof1 = this.box(33, 0.35, 18, this.mat(0x211f26), -6, 3.35, -16);
    const roof2 = this.box(15.4, 0.4, 17, this.mat(0x1f2126), 23, 4.15, -12);
    this.group.add(roof1, roof2);
    // walkway awning
    this.group.add(this.box(32.6, 0.22, 3.4, this.mat(0x2b2830), -6, 3.05, -6.5));
    for (const px of [-22, -14, -6, 2, 10]) {
      this.group.add(this.box(0.16, 3, 0.16, this.mat(0x35313a), px, 1.5, -7.9));
    }
    // windows on front wall (dark glass, decorative)
    const glass = new THREE.MeshBasicMaterial({ color: 0x101820 });
    for (const wx of [-20, -13, -6, 0.5, 5]) {
      const win = this.box(1.6, 1.1, 0.06, glass, wx, 1.9, -7.82);
      this.group.add(win);
    }
  }

  private buildDoors(): void {
    const doorMat = this.mat(0x4e3d2c);
    for (const def of DOORS) {
      const a = doorAabb(def);
      const width = def.w;
      const g = new THREE.Group();
      const panel = this.box(width - 0.08, 2.15, 0.09, doorMat, (width - 0.08) / 2, 0, 0);
      g.add(panel);
      // handle
      g.add(this.box(0.06, 0.06, 0.16, this.mat(0xb9975a), width - 0.24, 0.05, 0));
      if (def.axis === "x") {
        g.position.set(a.x0, 1.08, def.cz);
        g.rotation.y = 0;
      } else {
        g.position.set(def.cx, 1.08, a.z0);
        g.rotation.y = Math.PI / 2;
      }
      this.group.add(g);
      this.doorViews.push({ def, group: g, open: def.startOpen });
      this.setDoor(this.doorViews.length - 1, def.startOpen, true);
    }
  }

  setDoor(idx: number, open: boolean, instant = false): void {
    const dv = this.doorViews[idx]!;
    dv.open = open;
    const target = open ? -1.9 : 0;
    if (instant) dv.group.rotation.y = (dv.def.axis === "x" ? 0 : Math.PI / 2) + target;
    // animated in update()
    dv.group.userData.targetRot = (dv.def.axis === "x" ? 0 : Math.PI / 2) + target;
  }

  private buildGate(): void {
    const mat = this.mat(0x5a5148);
    const bar = this.box(GATE.z1 - GATE.z0, 0.5, 0.22, mat, 0, 0, 0);
    const bar2 = this.box(GATE.z1 - GATE.z0, 0.5, 0.22, mat, 0, 1.4, 0);
    const top = this.box(GATE.z1 - GATE.z0, 0.3, 0.3, this.mat(0x6a5f52), 0, 3.1, 0);
    for (let z = -(GATE.z1 - GATE.z0) / 2; z <= (GATE.z1 - GATE.z0) / 2; z += 1.4) {
      this.gateGroup.add(this.box(0.12, 3.2, 0.12, this.mat(0x3a3730), 0, 1.6, z));
    }
    this.gateGroup.add(bar, bar2, top);
    this.gateGroup.position.set(GATE.x + 0.4, 0, (GATE.z0 + GATE.z1) / 2);
    this.group.add(this.gateGroup);
    // gate lamps
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xff8844 });
    this.group.add(this.box(0.3, 0.3, 0.3, lampMat, GATE.x + 0.3, 3.4, GATE.z0 - 0.4));
    this.group.add(this.box(0.3, 0.3, 0.3, lampMat, GATE.x + 0.3, 3.4, GATE.z1 + 0.4));
  }

  private buildProps(): void {
    for (const p of PROPS) {
      switch (p.kind) {
        case "vending": {
          this.group.add(this.box(p.w, 1.9, p.d, this.mat(0x8a2f2f), p.x, 0.95, p.z));
          const face = new THREE.MeshBasicMaterial({ color: 0x2a3d55 });
          this.group.add(this.box(p.w - 0.2, 1.2, 0.05, face, p.x, 1.15, p.z + p.d / 2 + 0.03));
          break;
        }
        case "car": {
          this.group.add(this.box(p.w, 0.55, p.d, this.mat(0x37414a), p.x, 0.45, p.z));
          this.group.add(this.box(p.w - 0.7, 0.5, p.d - 1.4, this.mat(0x2c343b), p.x, 0.95, p.z));
          for (const [ox, oz] of [[-1.4, 0.7], [1.4, 0.7], [-1.4, -0.7], [1.4, -0.7]] as [number, number][]) {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 8), this.mat(0x14161a));
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(p.x + ox, 0.3, p.z + oz);
            this.group.add(wheel);
          }
          break;
        }
        case "dumpster":
          this.group.add(this.box(p.w, 1.1, p.d, this.mat(0x2e4a35), p.x, 0.55, p.z));
          this.group.add(this.box(p.w + 0.1, 0.12, p.d + 0.1, this.mat(0x243b2a), p.x, 1.16, p.z));
          break;
        case "boilerTank": {
          const t = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.4, 10), this.mat(0x513f2f));
          t.position.set(p.x, 1.2, p.z);
          this.group.add(t);
          break;
        }
        case "workbench":
          this.group.add(this.box(p.w, 0.12, p.d, this.mat(0x5a4a34), p.x, 0.95, p.z));
          this.group.add(this.box(p.w - 0.4, 0.9, p.d - 0.3, this.mat(0x3a3230), p.x, 0.45, p.z));
          break;
        case "shelf":
          for (const hy of [0.5, 1.1, 1.7]) {
            this.group.add(this.box(p.w, 0.08, p.d, this.mat(0x4a423a), p.x, hy, p.z));
          }
          this.group.add(this.box(0.08, 1.8, 0.08, this.mat(0x3a3430), p.x, 0.9, p.z - p.d / 2 + 0.06));
          this.group.add(this.box(0.08, 1.8, 0.08, this.mat(0x3a3430), p.x, 0.9, p.z + p.d / 2 - 0.06));
          break;
        case "sign": {
          this.group.add(this.box(0.35, 6.5, 0.35, this.mat(0x3a3a40), p.x, 3.25, p.z));
          const canvas = document.createElement("canvas");
          canvas.width = 256;
          canvas.height = 128;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#22151c";
          ctx.fillRect(0, 0, 256, 128);
          ctx.font = "bold 40px monospace";
          ctx.fillStyle = "#ffbe55";
          ctx.fillText("PALE", 20, 52);
          ctx.fillStyle = "#78e8ff";
          ctx.fillText("LANTERN", 14, 100);
          this.signMaterial = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas) });
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), this.signMaterial);
          panel.position.set(p.x, 5.6, p.z + 0.2);
          panel.rotation.y = 0.35;
          this.group.add(panel);
          const back = this.box(3.6, 1.8, 0.15, this.mat(0x2a2228), p.x, 5.6, p.z + 0.1);
          back.rotation.y = 0.35;
          this.group.add(back);
          break;
        }
        case "washer":
          for (const oz of [-0.8, 0, 0.8]) {
            this.group.add(this.box(p.w, 0.9, 0.7, this.mat(0x9aa0a8), p.x, 0.45, p.z + oz));
            const door = new THREE.Mesh(new THREE.CircleGeometry(0.24, 12), new THREE.MeshBasicMaterial({ color: 0x18242e }));
            door.position.set(p.x + p.w / 2 + 0.01, 0.5, p.z + oz);
            door.rotation.y = Math.PI / 2;
            this.group.add(door);
          }
          break;
        case "tires":
          for (let i = 0; i < 3; i++) {
            const tire = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.18, 8, 14), this.mat(0x181a1d));
            tire.rotation.x = Math.PI / 2;
            tire.position.set(p.x + (i % 2) * 0.5, 0.2 + Math.floor(i / 2) * 0.42, p.z);
            this.group.add(tire);
          }
          break;
      }
    }
    // scattered junk for atmosphere (non-colliding)
    const junk = this.mat(0x2c2a26);
    for (const [jx, jz] of [[-16, 9], [8, 18], [-24, 2], [26, 2], [12, -16.8]] as [number, number][]) {
      this.group.add(this.box(0.5, 0.3, 0.4, junk, jx, 0.15, jz));
    }
  }

  private buildLamps(blackout: boolean): void {
    for (const l of LAMPS) {
      this.group.add(this.box(0.16, 4.6, 0.16, this.mat(0x2e3034), l.x, 2.3, l.z));
      const headMat = new THREE.MeshBasicMaterial({ color: blackout ? 0x223038 : 0xffd9a0 });
      const head = this.box(0.6, 0.25, 0.6, headMat, l.x, 4.65, l.z);
      this.group.add(head);
      const light = new THREE.PointLight(0xffc98a, blackout ? 0 : 22, 18, 1.6);
      light.position.set(l.x, 4.4, l.z);
      this.group.add(light);
      this.lamps.push({ light, head });
    }
  }

  private buildSky(): void {
    const starGeo = new THREE.BufferGeometry();
    const positions: number[] = [];
    const rnd = mulberry32(0x5151a);
    for (let i = 0; i < 420; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = Math.acos(rnd() * 0.9);
      const r = 160;
      positions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) + 10, r * Math.sin(phi) * Math.sin(theta));
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfd0e8, size: 0.55, sizeAttenuation: true }));
    this.group.add(stars);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 12), new THREE.MeshBasicMaterial({ color: 0xdfe8f5 }));
    moon.position.set(60, 70, -110);
    this.group.add(moon);
    void MAP_BOUNDS;
  }

  update(dt: number, t: number): void {
    // door swing
    for (const dv of this.doorViews) {
      const target = dv.group.userData.targetRot as number ?? dv.group.rotation.y;
      dv.group.rotation.y += (target - dv.group.rotation.y) * Math.min(1, 10 * dt);
    }
    // sign flicker
    if (this.signMaterial) {
      const flicker = 0.72 + 0.28 * (Math.sin(t * 13) > -0.6 ? 1 : 0.15) * (0.8 + 0.2 * Math.sin(t * 31));
      this.signMaterial.opacity = flicker;
      this.signMaterial.transparent = true;
    }
  }

  setGateOpen(open: boolean): void {
    this.gateGroup.userData.targetX = open ? GATE.x - 8.4 : GATE.x + 0.4;
    if (this.gateGroup.userData.targetX === undefined) this.gateGroup.userData.targetX = GATE.x + 0.4;
  }

  applyGate(dt: number): void {
    const target = this.gateGroup.userData.targetX as number | undefined ?? GATE.x + 0.4;
    this.gateGroup.position.x += (target - this.gateGroup.position.x) * Math.min(1, 2.2 * dt);
  }
}
