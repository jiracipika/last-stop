// The Caretaker: tall silhouette, swinging lantern, readable telegraphs.
import * as THREE from "three";
import type { EnemyState } from "@last-stop/shared";

export class EnemyView {
  group = new THREE.Group();
  private coat: THREE.Mesh;
  private head: THREE.Group;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private lantern: THREE.Group;
  private lanternLight: THREE.PointLight;
  private lampFace: THREE.Mesh;
  private sway = 0;

  constructor() {
    const coatMat = new THREE.MeshLambertMaterial({ color: 0x191c21 });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });

    this.coat = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 1.5, 4, 10), coatMat);
    this.coat.position.y = 1.5;
    this.group.add(this.coat);
    // coat tails
    const tails = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.16), trimMat);
    tails.position.set(0, 0.6, -0.18);
    this.group.add(tails);

    this.head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.36), coatMat);
    this.head.add(skull);
    // hat brim
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 10), trimMat);
    brim.position.y = 0.2;
    this.head.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.22, 10), trimMat);
    crown.position.y = 0.32;
    this.head.add(crown);
    // glowing face
    this.lampFace = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.05), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    this.lampFace.position.set(0, 0.02, 0.19);
    this.head.add(this.lampFace);
    this.head.position.y = 2.42;
    this.group.add(this.head);

    const armGeo = new THREE.CapsuleGeometry(0.08, 0.9, 2, 6);
    this.armL = new THREE.Mesh(armGeo, coatMat);
    this.armR = new THREE.Mesh(armGeo, coatMat);
    this.armL.position.set(-0.48, 1.7, 0);
    this.armR.position.set(0.48, 1.7, 0);
    this.group.add(this.armL, this.armR);

    // lantern on a pole
    this.lantern = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), trimMat);
    this.lantern.add(pole);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.16), new THREE.MeshBasicMaterial({ color: 0xffc060 }));
    bulb.position.y = -0.55;
    this.lantern.add(bulb);
    this.lanternLight = new THREE.PointLight(0xffb45e, 16, 12, 1.7);
    this.lanternLight.position.y = -0.55;
    this.lantern.add(this.lanternLight);
    this.lantern.position.set(0.55, 1.9, 0.25);
    this.group.add(this.lantern);
  }

  update(dt: number, e: EnemyState, t: number): void {
    this.group.position.set(e.x, 0, e.z);
    this.group.rotation.y = e.yaw;

    const speedLike = e.ai === 2 ? 1 : e.ai === 1 ? 0.55 : e.ai === 3 || e.ai === 5 ? 0.1 : 0.3;
    this.sway += dt * (2.2 + speedLike * 4);
    const sw = Math.sin(this.sway);

    // lurching walk
    this.coat.rotation.z = sw * 0.07 * speedLike;
    this.group.position.y = Math.abs(sw) * 0.05 * speedLike;
    this.armL.rotation.x = -sw * 0.4 * speedLike;
    this.armR.rotation.x = sw * 0.4 * speedLike;

    // lantern swings and dims/brightens with intent
    this.lantern.rotation.z = sw * 0.35;
    const flare = e.ai === 3 ? 2.4 : e.ai === 2 ? 1.5 : 1;
    this.lanternLight.intensity = (12 + Math.sin(t * 5) * 2) * flare;
    this.lampFace.material = new THREE.MeshBasicMaterial({ color: e.ai === 3 ? 0xff5030 : 0xffd9a0 });

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
}
