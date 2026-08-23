import * as THREE from "three";

function add(group: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pose?: (m: THREE.Mesh) => void) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  pose?.(mesh);
  group.add(mesh);
  return mesh;
}

function makeLiveryMap() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#f6f8fa");
  g.addColorStop(0.45, "#e7edf2");
  g.addColorStop(1, "#d5dde4");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 256);

  ctx.fillStyle = "#16324c";
  ctx.fillRect(0, 142, 1024, 44);
  ctx.fillStyle = "#c45c28";
  ctx.fillRect(0, 186, 1024, 7);
  ctx.fillStyle = "#16324c";
  ctx.fillRect(0, 193, 1024, 5);

  ctx.strokeStyle = "rgba(20, 32, 44, 0.07)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(40 + i * 86, 12);
    ctx.lineTo(40 + i * 86, 244);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function makeTailDecal() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#16324c";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#c45c28";
  ctx.fillRect(0, 196, 256, 18);
  ctx.fillStyle = "#f4f7fa";
  ctx.font = "bold 52px Barlow, ui-sans-serif, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N-SFO", 128, 118);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeWingGeometry() {
  const stations = [
    { x: 0, chord: 1.72, thick: 0.2, zLe: 0.58 },
    { x: 2.4, chord: 1.48, thick: 0.15, zLe: 0.4 },
    { x: 5.55, chord: 1.08, thick: 0.08, zLe: 0.12 },
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushStation = (s: (typeof stations)[0], side: 1 | -1) => {
    const x = s.x * side;
    const te = s.zLe - s.chord;
    const y = s.thick * 0.5;
    positions.push(x, y, s.zLe, x, y, te, x, -y, te, x, -y, s.zLe);
    const u = (s.x / 5.55) * 0.5 + 0.5;
    uvs.push(u, 1, u, 0, u, 0, u, 1);
  };

  for (const s of stations) pushStation(s, 1);
  for (const s of stations) pushStation(s, -1);

  const ring = (a: number, b: number) => {
    const A = a * 4;
    const B = b * 4;
    indices.push(A, B, A + 1, A + 1, B, B + 1);
    indices.push(A + 1, B + 1, A + 2, A + 2, B + 1, B + 2);
    indices.push(A + 2, B + 2, A + 3, A + 3, B + 2, B + 3);
    indices.push(A + 3, B + 3, A, A, B + 3, B);
  };
  ring(0, 1);
  ring(1, 2);
  // Left wing: reverse station order so top-face winding stays +Y.
  ring(4, 3);
  ring(5, 4);

  const cap = (i: number, flip: boolean) => {
    const b = i * 4;
    if (flip) indices.push(b, b + 2, b + 1, b, b + 3, b + 2);
    else indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  cap(2, false);
  cap(5, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeFinShape(root: number, tip: number, height: number, sweep: number) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(root, 0);
  s.lineTo(root - sweep, height);
  s.lineTo(root - sweep - tip, height);
  s.closePath();
  return s;
}

/** High-wing tourer, +Z forward, +Y up. ~8.5 m long, ~11 m span. */
export function createCraft(): THREE.Group {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const livery = makeLiveryMap();
  const tailMap = makeTailDecal();
  textures.push(livery, tailMap);

  const paint = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: livery,
    metalness: 0.12,
    roughness: 0.42,
  });
  const white = new THREE.MeshStandardMaterial({
    color: 0xeef2f5,
    metalness: 0.1,
    roughness: 0.46,
    side: THREE.DoubleSide,
  });
  const navy = new THREE.MeshStandardMaterial({
    color: 0x16324c,
    metalness: 0.18,
    roughness: 0.4,
    map: tailMap,
  });
  const navyFlat = new THREE.MeshStandardMaterial({
    color: 0x16324c,
    metalness: 0.18,
    roughness: 0.4,
  });
  const cowling = new THREE.MeshStandardMaterial({
    color: 0x2a323c,
    metalness: 0.35,
    roughness: 0.38,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x6f8aa0,
    metalness: 0.85,
    roughness: 0.08,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: 0xc5ccd4,
    metalness: 0.82,
    roughness: 0.22,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x1a1c1e,
    metalness: 0.05,
    roughness: 0.86,
  });
  const stripe = new THREE.MeshStandardMaterial({
    color: 0xc45c28,
    metalness: 0.2,
    roughness: 0.4,
  });
  mats.push(paint, white, navy, navyFlat, cowling, glass, chrome, rubber, stripe);

  const fusePts = [
    new THREE.Vector2(0.0, 4.15),
    new THREE.Vector2(0.16, 4.08),
    new THREE.Vector2(0.42, 3.72),
    new THREE.Vector2(0.58, 3.28),
    new THREE.Vector2(0.62, 2.7),
    new THREE.Vector2(0.7, 1.85),
    new THREE.Vector2(0.76, 1.05),
    new THREE.Vector2(0.74, 0.15),
    new THREE.Vector2(0.58, -0.9),
    new THREE.Vector2(0.4, -2.15),
    new THREE.Vector2(0.24, -3.35),
    new THREE.Vector2(0.12, -4.05),
    new THREE.Vector2(0.0, -4.22),
  ];
  const fuse = new THREE.LatheGeometry(fusePts, 24);
  fuse.rotateX(Math.PI / 2);
  geos.push(fuse);
  add(group, fuse, paint, (m) => {
    m.scale.set(0.82, 0.92, 1);
  });

  const cowlPts = [
    new THREE.Vector2(0.02, 4.18),
    new THREE.Vector2(0.2, 4.1),
    new THREE.Vector2(0.48, 3.78),
    new THREE.Vector2(0.6, 3.35),
    new THREE.Vector2(0.62, 2.95),
    new THREE.Vector2(0.54, 2.72),
  ];
  const cowl = new THREE.LatheGeometry(cowlPts, 20);
  cowl.rotateX(Math.PI / 2);
  geos.push(cowl);
  add(group, cowl, cowling, (m) => m.scale.set(0.86, 0.9, 1));

  const spinner = new THREE.SphereGeometry(0.28, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  spinner.rotateX(Math.PI / 2);
  geos.push(spinner);
  add(group, spinner, chrome, (m) => {
    m.position.z = 4.12;
    m.scale.set(1, 1, 1.35);
  });

  const cabin = new THREE.SphereGeometry(0.86, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
  geos.push(cabin);
  add(group, cabin, glass, (m) => {
    m.position.set(0, 0.22, 1.15);
    m.scale.set(0.72, 0.58, 1.35);
  });

  const windshield = new THREE.SphereGeometry(0.7, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.4);
  geos.push(windshield);
  add(group, windshield, glass, (m) => {
    m.position.set(0, 0.28, 2.05);
    m.rotation.x = 0.35;
    m.scale.set(0.7, 0.42, 0.55);
  });

  const wing = makeWingGeometry();
  geos.push(wing);
  add(group, wing, white, (m) => {
    m.position.set(0, 0.78, 0.55);
    m.rotation.x = 0.015;
  });

  const dihedral = 0.08;
  const tip = new THREE.BoxGeometry(0.07, 0.4, 1.02);
  geos.push(tip);
  add(group, tip, navyFlat, (m) => {
    m.position.set(-5.52, 0.84, 0.18);
    m.rotation.z = dihedral;
  });
  add(group, tip, navyFlat, (m) => {
    m.position.set(5.52, 0.84, 0.18);
    m.rotation.z = -dihedral;
  });

  const strutGeo = new THREE.CylinderGeometry(0.032, 0.032, 1.55, 8);
  geos.push(strutGeo);
  add(group, strutGeo, chrome, (m) => {
    m.position.set(-1.35, 0.2, 0.45);
    m.rotation.z = 0.72;
    m.rotation.x = 0.12;
  });
  add(group, strutGeo, chrome, (m) => {
    m.position.set(1.35, 0.2, 0.45);
    m.rotation.z = -0.72;
    m.rotation.x = 0.12;
  });

  const vStab = new THREE.ExtrudeGeometry(makeFinShape(1.45, 0.55, 1.82, 0.52), {
    depth: 0.08,
    bevelEnabled: false,
  });
  vStab.rotateY(-Math.PI / 2);
  geos.push(vStab);
  add(group, vStab, navy, (m) => {
    m.position.set(0.04, 0.1, -2.95);
  });

  const hStab = new THREE.BoxGeometry(3.55, 0.08, 0.92);
  geos.push(hStab);
  add(group, hStab, white, (m) => {
    m.position.set(0, 0.32, -3.78);
  });

  const elevator = new THREE.BoxGeometry(3.2, 0.045, 0.2);
  geos.push(elevator);
  add(group, elevator, navyFlat, (m) => m.position.set(0, 0.32, -4.22));

  const dorsal = new THREE.BoxGeometry(0.07, 0.26, 1.15);
  geos.push(dorsal);
  add(group, dorsal, navyFlat, (m) => m.position.set(0, 0.4, -2.45));

  const stripeGeo = new THREE.BoxGeometry(0.025, 0.11, 4.6);
  geos.push(stripeGeo);
  add(group, stripeGeo, stripe, (m) => m.position.set(0.64, 0.02, 0.4));
  add(group, stripeGeo, stripe, (m) => m.position.set(-0.64, 0.02, 0.4));
  const topStripe = new THREE.BoxGeometry(0.22, 0.02, 5.4);
  geos.push(topStripe);
  add(group, topStripe, navyFlat, (m) => m.position.set(0, 0.62, 0.15));

  function wheel(x: number, y: number, z: number, pantZ: number) {
    const pant = new THREE.SphereGeometry(0.16, 12, 10);
    geos.push(pant);
    add(group, pant, white, (m) => {
      m.position.set(x, y + 0.02, z);
      m.scale.set(0.68, 0.85, pantZ);
    });
    const tire = new THREE.TorusGeometry(0.12, 0.045, 8, 14);
    geos.push(tire);
    add(group, tire, rubber, (m) => {
      m.position.set(x, y - 0.02, z);
      m.rotation.y = Math.PI / 2;
    });
  }
  wheel(0, -0.72, 2.55, 1.3);
  wheel(-0.85, -0.78, 0.15, 1.1);
  wheel(0.85, -0.78, 0.15, 1.1);

  const leg = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6);
  geos.push(leg);
  add(group, leg, chrome, (m) => {
    m.position.set(0, -0.42, 2.35);
    m.rotation.x = 0.45;
  });
  add(group, leg, chrome, (m) => {
    m.position.set(-0.55, -0.42, 0.25);
    m.rotation.z = 0.55;
  });
  add(group, leg, chrome, (m) => {
    m.position.set(0.55, -0.42, 0.25);
    m.rotation.z = -0.55;
  });

  const red = new THREE.MeshBasicMaterial({ color: 0xc23a3a });
  const green = new THREE.MeshBasicMaterial({ color: 0x2f9a5a });
  const beacon = new THREE.MeshBasicMaterial({ color: 0xff3b3b });
  mats.push(red, green, beacon);
  const lightGeo = new THREE.SphereGeometry(0.055, 8, 8);
  geos.push(lightGeo);
  add(group, lightGeo, red, (m) => m.position.set(-5.5, 0.88, 0.55));
  add(group, lightGeo, green, (m) => m.position.set(5.5, 0.88, 0.55));
  const beaconMesh = add(group, lightGeo, beacon, (m) => m.position.set(0, 1.95, -3.4));

  const prop = new THREE.Group();
  const blade = new THREE.BoxGeometry(0.12, 1.72, 0.04);
  geos.push(blade);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x1e242c,
    metalness: 0.15,
    roughness: 0.45,
  });
  mats.push(bladeMat);
  const b0 = new THREE.Mesh(blade, bladeMat);
  prop.add(b0);
  const b1 = new THREE.Mesh(blade, bladeMat);
  b1.rotation.z = Math.PI / 2;
  prop.add(b1);

  const disc = new THREE.CircleGeometry(0.92, 24);
  geos.push(disc);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0xb8c0c8,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  mats.push(discMat);
  const discMesh = new THREE.Mesh(disc, discMat);
  discMesh.position.z = 0.02;
  prop.add(discMesh);
  prop.position.z = 4.22;
  group.add(prop);

  const hub = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 10);
  hub.rotateX(Math.PI / 2);
  geos.push(hub);
  add(prop, hub, chrome);

  group.userData.update = (dt: number, flying: boolean, speed: number) => {
    const rpm = flying ? 28 + speed * 1.6 : 3.2;
    prop.rotation.z -= rpm * dt;
    discMesh.visible = flying && speed > 20;
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(performance.now() * 0.008));
    beacon.color.setRGB(pulse, 0.08, 0.08);
    beaconMesh.visible = true;
  };

  group.userData.dispose = () => {
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of textures) t.dispose();
  };

  group.scale.setScalar(1.15);
  return group;
}
