import * as THREE from 'three'
import type { ResourceTracker } from './ResourceTracker'

/**
 * 殿內三尊神像的風格化造型（程序化低多邊形）。
 *
 * 每尊為一個 Group：原點在台座底面中心、面向 +z（面向參拜者）、單位公尺。
 * 寫實模型的替換方式見 loadStatueModel()：同樣的原點、朝向與高度，換掉 Group 內容即可。
 *
 * 方向：神像面向 +z，神像自身的左手在 +x、右手在 -x。
 */

export type StatueId = 'buddha' | 'guanyin' | 'guangong'

/** 每尊的參考總高（公尺，含台座），寫實模型縮放時以此對齊。 */
export const STATUE_HEIGHT: Record<StatueId, number> = { buddha: 3.3, guanyin: 2.9, guangong: 3.2 }

type V3 = [number, number, number]

interface Kit {
  tracker: ResourceTracker
  mat: Record<string, THREE.Material>
  geo: {
    sphere: THREE.BufferGeometry
    hiSphere: THREE.BufferGeometry
    box: THREE.BufferGeometry
    cyl: THREE.BufferGeometry
    petal: THREE.BufferGeometry
    /** 細弧線（眉、眼、唇）：半圓管，y 取負值時開口朝上。 */
    brow: THREE.BufferGeometry
    /** 鬍鬚：尖端朝下、頂端在原點的細長圓錐。 */
    beard: THREE.BufferGeometry
  }
}

/** 建立神像共用的材質與基本幾何（由呼叫端的 tracker 擁有）。 */
export function createStatueKit(tracker: ResourceTracker): Kit {
  const phong = (color: string, shininess = 40, specular = '#3a3020', extra: THREE.MeshPhongMaterialParameters = {}) =>
    tracker.trackMaterial(new THREE.MeshPhongMaterial({ color, shininess, specular, flatShading: false, ...extra }))
  const lambert = (color: string) => tracker.trackMaterial(new THREE.MeshLambertMaterial({ color }))
  return {
    tracker,
    mat: {
      // 金箔質感：高光柔和、範圍較大，避免塑膠般的亮斑
      gold: phong('#c9a043', 28, '#7a6434'),
      goldDeep: phong('#a07a2c', 22, '#5e4c26'),
      // 五官線條：比金身暗，近看才看得出輪廓
      feature: phong('#6e5020', 10, '#2a2010'),
      featureSkin: phong('#6b4636', 10, '#2a1a10'),
      hair: phong('#27324a', 20, '#334'),
      lotus: phong('#d6a64e', 60, '#ffe7b0'),
      white: phong('#f1ede4', 25, '#444'),
      skin: phong('#efd6bc', 20, '#332a20'),
      redFace: phong('#a3302a', 25, '#402020'),
      // 深色鱗甲（帶金屬感）與紅腰巾
      armor: phong('#2e2c30', 45, '#6a6470'),
      sash: phong('#a3231b', 15, '#331010'),
      beard: lambert('#151515'),
      green: phong('#2f5b44', 25, '#203028'),
      lacquer: phong('#5a1f17', 50, '#664'),
      steel: phong('#c7ccd2', 90, '#ffffff'),
      porcelain: phong('#e9f1f2', 80, '#ffffff'),
      willow: lambert('#6f9a52'),
      dark: lambert('#2a2420'),
    },
    geo: {
      sphere: tracker.track(new THREE.SphereGeometry(1, 16, 12)),
      hiSphere: tracker.track(new THREE.SphereGeometry(1, 24, 18)),
      box: tracker.track(new THREE.BoxGeometry(1, 1, 1)),
      cyl: tracker.track(new THREE.CylinderGeometry(1, 1, 1, 16)),
      petal: tracker.track(petalGeometry()),
      brow: tracker.track(new THREE.TorusGeometry(1, 0.28, 5, 14, Math.PI)),
      beard: tracker.track(new THREE.ConeGeometry(0.045, 1, 6).rotateX(Math.PI).translate(0, -0.5, 0)),
    },
  }
}

/** 蓮瓣：底部窄、尖端上翹的扁橢圓。 */
function petalGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 10, 8)
  g.scale(0.5, 0.18, 1)
  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i)
    // 外緣（+z）往上翹、往外變尖
    pos.setY(i, pos.getY(i) + Math.max(0, z) ** 2 * 0.35)
    pos.setX(i, pos.getX(i) * (1 - Math.max(0, z) * 0.45))
  }
  g.computeVertexNormals()
  return g
}

function part(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, pos: V3, scale: V3, rot: V3 = [0, 0, 0]): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m)
  mesh.position.set(...pos)
  mesh.scale.set(...scale)
  mesh.rotation.set(...rot)
  parent.add(mesh)
  return mesh
}

function lathe(kit: Kit, points: Array<[number, number]>, segments = 20): THREE.BufferGeometry {
  return kit.tracker.track(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments))
}

/** 蓮花座：鼓形底座加兩圈蓮瓣。 */
function lotusThrone(kit: Kit, parent: THREE.Object3D, radius: number, y = 0): number {
  const { geo, mat } = kit
  part(parent, geo.cyl, mat.goldDeep!, [0, y + 0.12 * radius, 0], [radius * 1.05, 0.24 * radius, radius * 1.05])
  part(parent, geo.cyl, mat.gold!, [0, y + 0.3 * radius, 0], [radius * 0.82, 0.14 * radius, radius * 0.82])
  const rings: Array<{ n: number; r: number; y: number; tilt: number; s: number; offset: number }> = [
    { n: 16, r: radius * 0.86, y: y + 0.36 * radius, tilt: 0.55, s: radius * 0.34, offset: 0 },
    { n: 16, r: radius * 0.7, y: y + 0.5 * radius, tilt: 0.9, s: radius * 0.3, offset: Math.PI / 16 },
  ]
  const tmp = new THREE.Object3D()
  for (const ring of rings) {
    const inst = new THREE.InstancedMesh(geo.petal, mat.lotus!, ring.n)
    for (let i = 0; i < ring.n; i++) {
      const a = (i / ring.n) * Math.PI * 2 + ring.offset
      tmp.position.set(Math.sin(a) * ring.r, ring.y, Math.cos(a) * ring.r)
      tmp.rotation.set(0, 0, 0)
      tmp.rotateY(a)
      tmp.rotateX(-ring.tilt)
      tmp.scale.setScalar(ring.s)
      tmp.updateMatrix()
      inst.setMatrixAt(i, tmp.matrix)
    }
    inst.computeBoundingSphere()
    parent.add(inst)
  }
  return y + 0.58 * radius
}

/** 背光：身光（尖拱形）加頭光（圓環）。 */
function mandorla(kit: Kit, parent: THREE.Object3D, opts: { bodyW: number; bodyH: number; bodyY: number; headY: number; headR: number; z: number }) {
  const shape = new THREE.Shape()
  const w = opts.bodyW / 2
  const h = opts.bodyH
  shape.moveTo(-w, 0)
  shape.lineTo(-w, h * 0.55)
  shape.quadraticCurveTo(-w, h * 0.92, 0, h)
  shape.quadraticCurveTo(w, h * 0.92, w, h * 0.55)
  shape.lineTo(w, 0)
  shape.lineTo(-w, 0)
  const body = kit.tracker.track(new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false, curveSegments: 16 }))
  part(parent, body, kit.mat.goldDeep!, [0, opts.bodyY, opts.z], [1, 1, 1])
  // 內層較亮的一圈
  part(parent, body, kit.mat.gold!, [0, opts.bodyY + h * 0.06, opts.z + 0.04], [0.86, 0.9, 0.5])
  const ring = kit.tracker.track(new THREE.TorusGeometry(opts.headR, opts.headR * 0.08, 8, 40))
  part(parent, ring, kit.mat.gold!, [0, opts.headY, opts.z + 0.1], [1, 1, 1])
  const disc = kit.tracker.track(new THREE.CircleGeometry(opts.headR * 0.92, 40))
  part(parent, disc, kit.mat.goldDeep!, [0, opts.headY, opts.z + 0.09], [1, 1, 1])
}

/**
 * 慈悲寧靜的面相：彎眉、低垂半閉的雙眼、鼻樑、微笑的嘴唇，可選白毫。
 * 五官依頭部橢球（中心 (0, headY, cz)、半徑 r）計算表面位置貼合臉部；比例以佛像頭部（半寬 0.27）為基準縮放。
 */
function serenFace(
  g: THREE.Object3D,
  kit: Kit,
  headY: number,
  r: { x: number; y: number; z: number },
  cz: number,
  opts: { line: THREE.Material; nose: THREE.Material; urna: boolean },
) {
  const k = r.x / 0.27
  const faceZ = (x: number, y: number) => cz + r.z * Math.sqrt(Math.max(0, 1 - (x / r.x) ** 2 - (y / r.y) ** 2))
  const turn = (x: number) => Math.asin(Math.min(1, x / r.x)) // 依曲面轉向，線條貼合臉頰
  const at = (x: number, y: number, inset: number): V3 => [x * k, headY + y * k, faceZ(x * k, y * k) - inset * k]
  if (opts.urna) part(g, kit.geo.sphere, opts.line, at(0, 0.07, 0), [0.016 * k, 0.016 * k, 0.008 * k])
  for (const side of [-1, 1]) {
    part(g, kit.geo.brow, opts.line, at(side * 0.092, 0.035, 0.004), [0.06 * k, 0.022 * k, 0.02 * k], [0, turn(side * 0.092 * k), 0])
    part(g, kit.geo.brow, opts.line, at(side * 0.088, -0.012, 0.003), [0.048 * k, -0.012 * k, 0.016 * k], [0, turn(side * 0.088 * k), 0])
  }
  part(g, kit.geo.sphere, opts.nose, at(0, -0.055, 0.012), [0.028 * k, 0.06 * k, 0.03 * k])
  part(g, kit.geo.brow, opts.line, at(0, -0.14, 0.004), [0.042 * k, -0.01 * k, 0.016 * k])
}

/**
 * 釋迦牟尼佛：結跏趺坐於蓮花座，雙手禪定印，螺髮、肉髻、長耳垂，金身，背後有身光與頭光。
 */
export function buildBuddha(kit: Kit): THREE.Group {
  const g = new THREE.Group()
  g.name = 'statue:buddha'
  const { geo, mat } = kit
  const seat = lotusThrone(kit, g, 1.15)

  // 盤坐的雙腿（衣襬覆蓋）
  part(g, geo.hiSphere, mat.gold!, [0, seat + 0.2, 0.12], [0.98, 0.3, 0.66])
  // 腳掌（右足在上）
  part(g, geo.sphere, mat.gold!, [-0.32, seat + 0.42, 0.42], [0.2, 0.08, 0.12], [0, 0.4, 0])
  // 身軀：袈裟
  const torso = lathe(kit, [[0, 0], [0.56, 0], [0.6, 0.25], [0.52, 0.62], [0.6, 0.9], [0.52, 1.06], [0.24, 1.14], [0, 1.15]])
  part(g, torso, mat.gold!, [0, seat + 0.25, 0], [1, 1, 0.72])
  // 袈裟斜披左肩的衣紋
  part(g, geo.box, mat.goldDeep!, [0.12, seat + 0.95, 0.38], [0.12, 0.95, 0.06], [0, 0, -0.55])
  // 上臂與前臂
  for (const side of [-1, 1]) {
    part(g, geo.sphere, mat.gold!, [side * 0.58, seat + 0.95, 0.05], [0.17, 0.42, 0.18], [0, 0, side * 0.18])
    part(g, geo.sphere, mat.gold!, [side * 0.34, seat + 0.58, 0.32], [0.14, 0.13, 0.36], [0, side * -0.5, 0])
  }
  // 禪定印：雙手疊放於腹前
  part(g, geo.sphere, mat.gold!, [0, seat + 0.55, 0.42], [0.26, 0.08, 0.16])
  // 頸
  part(g, geo.cyl, mat.gold!, [0, seat + 1.43, 0], [0.13, 0.16, 0.13])
  // 頭與面
  const headY = seat + 1.72
  part(g, geo.hiSphere, mat.gold!, [0, headY, 0.02], [0.27, 0.31, 0.27])
  // 螺髮與肉髻
  const hairCap = kit.tracker.track(new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.42))
  part(g, hairCap, mat.hair!, [0, headY + 0.02, -0.01], [0.285, 0.32, 0.285], [-0.18, 0, 0])
  const curls = kit.tracker.track(new THREE.IcosahedronGeometry(1, 1))
  part(g, curls, mat.hair!, [0, headY + 0.33, -0.03], [0.14, 0.13, 0.14])
  // 長耳垂
  for (const side of [-1, 1]) part(g, geo.sphere, mat.gold!, [side * 0.27, headY - 0.06, 0], [0.04, 0.17, 0.08])
  serenFace(g, kit, headY, { x: 0.27, y: 0.31, z: 0.27 }, 0.02, { line: mat.feature!, nose: mat.gold!, urna: true })

  mandorla(kit, g, { bodyW: 2.1, bodyH: 2.75, bodyY: seat - 0.25, headY, headR: 0.5, z: -0.55 })
  return g
}

/**
 * 觀世音菩薩：立於蓮花座，白衣與披巾，寶冠，左手持淨瓶、右手持楊柳枝，頭後有頭光。
 */
export function buildGuanyin(kit: Kit): THREE.Group {
  const g = new THREE.Group()
  g.name = 'statue:guanyin'
  const { geo, mat } = kit
  const base = lotusThrone(kit, g, 0.62)

  // 長袍：下襬寬、腰身收、肩部圓
  const robe = lathe(kit, [[0, 0], [0.5, 0], [0.44, 0.15], [0.33, 0.8], [0.27, 1.15], [0.3, 1.45], [0.33, 1.68], [0.22, 1.78], [0.09, 1.82], [0, 1.83]], 24)
  part(g, robe, mat.white!, [0, base, 0], [1, 1, 0.78])
  // 腰帶與瓔珞
  part(g, geo.cyl, mat.gold!, [0, base + 1.12, 0], [0.285, 0.05, 0.225])
  part(g, kit.tracker.track(new THREE.TorusGeometry(0.2, 0.018, 6, 24, Math.PI)), mat.gold!, [0, base + 1.58, 0.2], [1, 1.1, 1], [0, 0, Math.PI])
  // 披巾（頭後垂至肩）
  const veil = lathe(kit, [[0, 0.62], [0.2, 0.55], [0.28, 0.3], [0.34, 0], [0.36, -0.1]], 20)
  const headY = base + 2.04
  part(g, veil, mat.white!, [0, headY - 0.36, -0.04], [1, 1, 0.85])
  // 頸、頭
  part(g, geo.cyl, mat.skin!, [0, base + 1.86, 0], [0.07, 0.1, 0.07])
  part(g, geo.hiSphere, mat.skin!, [0, headY, 0.02], [0.17, 0.205, 0.175])
  // 髮髻與寶冠（冠上化佛以金色小圓表示）
  part(g, geo.sphere, mat.hair!, [0, headY + 0.17, -0.03], [0.12, 0.12, 0.12])
  part(g, geo.cyl, mat.gold!, [0, headY + 0.2, 0], [0.18, 0.07, 0.18])
  part(g, geo.sphere, mat.gold!, [0, headY + 0.29, 0.15], [0.05, 0.065, 0.025])
  serenFace(g, kit, headY, { x: 0.17, y: 0.205, z: 0.175 }, 0.02, { line: mat.featureSkin!, nose: mat.skin!, urna: true })

  // 左手（+x）於胸前持淨瓶
  part(g, geo.sphere, mat.white!, [0.3, base + 1.4, 0.05], [0.09, 0.3, 0.1], [0, 0, 0.15])
  part(g, geo.sphere, mat.white!, [0.22, base + 1.22, 0.2], [0.07, 0.07, 0.22], [0.2, 0.4, 0])
  part(g, geo.sphere, mat.skin!, [0.15, base + 1.24, 0.38], [0.05, 0.06, 0.05])
  const vase = lathe(kit, [[0, 0], [0.04, 0], [0.065, 0.06], [0.07, 0.12], [0.035, 0.2], [0.018, 0.27], [0.03, 0.3], [0, 0.3]], 14)
  part(g, vase, mat.porcelain!, [0.15, base + 1.18, 0.4], [1, 1, 1])
  // 右手（-x）舉楊柳枝
  part(g, geo.sphere, mat.white!, [-0.3, base + 1.4, 0.05], [0.09, 0.3, 0.1], [0, 0, -0.15])
  part(g, geo.sphere, mat.white!, [-0.27, base + 1.42, 0.22], [0.07, 0.22, 0.07], [0.6, 0, 0])
  part(g, geo.sphere, mat.skin!, [-0.27, base + 1.58, 0.33], [0.05, 0.06, 0.05])
  part(g, geo.cyl, mat.willow!, [-0.27, base + 1.78, 0.36], [0.007, 0.42, 0.007], [0.15, 0, 0.1])
  const leaves = new THREE.InstancedMesh(geo.sphere, mat.willow!, 10)
  const tmp = new THREE.Object3D()
  for (let i = 0; i < 10; i++) {
    const t = i / 9
    tmp.position.set(-0.27 + Math.sin(i * 1.7) * 0.05, base + 1.95 - t * 0.28, 0.38 + Math.cos(i * 1.7) * 0.05)
    tmp.rotation.set(0.3, i, 0.2)
    tmp.scale.set(0.012, 0.05, 0.006)
    tmp.updateMatrix()
    leaves.setMatrixAt(i, tmp.matrix)
  }
  leaves.computeBoundingSphere()
  g.add(leaves)

  // 頭光
  const ring = kit.tracker.track(new THREE.TorusGeometry(0.34, 0.025, 8, 40))
  part(g, ring, mat.gold!, [0, headY + 0.04, -0.28], [1, 1, 1])
  const disc = kit.tracker.track(new THREE.CircleGeometry(0.32, 40))
  part(g, disc, mat.goldDeep!, [0, headY + 0.04, -0.29], [1, 1, 1])
  return g
}

/** 在 a、b 兩點之間放一段圓柱（四肢、刀桿），兩端加圓球當關節。 */
function limb(parent: THREE.Object3D, kit: Kit, a: V3, b: V3, r: number, m: THREE.Material, joints = true): void {
  const va = new THREE.Vector3(...a)
  const vb = new THREE.Vector3(...b)
  const dir = vb.clone().sub(va)
  const mesh = new THREE.Mesh(kit.geo.cyl, m)
  mesh.position.copy(va).add(vb).multiplyScalar(0.5)
  mesh.scale.set(r, dir.length(), r)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  parent.add(mesh)
  if (joints) for (const p of [a, b]) part(parent, kit.geo.sphere, m, p, [r, r, r])
}

/**
 * 關聖帝君：站姿持青龍偃月刀。紅臉、臥蠶眉、丹鳳眼、五綹長髯；綠色幞頭與紅纓，深色鱗甲配金飾，
 * 綠袍、紅腰帶、背後綠披風。右手（-x）於腰間斜握大刀，刀刃斜指前下方，刀桿斜向左肩後方；左手按腰帶。
 */
export function buildGuangong(kit: Kit): THREE.Group {
  const g = new THREE.Group()
  g.name = 'statue:guangong'
  const { geo, mat } = kit
  const armor = mat.armor!
  const base = 0.25

  // 台座
  part(g, geo.box, mat.goldDeep!, [0, base / 2, 0.1], [1.25, base, 1.05])
  part(g, geo.box, mat.gold!, [0, base - 0.01, 0.1], [1.3, 0.03, 1.1])

  // 雙腿：戰靴、護脛（略為張開的站姿）
  for (const side of [-1, 1]) {
    const x = side * 0.17
    part(g, geo.box, mat.dark!, [x * 1.15, base + 0.07, 0.08], [0.2, 0.14, 0.34])
    limb(g, kit, [x * 1.1, base + 0.12, 0.02], [x, base + 0.7, 0], 0.09, mat.dark!)
    part(g, geo.box, mat.gold!, [x * 1.1, base + 0.36, 0.085], [0.14, 0.32, 0.04])
  }
  // 甲裙：腰部往下張開
  const skirt = lathe(kit, [[0, 1.0], [0.31, 1.0], [0.36, 0.76], [0.43, 0.52], [0.44, 0.5], [0, 0.5]], 18)
  part(g, skirt, armor, [0, base, 0], [1, 1, 0.78])
  // 前襬綠袍與紅腰巾垂帶
  part(g, geo.box, mat.green!, [0, base + 0.7, 0.3], [0.3, 0.55, 0.04], [0.08, 0, 0])
  part(g, geo.box, mat.sash!, [0.12, base + 0.78, 0.33], [0.08, 0.5, 0.03], [0.05, 0, -0.1])

  // 身軀：鱗甲
  const waistY = base + 1.0
  const torso = lathe(kit, [[0, 0], [0.31, 0], [0.36, 0.25], [0.41, 0.55], [0.43, 0.72], [0.3, 0.83], [0.14, 0.88], [0, 0.88]], 20)
  part(g, torso, armor, [0, waistY, 0], [1, 1, 0.72])
  // 金色腰帶、紅腰巾、護心鏡、胸前金飾
  part(g, geo.cyl, mat.gold!, [0, waistY + 0.04, 0], [0.33, 0.09, 0.25])
  part(g, geo.cyl, mat.sash!, [0, waistY - 0.06, 0], [0.34, 0.08, 0.26])
  part(g, geo.cyl, mat.gold!, [0, waistY + 0.48, 0.29], [0.12, 0.03, 0.12], [Math.PI / 2 - 0.15, 0, 0])
  part(g, geo.box, mat.gold!, [0, waistY + 0.66, 0.24], [0.5, 0.06, 0.05])
  // 綠袍外衣（肩到胸）與披風
  part(g, geo.box, mat.green!, [0, waistY + 0.5, -0.22], [0.76, 0.75, 0.06])
  part(g, geo.box, mat.green!, [0.02, waistY - 0.25, -0.33], [0.82, 1.35, 0.04], [-0.12, 0, 0])
  part(g, geo.box, mat.green!, [0.42, waistY - 0.2, -0.12], [0.06, 1.2, 0.45], [0, 0, 0.12])

  // 肩甲
  const shoulderY = waistY + 0.75
  for (const side of [-1, 1]) {
    part(g, geo.sphere, mat.gold!, [side * 0.42, shoulderY, 0], [0.19, 0.13, 0.21])
    part(g, geo.sphere, armor, [side * 0.46, shoulderY - 0.12, 0], [0.17, 0.12, 0.18])
  }

  // 青龍偃月刀：刀刃與刀桿接合處 p0 在右前下方，刀桿斜向左肩後方 p1
  const p0: V3 = [-0.6, 0.9, 0.55]
  const p1: V3 = [0.4, 3.05, -0.4]
  const handT = (waistY + 0.08 - p0[1]) / (p1[1] - p0[1])
  const hand: V3 = [p0[0] + (p1[0] - p0[0]) * handT, waistY + 0.08, p0[2] + (p1[2] - p0[2]) * handT]
  // 右臂（-x）握刀、左臂（+x）按腰帶
  limb(g, kit, [-0.42, shoulderY - 0.05, 0], [-0.58, waistY + 0.32, 0.12], 0.09, mat.green!)
  limb(g, kit, [-0.58, waistY + 0.32, 0.12], hand, 0.075, armor)
  part(g, geo.sphere, mat.redFace!, hand, [0.075, 0.075, 0.075])
  limb(g, kit, [0.42, shoulderY - 0.05, 0], [0.56, waistY + 0.35, 0.02], 0.09, mat.green!)
  limb(g, kit, [0.56, waistY + 0.35, 0.02], [0.34, waistY + 0.06, 0.22], 0.075, armor)
  part(g, geo.sphere, mat.redFace!, [0.31, waistY + 0.06, 0.25], [0.07, 0.07, 0.07])

  const glaive = new THREE.Group()
  const dir = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
  const length = dir.length()
  glaive.position.set(...p0)
  glaive.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  glaive.rotateY(-0.9) // 讓刀面朝向參拜者
  g.add(glaive)
  part(glaive, geo.cyl, mat.lacquer!, [0, length / 2, 0], [0.026, length, 0.026])
  part(glaive, geo.cyl, mat.gold!, [0, length + 0.05, 0], [0.03, 0.1, 0.03])
  // 刀刃：沿刀桿延長線向下的彎月形
  const blade = new THREE.Shape()
  // 寬彎月刀身，刀背有一個小尖齒
  blade.moveTo(-0.04, 0.02)
  blade.quadraticCurveTo(0.46, -0.02, 0.36, -0.8)
  blade.quadraticCurveTo(0.2, -0.46, -0.06, -0.4)
  blade.lineTo(-0.13, -0.3)
  blade.lineTo(-0.06, -0.24)
  blade.lineTo(-0.04, 0.02)
  const bladeGeo = kit.tracker.track(new THREE.ExtrudeGeometry(blade, { depth: 0.016, bevelEnabled: false, curveSegments: 12 }))
  part(glaive, bladeGeo, mat.steel!, [0, 0, -0.008], [1, 1, 1])
  // 龍口吞口與紅纓
  part(glaive, geo.sphere, mat.gold!, [0, 0.03, 0], [0.065, 0.1, 0.06])
  part(glaive, geo.sphere, mat.sash!, [-0.06, 0.14, 0], [0.045, 0.11, 0.045])

  // 頸、頭（紅臉）
  part(g, geo.cyl, mat.redFace!, [0, shoulderY + 0.06, 0], [0.09, 0.12, 0.09])
  const headY = shoulderY + 0.3
  part(g, geo.hiSphere, mat.redFace!, [0, headY, 0.01], [0.2, 0.24, 0.21])
  // 臥蠶眉、丹鳳眼、鼻
  for (const side of [-1, 1]) {
    part(g, geo.box, mat.beard!, [side * 0.075, headY + 0.07, 0.19], [0.1, 0.028, 0.025], [0, side * 0.3, side * -0.28])
    part(g, geo.box, mat.beard!, [side * 0.075, headY + 0.025, 0.195], [0.075, 0.011, 0.012], [0, side * 0.3, side * -0.32])
  }
  part(g, geo.sphere, mat.redFace!, [0, headY - 0.03, 0.215], [0.033, 0.06, 0.04])
  // 五綹長髯：自下巴往前下方垂在胸甲外（胸甲前緣約 z=0.31，旋轉 x 為負值才會往前）
  for (const [dx, len, tilt] of [[0, 0.8, 0], [-0.07, 0.66, -0.1], [0.07, 0.66, 0.1], [-0.13, 0.44, -0.18], [0.13, 0.44, 0.18]] as const) {
    part(g, kit.geo.beard, mat.beard!, [dx, headY - 0.13, 0.2], [1.25, len, 1.25], [-0.32, 0, tilt])
  }
  // 綠色幞頭、金箍、後翅與紅纓
  part(g, geo.sphere, mat.green!, [0, headY + 0.12, -0.01], [0.215, 0.17, 0.22])
  part(g, geo.cyl, mat.gold!, [0, headY + 0.1, 0], [0.218, 0.055, 0.226])
  part(g, geo.box, mat.green!, [0, headY + 0.2, -0.13], [0.3, 0.2, 0.1])
  part(g, geo.cyl, mat.gold!, [0, headY + 0.27, 0.09], [0.012, 0.08, 0.012])
  part(g, geo.sphere, mat.sash!, [0, headY + 0.33, 0.1], [0.05, 0.06, 0.05])
  return g
}

const BUILDERS: Record<StatueId, (kit: Kit) => THREE.Group> = {
  buddha: buildBuddha,
  guanyin: buildGuanyin,
  guangong: buildGuangong,
}

export function buildStatue(kit: Kit, id: StatueId): THREE.Group {
  return BUILDERS[id](kit)
}

/**
 * 以寫實 glTF 模型替換神像（預留給正式素材）。
 *
 * 模型規格：原點在底座底面中心、面向 +z、Y 軸朝上；載入後依 STATUE_HEIGHT 等比縮放到相同高度。
 * 建議：每尊 3～5 萬面、KTX2 壓縮貼圖、烘焙光照；放在 R2 並設定 CORS。
 * GLTFLoader 以動態 import 載入，未使用時不增加主程式大小。
 * 回傳新模型的擁有權交給呼叫端，替換掉的程序化模型由原 tracker 釋放。
 */
export async function loadStatueModel(slot: THREE.Group, id: StatueId, url: string): Promise<THREE.Object3D> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const gltf = await new GLTFLoader().loadAsync(url)
  const model = gltf.scene
  const box = new THREE.Box3().setFromObject(model)
  const height = box.max.y - box.min.y
  if (height > 0) model.scale.setScalar(STATUE_HEIGHT[id] / height)
  model.position.y = -box.min.y * model.scale.y
  slot.clear()
  slot.add(model)
  return model
}
