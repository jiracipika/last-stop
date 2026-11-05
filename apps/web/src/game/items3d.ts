// Item meshes generated from catalog defs; damage shows as darkening.
import * as THREE from "three";
import { ITEM_DEFS, WRECKED_AT, type ItemState } from "@last-stop/shared";

export class ItemView {
  group = new THREE.Group();
  id: string;
  defId: string;
  private highlight: THREE.Mesh;
  private inner: THREE.Group;

  constructor(id: string, defId: string) {
    this.id = id;
    this.defId = defId;
    const def = ITEM_DEFS[defId]!;
    const base = new THREE.Color(def.color);
    const mat = new THREE.MeshLambertMaterial({ color: base });
    const dark = new THREE.MeshLambertMaterial({ color: 0x23262b });
    const glass = new THREE.MeshLambertMaterial({ color: base, transparent: true, opacity: 0.7, emissive: base.clone().multiplyScalar(0.25) });

    this.inner = new THREE.Group();
    const add = (mesh: THREE.Mesh) => this.inner.add(mesh);

    switch (def.mesh) {
      case "sphere": {
        add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), glass));
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.12, 8), dark));
        this.inner.children[1]!.position.y = -0.16;
        break;
      }
      case "cat": {
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.18, 3, 8), mat);
        body.position.y = 0.05;
        add(body);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), mat);
        head.position.set(0, 0.24, 0.06);
        add(head);
        const ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 4), mat);
        ear1.position.set(-0.05, 0.33, 0.06);
        add(ear1);
        const ear2 = ear1.clone();
        ear2.position.x = 0.05;
        add(ear2);
        break;
      }
      case "bell": {
        add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), mat));
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), mat);
        knob.position.y = 0.13;
        add(knob);
        break;
      }
      case "chimes": {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.02, 6, 14), dark);
        ring.rotation.x = Math.PI / 2;
        add(ring);
        for (let i = 0; i < 5; i++) {
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 5), mat);
          const a = (i / 5) * Math.PI * 2;
          rod.position.set(Math.cos(a) * 0.13, -0.1, Math.sin(a) * 0.13);
          add(rod);
        }
        break;
      }
      case "panel": {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.08), dark);
        add(panel);
        const neon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.02), new THREE.MeshBasicMaterial({ color: def.color }));
        neon.position.z = 0.05;
        add(neon);
        break;
      }
      case "vending": {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.75, 0.75), mat));
        const face = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.04), new THREE.MeshBasicMaterial({ color: 0x2a3d55 }));
        face.position.set(-0.1, 0.25, 0.39);
        add(face);
        break;
      }
      case "arcade": {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.8, 0.75), mat));
        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.04), new THREE.MeshBasicMaterial({ color: 0x3355ff }));
        screen.position.set(0, 0.55, 0.39);
        screen.rotation.x = -0.25;
        add(screen);
        break;
      }
      case "canister": {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.85, 10), mat));
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.3, 8), dark));
        break;
      }
      case "tank": {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.5), glass));
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.56, 0.42), dark);
        add(frame);
        break;
      }
      case "clock": {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.85, 0.35), mat));
        const face = new THREE.Mesh(new THREE.CircleGeometry(0.16, 12), new THREE.MeshBasicMaterial({ color: 0xe8e0c8 }));
        face.position.set(0, 0.62, 0.19);
        add(face);
        break;
      }
      case "distributor": {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 8), mat));
        for (let i = 0; i < 4; i++) {
          const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 5), dark);
          const a = (i / 4) * Math.PI * 2;
          plug.position.set(Math.cos(a) * 0.11, 0.16, Math.sin(a) * 0.11);
          add(plug);
        }
        break;
      }
      default: {
        // "box" and everything else
        add(new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.3, def.radius * 1.5), Math.max(0.26, def.restY * 1.6), Math.max(0.3, def.radius * 1.4)), mat));
        if (def.twoHandle) {
          const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), dark);
          h1.position.set(0, def.restY + 0.05, def.radius * 0.9);
          add(h1);
          const h2 = h1.clone();
          h2.position.z = -def.radius * 0.9;
          add(h2);
        }
        break;
      }
    }
    this.group.add(this.inner);

    // selection highlight ring
    this.highlight = new THREE.Mesh(
      new THREE.RingGeometry(def.radius + 0.12, def.radius + 0.24, 20),
      new THREE.MeshBasicMaterial({ color: 0xffd268, transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false }),
    );
    this.highlight.rotation.x = -Math.PI / 2;
    this.group.add(this.highlight);
  }

  update(it: ItemState, highlighted: boolean, t: number): void {
    if (it.state === 3) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    // stored items are shown stacked in the van cargo bay instead
    this.group.position.set(it.x, it.y, it.z);
    this.group.rotation.y = it.yaw;

    // damage darkens the mesh
    const dmg = Math.min(1, it.damage / WRECKED_AT);
    const def = ITEM_DEFS[this.defId]!;
    const base = new THREE.Color(def.color);
    const target = base.clone().lerp(new THREE.Color(0x191a1d), dmg * 0.75);
    this.inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.MeshLambertMaterial;
      if (mat && mat.isMeshLambertMaterial && mat.transparent === false) {
        mat.color.copy(target);
      }
    });

    (this.highlight.material as THREE.MeshBasicMaterial).opacity = highlighted ? 0.55 + 0.3 * Math.sin(t * 6) : 0;
    this.highlight.position.y = 0.06 - it.y % 1;
  }
}
