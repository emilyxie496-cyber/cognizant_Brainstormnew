/*
  Procedural models for the Command Center hero scene. Everything is built in
  code, with textures painted on canvases, so no model files are downloaded.
  Each vehicle faces +x and sits with its base at y = 0.

  A real model file can replace any of these: see public/models/README.md.
*/
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// Scene colours, taken from the workspace theme in index.css.
export const C = {
  hull: '#232b63',
  boot: '#a83a55',
  deck: '#2a3768',
  white: '#ecebf7',
  violet: '#6a5af9',
  violetDark: '#4a3dd0',
  lilac: '#c4bbff',
  steel: '#3a4a82',
  dark: '#0d1330',
  warm: '#ffd58a',
  orange: '#e8743b',
}

const CONTAINER_COLOURS = ['#6a5af9', '#8b7bff', '#5546d6', '#4a5a96', '#3f86b5', '#c2536b', '#b8aeff', '#d9a441', '#e9e6ff', '#34406f', '#7a3e52', '#2f7d76']

/* ---------- Materials ---------- */

const flat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.08, ...options })
/** Glossy painted metal with a clear coat, for bodywork. */
const paint = (color, options = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.4, metalness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.22, ...options })
const chrome = () => new THREE.MeshStandardMaterial({ color: '#dfe3f5', roughness: 0.16, metalness: 1 })
const glass = () => new THREE.MeshPhysicalMaterial({ color: '#080c20', roughness: 0.06, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.05 })
const rubber = () => new THREE.MeshStandardMaterial({ color: '#0a0c15', roughness: 0.93, metalness: 0 })
const glow = (color, intensity = 3) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity })

/* ---------- Textures painted on canvases ---------- */

function canvasTexture(width, height, draw, { repeat = [1, 1], colour = true } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(canvas.getContext('2d'), width, height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(...repeat)
  texture.anisotropy = 8
  if (colour) texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Small seeded generator so details look the same on every visit. */
function seeded(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Height map of pressed steel ribs: one rib per tile. `across` turns the ribs to run sideways. */
function ribs(repeat, across = false) {
  return canvasTexture(across ? 4 : 32, across ? 32 : 4, (ctx, w, h) => {
    const g = across ? ctx.createLinearGradient(0, 0, 0, h) : ctx.createLinearGradient(0, 0, w, 0)
    ;[[0, '#000'], [0.22, '#fff'], [0.5, '#fff'], [0.72, '#000'], [1, '#000']].forEach(([stop, c]) => g.addColorStop(stop, c))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }, { repeat, colour: false })
}

/** Streaks and speckle that multiply the paint colour, so surfaces look used. */
function grime(seed, strength = 1) {
  const random = seeded(seed)
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(40,34,52,${(0.03 + random() * 0.09) * strength})`
      ctx.fillRect(random() * w, random() * h * 0.6, 1 + random() * 3, 30 + random() * 160)
    }
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(30,26,44,${random() * 0.1 * strength})`
      ctx.fillRect(random() * w, random() * h, 2, 2)
    }
    const shade = ctx.createLinearGradient(0, 0, 0, h)
    shade.addColorStop(0.7, 'rgba(20,18,36,0)')
    shade.addColorStop(1, `rgba(20,18,36,${0.22 * strength})`)
    ctx.fillStyle = shade
    ctx.fillRect(0, 0, w, h)
  })
}

/** A wall of windows, some lit. Returns the colour map and the matching glow map. */
function windowWall(cols, rows, seed, wall = '#e6e3f6') {
  const random = seeded(seed)
  const lit = Array.from({ length: cols * rows }, () => random() < 0.45)
  const drawWindows = (ctx, w, h, glowOnly) => {
    ctx.fillStyle = glowOnly ? '#000' : wall
    ctx.fillRect(0, 0, w, h)
    const cw = w / cols
    const rh = h / rows
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const on = lit[r * cols + c]
        ctx.fillStyle = on ? '#ffd9a0' : glowOnly ? '#000' : '#141a3d'
        ctx.fillRect(c * cw + cw * 0.22, r * rh + rh * 0.3, cw * 0.56, rh * 0.38)
      }
    }
    if (!glowOnly) {
      ctx.fillStyle = 'rgba(40,36,70,0.16)'
      for (let r = 1; r < rows; r++) ctx.fillRect(0, r * rh - 1, w, 2)
    }
  }
  return {
    map: canvasTexture(256, 256, (ctx, w, h) => drawWindows(ctx, w, h, false)),
    emissiveMap: canvasTexture(256, 256, (ctx, w, h) => drawWindows(ctx, w, h, true)),
  }
}

/** Lettering on a transparent plane, facing +z. */
function lettering(text, width, height, colour = '#f1eeff') {
  const map = canvasTexture(1024, Math.round((1024 * height) / width), (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = colour
    ctx.font = `800 ${Math.round(h * 0.78)}px "Manrope Variable", "Inter Variable", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2 + h * 0.04, w * 0.96)
  })
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.5, metalness: 0.1, depthWrite: false }))
}

/* ---------- Shape helpers ---------- */

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  return mesh
}

function rounded(w, h, d, radius, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material)
  mesh.position.set(x, y, z)
  return mesh
}

/** A cylinder whose length runs along the given axis. */
function cyl(radius, length, material, axis = 'y', segments = 24, x = 0, y = 0, z = 0) {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, segments)
  if (axis === 'x') geometry.rotateZ(Math.PI / 2)
  if (axis === 'z') geometry.rotateX(Math.PI / 2)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(x, y, z)
  return mesh
}

/** A side profile ([x, y] points) pushed across the vehicle's width, centred on z = 0. */
function profile(points, width, material, bevel = 0.06) {
  const shape = new THREE.Shape()
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)))
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3 })
  geometry.translate(0, 0, -(width - bevel * 2) / 2)
  return new THREE.Mesh(geometry, material)
}

/**
 * Skins a wing-like surface through sections: { x: leading edge, y, z, chord, thick }.
 * Each section is a rounded-nose, thin-tailed aerofoil.
 */
function loft(sections, mirror = false) {
  const RING = 14
  const positions = []
  sections.forEach((s) => {
    for (let i = 0; i < RING; i++) {
      const a = (i / RING) * Math.PI * 2
      const along = (1 - Math.cos(a)) / 2
      const t = (Math.sin(a) * s.thick * (1 - along * 0.8)) / 2
      positions.push(s.x - along * s.chord, s.y + t, mirror ? -s.z : s.z)
    }
  })
  const index = []
  for (let s = 0; s < sections.length - 1; s++) {
    for (let i = 0; i < RING; i++) {
      const a = s * RING + i
      const b = s * RING + ((i + 1) % RING)
      index.push(a, a + RING, b, b, a + RING, b + RING)
    }
  }
  const last = (sections.length - 1) * RING
  for (let i = 1; i < RING - 1; i++) index.push(last, last + i, last + i + 1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** Coloured, ribbed shipping containers drawn in one call. `items` is [{ x, y, z }]. */
function containers(items, size, random) {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.58, metalness: 0.3, bumpMap: ribs([Math.round(size[0] * 6), 1]), bumpScale: 2.2, map: grime(5) })
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(...size), material, items.length)
  const m = new THREE.Matrix4()
  const colour = new THREE.Color()
  items.forEach((item, i) => {
    m.setPosition(item.x, item.y, item.z)
    mesh.setMatrixAt(i, m)
    colour.set(CONTAINER_COLOURS[Math.floor(random() * CONTAINER_COLOURS.length)]).offsetHSL(0, -0.05, (random() - 0.5) * 0.07)
    mesh.setColorAt(i, colour)
  })
  return mesh
}

/** Posts and two rails along x at a fixed z. */
function railing(group, x0, x1, y, z, material, height = 0.5) {
  const length = x1 - x0
  group.add(box(length, 0.03, 0.03, material, x0 + length / 2, y + height, z))
  group.add(box(length, 0.02, 0.02, material, x0 + length / 2, y + height * 0.5, z))
  const posts = Math.max(2, Math.round(length / 0.9))
  for (let i = 0; i <= posts; i++) group.add(box(0.03, height, 0.03, material, x0 + (length * i) / posts, y + height / 2, z))
}

/** A road tyre on a metal rim, turning about z. `dual` adds a second tyre beside it. */
function roadWheel(radius, width, materials, dual = 0) {
  const wheel = new THREE.Group()
  const half = width / 2
  const tyreProfile = [
    [radius * 0.6, -half], [radius * 0.93, -half], [radius, -half * 0.72], [radius, half * 0.72], [radius * 0.93, half], [radius * 0.6, half],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const tyreGeometry = new THREE.LatheGeometry(tyreProfile, 28)
  tyreGeometry.rotateX(Math.PI / 2)
  const rimGeometry = new THREE.CylinderGeometry(radius * 0.61, radius * 0.61, width * 0.82, 20)
  rimGeometry.rotateX(Math.PI / 2)
  const offsets = dual ? [0, dual] : [0]
  offsets.forEach((dz) => {
    const tyre = new THREE.Mesh(tyreGeometry, materials.rubber)
    tyre.position.z = dz
    const rim = new THREE.Mesh(rimGeometry, materials.rim)
    rim.position.z = dz
    wheel.add(tyre, rim)
  })
  const hub = cyl(radius * 0.22, width * 1.05 + Math.abs(dual), materials.hub, 'z', 10, 0, 0, dual / 2)
  wheel.add(hub)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const nut = cyl(radius * 0.045, width * 0.9, materials.hub, 'z', 6, Math.cos(a) * radius * 0.36, Math.sin(a) * radius * 0.36, 0)
    wheel.add(nut)
  }
  return wheel
}

/* ---------- Ship ---------- */

const HULL = { length: 17, beam: 2.75, bottom: -1.6, top: 3 }

/** One horizontal slice of the hull. Slices are stacked so the sides curve in toward the keel and the bow rakes. */
function hullSlice(y0, y1, inset = 0) {
  const L = HULL.length
  const B = HULL.beam - inset
  const shape = new THREE.Shape()
  shape.moveTo(-L, -B * 0.78)
  shape.quadraticCurveTo(-L + 0.2, -B, -L + 1.6, -B)
  shape.lineTo(6.5, -B)
  shape.bezierCurveTo(11, -B, 14.5, -B * 0.55, L, 0)
  shape.bezierCurveTo(14.5, B * 0.55, 11, B, 6.5, B)
  shape.lineTo(-L + 1.6, B)
  shape.quadraticCurveTo(-L + 0.2, B, -L, B * 0.78)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 28 })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, y0, 0)
  const p = geometry.attributes.position
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - HULL.bottom) / (HULL.top - HULL.bottom), 0, 1)
    let x = p.getX(i)
    if (x > 6.5) x -= Math.pow(1 - t, 1.4) * 3.1 * ((x - 6.5) / 10.5)
    if (x < -14.5) x += Math.pow(1 - t, 1.2) * 1.8 * ((-14.5 - x) / 2.5)
    p.setX(i, x)
    p.setZ(i, p.getZ(i) * (0.6 + 0.4 * Math.pow(t, 0.55)))
  }
  geometry.computeVertexNormals()
  return geometry
}

export function buildShip() {
  const ship = new THREE.Group()
  const random = seeded(7)
  const deckY = HULL.top + 0.14
  const steel = flat(C.steel, { metalness: 0.5, roughness: 0.5 })
  const white = paint(C.white, { roughness: 0.5, clearcoat: 0.3 })

  // Hull: anti-fouling red below the waterline, dark paint above.
  const boot = paint(C.boot, { roughness: 0.6, clearcoat: 0.2 })
  const sides = paint(C.hull, { roughness: 0.42, clearcoat: 0.5 })
  ;[[HULL.bottom, -0.6, boot], [-0.6, 0.8, boot], [0.8, 1.9, sides], [1.9, HULL.top, sides]].forEach(([y0, y1, material]) => {
    ship.add(new THREE.Mesh(hullSlice(y0, y1), material))
  })
  ship.add(new THREE.Mesh(hullSlice(HULL.top, HULL.top + 0.12), paint(C.white, { roughness: 0.5 })))
  ship.add(new THREE.Mesh(hullSlice(HULL.top + 0.12, deckY, 0.2), flat('#3b2a3f', { roughness: 0.9 })))
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), boot)
  bulb.scale.set(2.3, 0.85, 0.85)
  bulb.position.set(14.6, -0.75, 0)
  ship.add(bulb)

  // Company name along both sides. The plating leans inward, so the lettering leans with it.
  for (const side of [-1, 1]) {
    const name = lettering('WAYMARK', 9.5, 1.15)
    name.position.set(-2, 1.95, side * 2.65)
    name.rotation.set(side * 0.15, side < 0 ? Math.PI : 0, 0)
    ship.add(name)
  }

  // Cargo: fewer rows and tiers toward the bow, where the hull narrows.
  const size = [2.32, 0.82, 0.8]
  const stacks = []
  const bays = []
  for (let x = -8.6; x <= 11.5; x += 2.5) {
    const rows = x > 10.5 ? 2 : x > 8 ? 4 : 6
    const maxTiers = x > 8 ? 3 : 5
    bays.push({ x, rows })
    for (let r = 0; r < rows; r++) {
      const tiers = Math.max(2, maxTiers - Math.floor(random() * 2.4))
      for (let t = 0; t < tiers; t++) {
        stacks.push({ x, y: deckY + 0.1 + size[1] / 2 + t * (size[1] + 0.025), z: (r - (rows - 1) / 2) * 0.86 })
      }
    }
  }
  ship.add(containers(stacks, size, random))
  // Hatch covers under the cargo and lashing bridges between the bays.
  bays.forEach(({ x, rows }, i) => {
    ship.add(box(2.4, 0.1, rows * 0.86 + 0.1, steel, x, deckY + 0.05, 0))
    if (i && rows === 6) {
      const gap = x - 1.25
      for (const z of [-2.45, 2.45]) ship.add(box(0.1, 3.3, 0.1, steel, gap, deckY + 1.65, z))
      for (const y of [1.2, 2.3, 3.3]) ship.add(box(0.08, 0.08, 4.9, steel, gap, deckY + y, 0))
    }
  })

  // Accommodation block: lit cabin windows on every level.
  const cabins = windowWall(9, 5, 11)
  const cabinWall = new THREE.MeshStandardMaterial({ ...cabins, color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.5, roughness: 0.55 })
  ship.add(box(4.4, 1.9, 5.1, white, -13.2, deckY + 0.95, 0))
  ship.add(box(3.2, 3.8, 4.4, cabinWall, -13.4, deckY + 3.8, 0))
  ship.add(box(3.5, 0.1, 4.8, white, -13.4, deckY + 5.72, 0))
  // Wheelhouse with a full-width band of glass and open bridge wings.
  ship.add(box(2.7, 0.95, 4.6, white, -13.1, deckY + 6.25, 0))
  ship.add(box(0.06, 0.5, 4.4, glass(), -11.74, deckY + 6.35, 0))
  ship.add(box(2.2, 0.5, 4.64, glass(), -13, deckY + 6.35, 0))
  ship.add(box(0.05, 0.3, 4.2, glow(C.warm, 1.2), -11.76, deckY + 6.3, 0))
  ship.add(box(1.9, 0.1, 6.6, white, -12.9, deckY + 5.78, 0))
  ship.add(box(3, 0.12, 4.9, white, -13.1, deckY + 6.78, 0))
  for (const side of [-1, 1]) {
    railing(ship, -13.8, -12, deckY + 5.83, side * 3.25, steel, 0.42)
    ship.add(box(0.03, 0.42, 1.0, steel, -12, deckY + 6.04, side * 2.76))
    railing(ship, -15.2, -11.3, deckY + 1.9, side * 2.5, steel, 0.4)
  }

  // Funnel, masts, radar and aerials.
  ship.add(rounded(1.7, 2.6, 1.9, 0.3, paint(C.dark, { roughness: 0.5 }), -15.4, deckY + 3.3, 0))
  ship.add(rounded(1.74, 0.6, 1.94, 0.25, paint(C.violet), -15.4, deckY + 3.9, 0))
  for (const z of [-0.35, 0.35]) ship.add(cyl(0.16, 0.7, flat('#06070f'), 'y', 12, -15.5, deckY + 4.9, z))
  ship.add(cyl(0.09, 2.7, steel, 'y', 8, -13.2, deckY + 8.2, 0))
  ship.add(box(0.1, 0.1, 2.2, steel, -13.2, deckY + 8.6, 0))
  ship.add(box(0.08, 0.08, 1.4, steel, -13.2, deckY + 9.1, 0))
  const radar = box(0.08, 0.12, 1.5, white, -12.9, deckY + 7.25, 0.9)
  ship.add(radar, cyl(0.06, 0.4, steel, 'y', 8, -12.9, deckY + 7, 0.9))
  ship.add(cyl(0.02, 1.6, steel, 'y', 6, -13.9, deckY + 7.6, -1.6), cyl(0.02, 1.2, steel, 'y', 6, -13.9, deckY + 7.4, 1.7))
  ship.userData.radar = radar

  // Free-fall lifeboat on its ramp at the stern.
  const lifeboat = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.5, 6, 14), paint(C.orange, { roughness: 0.5 }))
  lifeboat.rotation.z = Math.PI / 2 + 0.38
  lifeboat.position.set(-16.3, deckY + 1.5, 1.2)
  ship.add(lifeboat)
  const ramp = box(2.6, 0.08, 1.1, steel, -16.2, deckY + 0.95, 1.2)
  ramp.rotation.z = 0.38
  ship.add(ramp)

  // Forecastle: breakwater, windlasses, foremast and rails.
  const breakwater = box(0.12, 0.9, 3.4, steel, 12.9, deckY + 0.45, 0)
  ship.add(breakwater)
  for (const z of [-0.7, 0.7]) ship.add(cyl(0.22, 0.6, steel, 'z', 12, 14.4, deckY + 0.3, z))
  ship.add(cyl(0.07, 2.6, steel, 'y', 8, 15.3, deckY + 1.3, 0))
  for (const side of [-1, 1]) railing(ship, -11, 6.5, deckY, side * 2.62, steel, 0.42)
  for (const side of [-1, 1]) ship.add(box(0.5, 0.36, 0.08, flat('#06070f'), 14.4, 2.1, side * 1.06))

  // Navigation lights.
  const lamp = new THREE.SphereGeometry(0.1, 10, 8)
  ;[
    [-13.2, deckY + 9.6, 0, '#ffffff'],
    [15.3, deckY + 2.65, 0, '#ffffff'],
    [-12.4, deckY + 6.5, 3.3, '#34d399'],
    [-12.4, deckY + 6.5, -3.3, '#fb7185'],
  ].forEach(([x, y, z, colour]) => {
    const light = new THREE.Mesh(lamp, glow(colour, 6))
    light.position.set(x, y, z)
    ship.add(light)
  })
  for (let x = -8; x <= 10; x += 4.5) {
    for (const z of [-2.5, 2.5]) {
      const flood = new THREE.Mesh(lamp, glow(C.warm, 3.5))
      flood.scale.setScalar(0.7)
      flood.position.set(x - 1.25, deckY + 3.4, z)
      ship.add(flood)
    }
  }
  const deckLight = new THREE.PointLight(C.warm, 30, 18, 1.6)
  deckLight.position.set(-10.4, deckY + 5.4, 0)
  ship.add(deckLight)

  return ship
}

/* ---------- Airplane ---------- */

const FUSELAGE = { nose: 10.4, length: 21, radius: 1.5 }

/** Paint job wrapped around the fuselage: u runs around the body, s from nose (0) to tail (1). */
function fuselageSkin(glowOnly) {
  const random = seeded(31)
  return canvasTexture(1024, 2048, (ctx, w, h) => {
    const Y = (s) => h * (1 - s)
    const band = (u0, u1, s0, s1, fill) => {
      ctx.fillStyle = fill
      ctx.fillRect(u0 * w, Y(s1), (u1 - u0) * w, Y(s0) - Y(s1))
    }
    ctx.fillStyle = glowOnly ? '#000' : '#f3f1fb'
    ctx.fillRect(0, 0, w, h)
    if (!glowOnly) {
      band(0.07, 0.43, 0, 1, '#cfcbe6') // belly
      // Tail livery: a violet sweep that starts earlier along the top of the body.
      ctx.fillStyle = '#5b4be8'
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(w, 0)
      for (let i = 20; i >= 0; i--) {
        const u = i / 20
        ctx.lineTo(u * w, Y(0.8 - 0.09 * Math.cos((u - 0.75) * Math.PI * 2)))
      }
      ctx.closePath()
      ctx.fill()
      band(0.018, 0.04, 0.05, 0.9, '#6a5af9') // cheat lines under the windows
      band(0.46, 0.482, 0.05, 0.9, '#6a5af9')
      band(0.6, 0.9, 0.052, 0.082, '#090d22') // flight-deck glazing
      ctx.fillStyle = '#d9d6ea'
      for (const u of [0.69, 0.75, 0.81]) ctx.fillRect(u * w - 2, Y(0.082), 4, Y(0.052) - Y(0.082))
      ctx.strokeStyle = 'rgba(60,56,96,0.55)'
      ctx.lineWidth = 3
      for (const s of [0.13, 0.46, 0.79]) {
        for (const u of [0.955, 0.53]) ctx.strokeRect((u - 0.02) * w, Y(s + 0.04), 0.045 * w, Y(s) - Y(s + 0.04))
      }
    }
    // Cabin windows on both sides, most of them lit.
    for (let s = 0.17; s < 0.77; s += 0.0118) {
      for (const u of [0.9626, 0.5374]) {
        const lit = random() < 0.8
        ctx.fillStyle = glowOnly ? (lit ? '#ffdcae' : '#000') : lit ? '#ffe2b8' : '#12173a'
        ctx.beginPath()
        ctx.roundRect(u * w - 11, Y(s) - 7, 22, 14, 5)
        ctx.fill()
      }
    }
  })
}

export function buildPlane() {
  const plane = new THREE.Group()
  const white = paint('#f1eff9', { roughness: 0.32, clearcoat: 0.9 })
  const violet = paint(C.violet, { roughness: 0.34, clearcoat: 0.9 })
  const metal = chrome()

  // Fuselage: a smooth body of revolution, with the tail swept up and the nose drooped.
  const POINTS = 64
  const { nose, length, radius } = FUSELAGE
  const outline = []
  for (let i = 0; i <= POINTS; i++) {
    const s = i / POINTS
    let r = radius
    if (s < 0.15) r = radius * Math.pow(1 - Math.pow(1 - s / 0.15, 2), 0.55)
    if (s > 0.62) r = radius * (1 - 0.9 * Math.pow((s - 0.62) / 0.38, 1.7))
    outline.push(new THREE.Vector2(Math.max(r, 0.001), nose - length * s))
  }
  const body = new THREE.LatheGeometry(outline, 40)
  body.rotateZ(-Math.PI / 2)
  const bp = body.attributes.position
  for (let i = 0; i < bp.count; i++) {
    const s = (nose - bp.getX(i)) / length
    let lift = 0
    if (s > 0.62) lift = 1.05 * Math.pow((s - 0.62) / 0.38, 2)
    if (s < 0.15) lift = -0.3 * Math.pow(1 - s / 0.15, 2)
    bp.setY(i, bp.getY(i) + lift)
  }
  body.computeVertexNormals()
  plane.add(new THREE.Mesh(body, new THREE.MeshPhysicalMaterial({ map: fuselageSkin(false), emissive: '#ffffff', emissiveMap: fuselageSkin(true), emissiveIntensity: 1.6, roughness: 0.32, metalness: 0.15, clearcoat: 0.9, clearcoatRoughness: 0.2 })))

  // Wing-to-body fairing.
  const fairing = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), white)
  fairing.scale.set(4.2, 0.75, 1.75)
  fairing.position.set(0.2, -1, 0)
  plane.add(fairing)

  const wingSkin = new THREE.MeshPhysicalMaterial({ color: '#e7e5f2', roughness: 0.35, metalness: 0.35, clearcoat: 0.6, side: THREE.DoubleSide })
  const violetSkin = new THREE.MeshPhysicalMaterial({ color: C.violet, roughness: 0.34, metalness: 0.15, clearcoat: 0.9, side: THREE.DoubleSide })
  for (const mirror of [false, true]) {
    const side = mirror ? -1 : 1
    // Main wing: swept, tapered and angled upward toward the tip.
    plane.add(new THREE.Mesh(loft([
      { x: 3.4, y: -0.95, z: 0.6, chord: 6.6, thick: 0.62 },
      { x: 1.3, y: -0.78, z: 4.4, chord: 4, thick: 0.4 },
      { x: -3.3, y: -0.2, z: 11.6, chord: 1.55, thick: 0.16 },
    ], mirror), wingSkin))
    plane.add(new THREE.Mesh(loft([
      { x: -3.3, y: -0.2, z: 11.6, chord: 1.55, thick: 0.14 },
      { x: -3.9, y: 0.35, z: 12.05, chord: 1.2, thick: 0.1 },
      { x: -4.7, y: 1.75, z: 12.3, chord: 0.6, thick: 0.06 },
    ], mirror), violetSkin))
    plane.add(new THREE.Mesh(loft([
      { x: -7.1, y: 0.75, z: 0.3, chord: 2.9, thick: 0.26 },
      { x: -9.5, y: 1.0, z: 4.7, chord: 1.15, thick: 0.1 },
    ], mirror), wingSkin))

    // Engine: shaped cowling, fan face, exhaust cone and pylon.
    const cowl = [[0.58, 1.55], [0.72, 1.45], [0.8, 1.05], [0.82, 0.3], [0.74, -0.7], [0.6, -1.35], [0.52, -1.5]].map(([r, y]) => new THREE.Vector2(r, y))
    const nacelle = new THREE.LatheGeometry(cowl, 28)
    nacelle.rotateZ(-Math.PI / 2)
    const ex = 1.5
    const ey = -1.72
    const ez = side * 4.3
    const engine = new THREE.Mesh(nacelle, new THREE.MeshPhysicalMaterial({ color: C.violetDark, roughness: 0.3, metalness: 0.3, clearcoat: 0.9, side: THREE.DoubleSide }))
    engine.position.set(ex, ey, ez)
    plane.add(engine)
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.08, 10, 28), metal)
    lip.rotation.y = Math.PI / 2
    lip.position.set(ex + 1.5, ey, ez)
    plane.add(lip)
    plane.add(cyl(0.6, 0.06, flat('#05060d', { roughness: 0.4, metalness: 0.6 }), 'x', 24, ex + 1.15, ey, ez))
    plane.add(cyl(0.16, 0.5, metal, 'x', 12, ex + 1.3, ey, ez))
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.1, 18), metal)
    cone.rotation.z = Math.PI / 2
    cone.position.set(ex - 1.75, ey, ez)
    plane.add(cone)
    plane.add(profile([[ex + 0.9, ey + 0.7], [ex - 1.4, ey + 0.55], [ex - 2.2, -0.85], [ex + 0.4, -0.8]], 0.2, white, 0.04).translateZ(ez))

    // Flap-track fairings under the wing.
    for (const z of [3, 6.2, 8.8]) {
      const track = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 1.5, 4, 8), white)
      track.rotation.z = Math.PI / 2
      track.position.set(-0.4 - z * 0.42, -1.0 + z * 0.065, side * z)
      plane.add(track)
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), glow(side > 0 ? '#34d399' : '#fb7185', 7))
    tip.position.set(-3.5, -0.18, side * 11.65)
    plane.add(tip)
    const landing = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glow('#ffffff', 7))
    landing.position.set(2.6, -0.95, side * 1.7)
    plane.add(landing)
  }

  // Fin: lofted along z, then stood upright.
  const fin = loft([
    { x: -5.6, y: 0, z: 1.3, chord: 4.6, thick: 0.34 },
    { x: -9.4, y: 0, z: 6, chord: 1.7, thick: 0.14 },
  ])
  fin.rotateX(-Math.PI / 2)
  plane.add(new THREE.Mesh(fin, violetSkin))

  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow('#ffffff', 9))
  strobe.position.set(-10.3, 6.05, 0)
  plane.add(strobe)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), glow('#ff4d5e', 8))
  beacon.position.set(1, 1.55, 0)
  plane.add(beacon)
  plane.userData.strobe = strobe
  plane.userData.beacon = beacon

  return plane
}

/* ---------- Train ---------- */

const RAIL_WHEEL = 0.42

/** A three-axle freight bogie with flanged steel wheels. */
function bogie(group, wheels, x, materials) {
  group.add(box(3.5, 0.3, 0.16, materials.frame, x, RAIL_WHEEL + 0.05, 0.92))
  group.add(box(3.5, 0.3, 0.16, materials.frame, x, RAIL_WHEEL + 0.05, -0.92))
  group.add(box(1.2, 0.3, 1.9, materials.frame, x, RAIL_WHEEL + 0.25, 0))
  for (const dx of [-1.15, 0, 1.15]) {
    group.add(cyl(0.07, 1.9, materials.steel, 'z', 8, x + dx, RAIL_WHEEL, 0))
    for (const z of [-0.78, 0.78]) {
      const wheel = new THREE.Group()
      wheel.add(cyl(RAIL_WHEEL, 0.14, materials.steel, 'z', 24))
      wheel.add(cyl(RAIL_WHEEL + 0.06, 0.03, materials.steel, 'z', 24, 0, 0, z > 0 ? -0.08 : 0.08))
      wheel.add(box(0.5, 0.08, 0.16, materials.frame))
      wheel.position.set(x + dx, RAIL_WHEEL, z)
      group.add(wheel)
      wheels.push(wheel)
    }
    for (const z of [-0.95, 0.95]) group.add(cyl(0.11, 0.2, materials.frame, 'y', 8, x + dx, RAIL_WHEEL + 0.32, z))
  }
}

export function buildTrain() {
  const train = new THREE.Group()
  const wheels = []
  const random = seeded(21)
  const materials = { steel: new THREE.MeshStandardMaterial({ color: '#8a90a8', roughness: 0.35, metalness: 0.9 }), frame: flat('#10142c', { roughness: 0.7, metalness: 0.4 }) }
  const floor = RAIL_WHEEL * 2 + 0.25
  const bodyPaint = paint(C.white, { roughness: 0.4 })
  const accent = paint(C.violet, { roughness: 0.36 })
  const dark = flat('#0c1026', { roughness: 0.6, metalness: 0.4 })
  const rail = flat('#c9cfe6', { metalness: 0.8, roughness: 0.3 })

  // Diesel freight locomotive, front at x = 14.4.
  const loco = new THREE.Group()
  loco.add(box(10.6, 0.3, 2.9, dark, 9.1, floor + 0.15, 0)) // walkway deck
  // Long hood, narrower than the cab so the walkways show.
  loco.add(rounded(6.6, 2.5, 2.1, 0.12, bodyPaint, 7.2, floor + 1.55, 0))
  loco.add(box(6.64, 0.5, 2.14, accent, 7.2, floor + 0.75, 0))
  // Cab and short nose from one side profile.
  loco.add(profile([[10.5, floor + 0.3], [14.3, floor + 0.3], [14.3, floor + 1.75], [13.4, floor + 1.95], [12.75, floor + 3.2], [10.7, floor + 3.3], [10.5, floor + 3.1]], 2.9, accent, 0.07))
  const windshield = box(0.06, 1.15, 2.3, glass(), 13.1, floor + 2.58, 0)
  windshield.rotation.z = 0.48
  loco.add(windshield)
  loco.add(box(0.05, 1.2, 0.08, accent, 13.12, floor + 2.58, 0))
  loco.add(box(1.4, 0.75, 2.94, glass(), 11.7, floor + 2.65, 0))
  loco.add(box(0.5, 0.2, 1.2, glow('#ffffff', 0.45), 13.42, floor + 3.05, 0)) // number board
  // Radiator section, grilles, fans and exhaust on the hood.
  loco.add(box(2.2, 0.5, 2.5, bodyPaint, 4.9, floor + 2.75, 0))
  const grille = new THREE.MeshStandardMaterial({ color: '#141933', roughness: 0.5, metalness: 0.6, bumpMap: ribs([1, 14], true), bumpScale: 3 })
  loco.add(box(2.6, 1.3, 2.13, grille, 5.2, floor + 1.9, 0))
  loco.add(box(1.5, 1.0, 2.13, grille, 8.6, floor + 2, 0))
  for (const x of [4.4, 5.5]) loco.add(cyl(0.42, 0.08, dark, 'y', 20, x, floor + 3.03, 0))
  loco.add(box(0.5, 0.4, 0.9, dark, 7.6, floor + 2.95, 0))
  loco.add(box(0.9, 0.2, 0.3, rail, 11.6, floor + 3.42, 0)) // horn
  // Handrails along both walkways and across the nose.
  for (const side of [-1, 1]) railing(loco, 4, 10.5, floor + 0.3, side * 1.38, rail, 0.95)
  loco.add(box(0.03, 0.9, 2.6, rail, 14.35, floor + 0.75, 0))
  // Fuel tank, air tanks, plough and coupler.
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 3, 6, 16), dark)
  tank.rotation.z = Math.PI / 2
  tank.scale.z = 2.2
  tank.position.set(9, RAIL_WHEEL + 0.2, 0)
  loco.add(tank)
  const plough = box(0.12, 0.7, 2.7, accent, 14.55, 0.52, 0)
  plough.rotation.z = -0.35
  loco.add(plough)
  loco.add(box(0.7, 0.22, 0.3, dark, 14.75, floor - 0.1, 0))
  // Headlight, ditch lights and marker lights.
  loco.add(box(0.06, 0.2, 0.5, glow('#fff4d6', 3.2), 14.34, floor + 1.45, 0))
  for (const z of [-1, 1]) loco.add(cyl(0.11, 0.06, glow('#fff4d6', 3.2), 'x', 12, 14.36, floor + 0.55, z))
  for (const z of [-1.2, 1.2]) loco.add(cyl(0.05, 0.05, glow('#ff4d5e', 4), 'x', 8, 14.36, floor + 1.55, z))
  bogie(loco, wheels, 12.2, materials)
  bogie(loco, wheels, 6, materials)
  const headlamp = new THREE.SpotLight('#fff1cf', 90, 60, 0.36, 0.7, 1.3)
  headlamp.position.set(14.4, floor + 1.4, 0)
  headlamp.target.position.set(44, 0, 0)
  loco.add(headlamp, headlamp.target)
  train.add(loco)

  // Three well wagons carrying containers stacked two high.
  const cargo = []
  for (let w = 0; w < 3; w++) {
    const centre = -2.3 - w * 11.6
    train.add(box(10.9, 0.22, 2.5, dark, centre, floor + 0.05, 0))
    for (const side of [-1, 1]) train.add(box(10.9, 0.5, 0.12, flat(C.steel, { metalness: 0.5 }), centre, floor + 0.3, side * 1.22))
    train.add(box(0.6, 0.2, 0.3, dark, centre + 5.7, floor - 0.1, 0))
    for (const dx of [3.9, -3.9]) {
      train.add(box(2.6, 0.26, 1.9, materials.frame, centre + dx, RAIL_WHEEL + 0.22, 0))
      for (const ax of [-0.75, 0.75]) {
        train.add(cyl(0.07, 1.9, materials.steel, 'z', 8, centre + dx + ax, RAIL_WHEEL, 0))
        for (const z of [-0.78, 0.78]) {
          const wheel = new THREE.Group()
          wheel.add(cyl(RAIL_WHEEL, 0.14, materials.steel, 'z', 24))
          wheel.add(box(0.5, 0.08, 0.16, materials.frame))
          wheel.position.set(centre + dx + ax, RAIL_WHEEL, z)
          train.add(wheel)
          wheels.push(wheel)
        }
      }
    }
    for (const dx of [-2.65, 2.65]) {
      cargo.push({ x: centre + dx, y: floor + 0.16 + 0.95, z: 0 })
      cargo.push({ x: centre + dx, y: floor + 0.16 + 0.95 + 1.93, z: 0 })
    }
  }
  train.add(containers(cargo, [5.1, 1.9, 2.3], random))

  train.userData.wheels = wheels
  train.userData.wheelRadius = RAIL_WHEEL
  return train
}

/* ---------- Truck ---------- */

export function buildTruck() {
  const truck = new THREE.Group()
  const wheels = []
  const R = 0.52
  const wheelMaterials = { rubber: rubber(), rim: chrome(), hub: new THREE.MeshStandardMaterial({ color: '#b9bfd6', roughness: 0.3, metalness: 1 }) }
  const cabPaint = paint(C.violet, { roughness: 0.3, clearcoat: 1 })
  const metal = chrome()
  const dark = flat('#0b0e1f', { roughness: 0.7, metalness: 0.3 })
  const floor = R * 2 + 0.08
  const amber = glow('#ffb347', 4)

  // Chassis rails.
  for (const z of [-0.45, 0.45]) truck.add(box(7.4, 0.26, 0.14, dark, 3.4, R + 0.34, z))

  // Hood, cab and sleeper from one side profile, then the roof fairing that meets the trailer.
  truck.add(profile([
    [7.0, floor + 0.1], [7.05, floor + 1.25], [6.75, floor + 1.5], [5.1, floor + 1.72], [4.45, floor + 2.95], [2.3, floor + 3.05], [2.2, floor + 0.1],
  ], 2.42, cabPaint, 0.1))
  truck.add(profile([[4.3, floor + 3.0], [3.3, floor + 3.85], [2.25, floor + 3.95], [2.25, floor + 3.0]], 2.3, cabPaint, 0.1))
  // Glazing.
  const windshield = box(0.06, 1.28, 2.1, glass(), 4.8, floor + 2.33, 0)
  windshield.rotation.z = 0.49
  truck.add(windshield)
  truck.add(box(0.05, 1.3, 0.07, cabPaint, 4.82, floor + 2.33, 0))
  truck.add(box(0.95, 0.72, 2.46, glass(), 3.85, floor + 2.4, 0))
  truck.add(box(0.5, 0.42, 2.46, glass(), 2.75, floor + 2.5, 0))
  // Grille, bumper and lights.
  truck.add(box(0.08, 1.05, 1.5, new THREE.MeshStandardMaterial({ color: '#dfe3f5', roughness: 0.2, metalness: 1, bumpMap: ribs([1, 12], true), bumpScale: 4 }), 7.1, floor + 0.78, 0))
  truck.add(rounded(0.4, 0.42, 2.56, 0.1, metal, 7.15, R + 0.12, 0))
  for (const z of [-0.98, 0.98]) {
    truck.add(rounded(0.12, 0.3, 0.42, 0.05, glow('#fff4d6', 3.2), 7.1, floor + 0.62, z))
    truck.add(cyl(0.07, 0.05, amber, 'x', 10, 7.37, R + 0.12, z * 0.9))
  }
  for (let i = -2; i <= 2; i++) truck.add(box(0.1, 0.05, 0.1, amber, 3.9, floor + 3.12, i * 0.42))
  // Mirrors, exhaust stacks, fuel tanks and steps.
  for (const side of [-1, 1]) {
    truck.add(box(0.06, 0.06, 0.5, dark, 4.75, floor + 2.5, side * 1.42))
    truck.add(rounded(0.12, 0.62, 0.3, 0.05, dark, 4.75, floor + 2.3, side * 1.66))
    truck.add(cyl(0.11, 3.3, metal, 'y', 14, 2.05, floor + 2.3, side * 1.08))
    const fuel = cyl(0.4, 1.7, metal, 'x', 22, 3.3, R + 0.3, side * 1.0)
    truck.add(fuel)
    truck.add(box(1.5, 0.06, 0.3, dark, 3.3, R + 0.78, side * 1.2))
    // Front mudguard over the steer wheel.
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.16, R + 0.16, 0.56, 20, 1, true, -Math.PI / 2, Math.PI), new THREE.MeshPhysicalMaterial({ color: C.violet, roughness: 0.3, clearcoat: 1, side: THREE.DoubleSide }))
    guard.rotation.x = Math.PI / 2
    guard.position.set(5.9, R + 0.02, side * 1.02)
    truck.add(guard)
  }
  truck.add(cyl(0.9, 0.12, dark, 'y', 24, 1.1, floor + 0.36, 0)) // fifth wheel

  // Box trailer with ribbed sides, a reflective lower rail and rear doors.
  const trailerSkin = new THREE.MeshPhysicalMaterial({ color: '#f0eef8', roughness: 0.42, metalness: 0.25, clearcoat: 0.4, bumpMap: ribs([34, 1]), bumpScale: 1.3, map: grime(9, 0.7) })
  const TX = -2.3
  truck.add(box(10.2, 3.05, 2.5, trailerSkin, TX, floor + 2.05, 0))
  truck.add(box(10.26, 0.14, 2.56, metal, TX, floor + 0.55, 0))
  truck.add(box(10.26, 0.1, 2.56, metal, TX, floor + 3.58, 0))
  const tape = canvasTexture(64, 8, (ctx, w, h) => {
    ctx.fillStyle = '#e23b4e'
    ctx.fillRect(0, 0, w / 2, h)
    ctx.fillStyle = '#f4f4f8'
    ctx.fillRect(w / 2, 0, w / 2, h)
  }, { repeat: [14, 1] })
  truck.add(box(10.22, 0.08, 2.52, new THREE.MeshStandardMaterial({ map: tape, emissive: '#ffffff', emissiveMap: tape, emissiveIntensity: 0.35, roughness: 0.4 }), TX, floor + 0.7, 0))
  truck.add(box(10.21, 0.34, 2.51, paint(C.violet), TX, floor + 0.98, 0))
  for (const side of [-1, 1]) {
    const name = lettering('WAYMARK', 5.6, 0.95, '#5b4be8')
    name.position.set(TX + 0.4, floor + 2.3, side * 1.262)
    name.rotation.y = side < 0 ? Math.PI : 0
    truck.add(name)
    for (const x of [TX - 4.6, TX, TX + 4.6]) truck.add(box(0.1, 0.05, 0.04, amber, x, floor + 0.55, side * 1.3))
  }
  // Rear doors: hinges, locking bars and tail lights.
  truck.add(box(0.04, 2.9, 0.04, dark, TX - 5.12, floor + 2.05, 0))
  for (const z of [-0.62, 0.62]) truck.add(cyl(0.025, 2.9, metal, 'y', 8, TX - 5.13, floor + 2.05, z))
  truck.add(box(0.1, 0.16, 2.3, dark, TX - 5.1, R + 0.1, 0))
  for (const z of [-1.0, 1.0]) truck.add(box(0.06, 0.16, 0.36, glow('#ff3b4e', 5), TX - 5.14, floor + 0.42, z))
  // Frame, landing gear and mud flaps.
  for (const z of [-0.5, 0.5]) truck.add(box(9.6, 0.24, 0.12, dark, TX - 0.2, floor + 0.36, z))
  for (const z of [-0.75, 0.75]) truck.add(box(0.12, 0.85, 0.12, dark, 0.2, floor - 0.1, z))
  truck.add(box(0.3, 0.05, 1.9, dark, 0.2, 0.42, 0))
  for (const z of [-0.95, 0.95]) truck.add(box(0.03, 0.55, 0.58, dark, TX - 4.85, R + 0.05, z))

  // Wheels: single steer tyres, dual tyres on the drive and trailer axles.
  const mount = (x, z, dual) => {
    const wheel = roadWheel(R, 0.32, wheelMaterials, dual)
    wheel.position.set(x, R, z)
    truck.add(wheel)
    wheels.push(wheel)
  }
  for (const side of [-1, 1]) {
    mount(5.9, side * 1.02, 0)
    for (const x of [2.5, 1.2, TX - 2.6, TX - 3.9]) mount(x, side * 1.06, side * -0.36)
  }
  for (const x of [5.9, 2.5, 1.2, TX - 2.6, TX - 3.9]) truck.add(cyl(0.09, 2.1, dark, 'z', 8, x, R, 0))

  const headlamp = new THREE.SpotLight('#fff1cf', 70, 48, 0.42, 0.7, 1.3)
  headlamp.position.set(7.2, floor + 0.6, 0)
  headlamp.target.position.set(32, 0, 0)
  truck.add(headlamp, headlamp.target)

  truck.userData.wheels = wheels
  truck.userData.wheelRadius = R
  return truck
}

/* ---------- Bridge (for the train and the truck) ---------- */

export const PIER_SPACING = 26

/**
 * A causeway over the water with its top surface at y = 0. `scrollers` are the
 * parts that slide backwards to show the vehicle moving: { object, spacing }.
 */
export function buildBridge(kind) {
  const bridge = new THREE.Group()
  const scrollers = []
  const road = kind === 'road'
  const width = road ? 8.6 : 4.8
  const LENGTH = 420
  const m = new THREE.Matrix4()
  const concrete = flat('#59607f', { roughness: 0.92, map: grime(14, 1.4) })
  const steel = flat(C.steel, { metalness: 0.5, roughness: 0.5 })

  // Deck: damp asphalt for the road, ballast for the track, on a concrete girder.
  const surface = road ? flat('#1b1e33', { roughness: 0.42, metalness: 0.1 }) : flat('#2c3150', { roughness: 0.95 })
  bridge.add(box(LENGTH, 0.5, width, surface, 0, -0.25, 0))
  bridge.add(box(LENGTH, 0.9, width + 0.6, concrete, 0, -0.95, 0))
  bridge.add(box(LENGTH, 1.3, width * 0.5, concrete, 0, -1.9, 0))

  // Piers, lamp posts and parapet posts repeat every PIER_SPACING and slide past.
  const repeating = new THREE.Group()
  const lampGlow = glow('#ffe2b0', 6)
  for (let i = -8; i <= 8; i++) {
    const x = i * PIER_SPACING
    repeating.add(rounded(2.6, 16, width * 0.62, 0.3, concrete, x, -10.4, 0))
    repeating.add(box(3.6, 0.9, width + 0.2, concrete, x, -2.6, 0))
    const lx = x + PIER_SPACING / 2
    const lz = width / 2 - 0.12
    repeating.add(cyl(0.08, 6, steel, 'y', 10, lx, 3, lz))
    const arm = box(0.06, 0.06, 1.7, steel, lx, 5.95, lz - 0.8)
    repeating.add(arm)
    repeating.add(rounded(0.7, 0.1, 0.28, 0.04, lampGlow, lx, 5.88, lz - 1.5))
  }
  bridge.add(repeating)
  scrollers.push({ object: repeating, spacing: PIER_SPACING })

  if (road) {
    // Concrete barriers on both sides.
    for (const z of [-1, 1]) {
      bridge.add(box(LENGTH, 0.85, 0.34, concrete, 0, 0.42, z * (width / 2 - 0.17)))
      bridge.add(box(LENGTH, 0.06, 0.4, flat('#787f9e', { roughness: 0.8 }), 0, 0.87, z * (width / 2 - 0.17)))
    }
    const SPACING = 7
    const count = Math.floor(LENGTH / SPACING)
    const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 0.02, 0.15), flat('#f1eeff', { emissive: '#f1eeff', emissiveIntensity: 0.3, roughness: 0.5 }), count)
    for (let i = 0; i < count; i++) dashes.setMatrixAt(i, m.setPosition(-LENGTH / 2 + i * SPACING, 0.012, 0))
    bridge.add(dashes)
    scrollers.push({ object: dashes, spacing: SPACING })
    for (const z of [-1, 1]) bridge.add(box(LENGTH, 0.02, 0.13, flat('#f1eeff', { roughness: 0.5 }), 0, 0.012, z * (width / 2 - 0.75)))
    // Reflective studs along the barrier.
    const studs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.08, 0.03), glow('#ffb347', 2.5), count * 2)
    for (let i = 0; i < count; i++) {
      studs.setMatrixAt(i * 2, m.setPosition(-LENGTH / 2 + i * SPACING, 0.6, width / 2 - 0.36))
      studs.setMatrixAt(i * 2 + 1, m.setPosition(-LENGTH / 2 + i * SPACING, 0.6, -(width / 2 - 0.36)))
    }
    bridge.add(studs)
    scrollers.push({ object: studs, spacing: SPACING })
  } else {
    // Rails on sleepers, with a steel parapet.
    const railSteel = new THREE.MeshStandardMaterial({ color: '#c9cfe6', metalness: 0.95, roughness: 0.22 })
    for (const z of [-0.78, 0.78]) {
      bridge.add(box(LENGTH, 0.14, 0.07, railSteel, 0, 0.13, z))
      bridge.add(box(LENGTH, 0.03, 0.16, railSteel, 0, 0.05, z))
    }
    const SPACING = 1.1
    const count = Math.floor(LENGTH / SPACING)
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.1, 2.5), flat('#4d5374', { roughness: 0.95 }), count)
    for (let i = 0; i < count; i++) sleepers.setMatrixAt(i, m.setPosition(-LENGTH / 2 + i * SPACING, 0.02, 0))
    bridge.add(sleepers)
    scrollers.push({ object: sleepers, spacing: SPACING })
    for (const z of [-1, 1]) {
      bridge.add(box(LENGTH, 0.06, 0.06, steel, 0, 0.95, z * (width / 2 - 0.1)))
      bridge.add(box(LENGTH, 0.04, 0.04, steel, 0, 0.5, z * (width / 2 - 0.1)))
    }
    const posts = []
    for (let x = -LENGTH / 2; x < LENGTH / 2; x += PIER_SPACING / 13) for (const z of [-1, 1]) posts.push({ x, z: z * (width / 2 - 0.1) })
    const parapet = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.95, 0.06), steel, posts.length)
    posts.forEach((p, i) => parapet.setMatrixAt(i, m.setPosition(p.x, 0.475, p.z)))
    repeating.add(parapet)
  }

  bridge.userData.scrollers = scrollers
  return bridge
}

/* ---------- Clouds (for the airplane) ---------- */

export function buildClouds() {
  const clouds = new THREE.Group()
  const random = seeded(99)
  // Soft round puffs on billboards read as cloud far better than solid shapes.
  const puff = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.4)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
  const lit = new THREE.SpriteMaterial({ map: puff, color: '#cdc7f5', transparent: true, opacity: 0.34, depthWrite: false })
  const shaded = new THREE.SpriteMaterial({ map: puff, color: '#6f69b8', transparent: true, opacity: 0.3, depthWrite: false })
  for (let i = 0; i < 22; i++) {
    const cloud = new THREE.Group()
    const puffs = 9 + Math.floor(random() * 8)
    const spread = 9 + random() * 12
    for (let p = 0; p < puffs; p++) {
      const sprite = new THREE.Sprite(random() < 0.6 ? lit : shaded)
      const s = 6 + random() * 9
      sprite.scale.set(s * 1.5, s, 1)
      sprite.position.set((random() - 0.5) * spread * 2, random() * 2.4 - (p % 2) * 1.2, (random() - 0.5) * 5)
      cloud.add(sprite)
    }
    // Most clouds sit beyond the aircraft; a few low ones pass in front.
    const near = i % 6 === 0
    cloud.position.set(random() * 360 - 180, near ? random() * 3 : 2 + random() * 15, near ? -9 - random() * 10 : 16 + random() * 120)
    cloud.userData.speed = near ? 1.25 : 0.35 + 30 / (60 + cloud.position.z)
    clouds.add(cloud)
  }
  return clouds
}
