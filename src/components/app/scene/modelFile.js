/*
  Loads a .glb model listed in public/models/manifest.json and prepares it for
  the hero scene. Generated models tend to arrive as hundreds of small parts
  with vertex colours and no materials, so this:

  - turns the model upright and to face +x,
  - merges the parts into a few meshes (one draw call each),
  - gives curved surfaces smooth shading,
  - makes named parts glow (windows, lamps) or look like glass,
  - keeps wheels separate so they can spin,
  - scales the result to the scene and sits it on y = 0.
*/
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const Z_UP_TO_Y_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2)

const tester = (patterns = []) => {
  const compiled = patterns.map((p) => new RegExp(p))
  return (name) => compiled.some((re) => re.test(name))
}

/** Position, linear RGB colour and smooth normals: the same three attributes on every part, so parts can merge. */
function cleanGeometry(mesh, matrix, entry) {
  let source = mesh.geometry.clone()
  if (source.index) source = source.toNonIndexed()
  source.applyMatrix4(matrix)
  const position = source.getAttribute('position')
  const sourceColour = source.getAttribute('color')
  const colours = new Float32Array(position.count * 3)
  const colour = new THREE.Color()
  const space = entry.srgbColors ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
  for (let i = 0; i < position.count; i++) {
    if (sourceColour) colour.setRGB(sourceColour.getX(i), sourceColour.getY(i), sourceColour.getZ(i), space)
    else colour.copy(mesh.material?.color ?? colour.set('#ffffff'))
    colour.toArray(colours, i * 3)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position.array), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return toCreasedNormals(geometry, THREE.MathUtils.degToRad(entry.smoothAngle ?? 40))
}

/**
 * @param url     where the .glb is served
 * @param entry   its manifest entry
 * @param options { length: default size along the direction of travel, centred: true to centre vertically (aircraft) }
 * @returns {{ object: THREE.Group, wheels: THREE.Mesh[], wheelRadius: number }}
 */
export async function loadModelFile(url, entry, { length, centred = false }) {
  const gltf = await new GLTFLoader().loadAsync(url)
  gltf.scene.updateMatrixWorld(true)

  const turn = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(entry.rotateY ?? 0))
  if (entry.up === 'z') turn.multiply(Z_UP_TO_Y_UP)

  const hidden = tester(entry.hide)
  const isGlass = tester(entry.glass)
  const spins = tester(entry.spin)
  const glows = (entry.glow ?? []).map(([pattern, colour]) => [new RegExp(pattern), colour])

  const buckets = new Map()
  const wheelGeometries = []
  const matrix = new THREE.Matrix4()
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return
    const name = object.name || object.parent?.name || ''
    if (hidden(name)) return
    const geometry = cleanGeometry(object, matrix.multiplyMatrices(turn, object.matrixWorld), entry)
    if (spins(name)) return wheelGeometries.push(geometry)
    const glow = glows.find(([re]) => re.test(name))
    const key = glow ? `glow:${glow[1]}` : isGlass(name) ? 'glass' : 'body'
    if (!buckets.has(key)) buckets.set(key, [])
    return buckets.get(key).push(geometry)
  })

  // Both sides are drawn because generated parts are not always wound consistently.
  const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: entry.roughness ?? 0.5, metalness: entry.metalness ?? 0.25, side: THREE.DoubleSide })
  const materialFor = (key) => {
    if (key === 'body') return body
    if (key === 'glass') return new THREE.MeshPhysicalMaterial({ color: '#080c20', roughness: 0.06, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.05 })
    const colour = key.slice(5)
    return new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: entry.glowStrength ?? 2.2 })
  }

  const inner = new THREE.Group()
  buckets.forEach((geometries, key) => {
    const merged = mergeGeometries(geometries)
    geometries.forEach((g) => g.dispose())
    inner.add(new THREE.Mesh(merged, materialFor(key)))
  })

  // Wheels turn about their own centres, so each keeps its own mesh.
  const wheels = []
  let wheelRadius = 0
  const centre = new THREE.Vector3()
  wheelGeometries.forEach((geometry) => {
    geometry.computeBoundingBox()
    geometry.boundingBox.getCenter(centre)
    wheelRadius = Math.max(wheelRadius, (geometry.boundingBox.max.y - geometry.boundingBox.min.y) / 2)
    geometry.translate(-centre.x, -centre.y, -centre.z)
    const wheel = new THREE.Mesh(geometry, body)
    wheel.position.copy(centre)
    inner.add(wheel)
    wheels.push(wheel)
  })

  // Scale to the scene, centre on the origin and rest on y = 0.
  const bounds = new THREE.Box3().setFromObject(inner)
  const size = bounds.getSize(new THREE.Vector3())
  bounds.getCenter(centre)
  const scale = (entry.length ?? length) / Math.max(size.x, size.z, 0.001)
  inner.position.set(-centre.x, centred ? -centre.y : -bounds.min.y, -centre.z)
  const scaled = new THREE.Group()
  scaled.scale.setScalar(scale)
  scaled.add(inner)
  // `offset` and `lift` are in scene units, after scaling.
  const [ox = 0, oy = 0, oz = 0] = entry.offset ?? []
  scaled.position.set(ox, oy + (entry.lift ?? 0), oz)
  const object = new THREE.Group()
  object.add(scaled)

  return { object, wheels, wheelRadius: wheelRadius * scale }
}
