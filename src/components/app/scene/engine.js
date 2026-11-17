/*
  The Command Center hero scene: moving water, a night sky and one vehicle.
  Plain three.js with no React, so the component only has to mount a canvas.

  The vehicle stays at the origin and the world moves past it: the water
  pattern streams backwards under the ship, the bridge parts slide under the
  train and truck, and the clouds drift past the airplane.

  Realism comes from four things: an environment map so paint and glass
  reflect the sky, shadows from the key light, water that reflects the same
  sky, and a bloom pass so lamps and the moon glow.
*/
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { C, buildBridge, buildClouds, buildPlane, buildShip, buildTrain, buildTruck } from './vehicles.js'

const SKY = { top: '#04061a', mid: '#11133d', horizon: '#3a3290', glow: '#d9d3ff' }
const LIGHT_DIR = new THREE.Vector3(-0.5, 0.13, 0.86).normalize()
const DECK_HEIGHT = 4.2

// Wave set shared by the shader and the ship's motion: [dirX, dirZ, frequency, amplitude, speed].
const WAVES = [
  [0.97, 0.24, 0.16, 0.42, 0.9],
  [0.6, 0.8, 0.31, 0.2, 1.3],
  [-0.33, 0.94, 0.58, 0.09, 1.9],
]

/** Water height at a point, in the same terms as the vertex shader. */
function waveHeight(x, z, t) {
  let h = 0
  for (const [dx, dz, freq, amp, speed] of WAVES) h += amp * Math.sin((dx * x + dz * z) * freq + t * speed)
  return h
}

const f = (n) => n.toFixed(4)
const WAVE_GLSL = `
vec3 waves(vec2 p, float t) {
  float h = 0.0, dx = 0.0, dz = 0.0, a;
  ${WAVES.map(([x, z, freq, amp, speed]) => `a = dot(vec2(${f(x)}, ${f(z)}), p) * ${f(freq)} + t * ${f(speed)}; h += ${f(amp)} * sin(a); dx += ${f(amp * freq * x)} * cos(a); dz += ${f(amp * freq * z)} * cos(a);`).join('\n  ')}
  return vec3(h, dx, dz);
}`

const NOISE_GLSL = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) { sum += amp * noise(p); p = p * 2.03 + 11.3; amp *= 0.5; }
  return sum;
}`

// One sky function, used by the sky dome and by the water's reflection of it.
const SKY_GLSL = `
uniform vec3 uTop, uMid, uHorizon, uGlow, uLightDir;
vec3 skyColour(vec3 d, float moon) {
  float h = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.2, h));
  c = mix(c, uTop, smoothstep(0.14, 0.6, h));
  float toLight = max(dot(d, uLightDir), 0.0);
  // Thin, moonlit cloud bands low in the sky.
  float cloud = smoothstep(0.46, 0.8, fbm(d.xz / (h + 0.12) * 1.25 + 4.0)) * smoothstep(0.01, 0.16, h) * (1.0 - smoothstep(0.45, 0.9, h));
  c = mix(c, uMid * 1.8 + uGlow * pow(toLight, 5.0) * 0.45, cloud * 0.5);
  c += uGlow * ((smoothstep(0.99962, 0.99978, toLight) * 0.85 + pow(toLight, 700.0) * 0.3) * moon + pow(toLight, 40.0) * 0.1);
  return c;
}`

const skyUniforms = () => ({
  uTop: { value: new THREE.Color(SKY.top) },
  uMid: { value: new THREE.Color(SKY.mid) },
  uHorizon: { value: new THREE.Color(SKY.horizon) },
  uGlow: { value: new THREE.Color(SKY.glow) },
  uLightDir: { value: LIGHT_DIR },
})

function buildWater() {
  const geometry = new THREE.PlaneGeometry(760, 760, 256, 256)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...skyUniforms(),
      uTime: { value: 0 },
      uOffset: { value: new THREE.Vector2() },
      uWake: { value: 1 },
      uDeep: { value: new THREE.Color('#050920') },
      uCrest: { value: new THREE.Color('#1c2262') },
      uFoam: { value: new THREE.Color('#d8d2ff') },
    },
    vertexShader: `
      uniform float uTime;
      uniform vec2 uOffset;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vHeight;
      ${WAVE_GLSL}
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float calm = 1.0 - smoothstep(70.0, 240.0, length(world.xz));
        vec3 w = waves(world.xz + uOffset, uTime) * calm;
        world.y += w.x;
        vHeight = w.x;
        vNormal = normalize(vec3(-w.y, 1.0, -w.z));
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uWake;
      uniform vec2 uOffset;
      uniform vec3 uDeep, uCrest, uFoam;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vHeight;
      ${NOISE_GLSL}
      ${SKY_GLSL}

      // Foam left by a hull at the origin heading +x: bow wave, the two arms and the stern trail.
      float wake(vec2 q, vec2 p) {
        float breakup = 0.35 + 1.1 * fbm(p * 0.75);
        float fine = 0.55 + 0.9 * noise(p * 2.6);
        float behind = -17.0 - q.x;
        float width = 2.3 + max(behind, 0.0) * 0.075;
        float trail = smoothstep(width, width * 0.25, abs(q.y)) * smoothstep(-2.0, 2.5, behind) * exp(-max(behind, 0.0) * 0.02);
        float along = 16.5 - q.x;
        float armAt = 0.4 + along * 0.3;
        float armWidth = 0.55 + along * 0.05;
        float arms = smoothstep(armWidth, 0.0, abs(abs(q.y) - armAt)) * step(0.0, along) * exp(-along * 0.028);
        float bow = smoothstep(3.6, 0.4, length(q - vec2(15.6, 0.0)));
        // A thin line of foam where the water meets the hull.
        float hull = smoothstep(0.7, 0.0, abs(abs(q.y) - 2.5)) * step(-17.0, q.x) * step(q.x, 8.0) * 0.5;
        return clamp((trail * 1.1 + arms * 1.0 + hull) * breakup * fine + bow * 0.85 * breakup, 0.0, 1.0);
      }

      void main() {
        vec3 view = normalize(cameraPosition - vWorld);
        vec2 p = vWorld.xz + uOffset;
        float dist = length(vWorld.xz - cameraPosition.xz);

        // Two layers of ripples on top of the large swell, drifting in different directions.
        float e = 0.28;
        vec2 a = p * 0.8 + vec2(uTime * 0.22, uTime * 0.13);
        vec2 b = p * 2.3 + vec2(-uTime * 0.31, uTime * 0.2);
        float a0 = fbm(a), b0 = noise(b);
        vec2 slope = vec2(a0 - fbm(a + vec2(e, 0.0)), a0 - fbm(a + vec2(0.0, e))) * 1.6
                   + vec2(b0 - noise(b + vec2(e, 0.0)), b0 - noise(b + vec2(0.0, e))) * 0.45;
        float detail = 1.0 - smoothstep(40.0, 190.0, dist);
        vec3 normal = normalize(vNormal + vec3(slope.x, 0.0, slope.y) * detail);

        // Dark water body, brighter where the swell lifts toward the moonlight.
        vec3 body = mix(uDeep, uCrest, smoothstep(-0.45, 0.8, vHeight + (a0 - 0.5) * 0.4));
        body += uCrest * pow(max(dot(view, -uLightDir), 0.0), 3.0) * smoothstep(0.0, 0.6, vHeight) * 0.6;

        // The surface mirrors the sky, more strongly at grazing angles.
        vec3 mirrored = reflect(-view, normal);
        mirrored.y = abs(mirrored.y);
        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
        vec3 colour = mix(body, skyColour(mirrored, 7.0), clamp(fresnel, 0.0, 1.0));

        float crest = smoothstep(0.5, 0.82, vHeight + (a0 - 0.5) * 0.7) * detail;
        float foam = clamp(crest * 0.3 + wake(vWorld.xz, p) * uWake, 0.0, 1.0);
        colour = mix(colour, uFoam, foam);

        colour = mix(colour, uHorizon, smoothstep(60.0, 300.0, dist));
        gl_FragColor = vec4(colour, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  return new THREE.Mesh(geometry, material)
}

function buildSky() {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms(),
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        ${NOISE_GLSL}
        ${SKY_GLSL}
        void main() {
          gl_FragColor = vec4(skyColour(normalize(vDir), 2.4), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  )
  sky.renderOrder = -2
  return sky
}

/** Stars overhead and a lit shoreline on the horizon. */
function buildDistantLights() {
  const group = new THREE.Group()
  let seed = 3
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }

  const stars = []
  for (let i = 0; i < 520; i++) {
    const angle = random() * Math.PI * 2
    const y = 0.14 + random() * 0.86
    const r = Math.sqrt(1 - y * y)
    stars.push(Math.cos(angle) * r * 560, y * 560, Math.sin(angle) * r * 560)
  }
  const starGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(stars, 3))
  group.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#dcd6ff', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false, depthWrite: false })))

  const shore = []
  const colours = []
  const palette = [new THREE.Color(C.warm).multiplyScalar(1.6), new THREE.Color(C.lilac).multiplyScalar(1.3), new THREE.Color('#ffffff').multiplyScalar(1.5)]
  for (let i = 0; i < 190; i++) {
    const angle = 1.75 + random() * 0.85
    const distance = 285 + random() * 30
    shore.push(Math.cos(angle) * distance, 0.5 + random() * random() * 4, Math.sin(angle) * distance)
    const c = palette[Math.floor(random() * palette.length)]
    colours.push(c.r, c.g, c.b)
  }
  const shoreGeometry = new THREE.BufferGeometry()
  shoreGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shore, 3))
  shoreGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  group.add(new THREE.Points(shoreGeometry, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, fog: false, depthWrite: false })))
  return group
}

/** What paint, glass and chrome reflect: the same sky, a dark sea and a soft light behind the camera. */
function buildEnvironment(renderer) {
  const env = new THREE.Scene()
  env.add(buildSky())
  const sea = new THREE.Mesh(new THREE.CircleGeometry(590, 32), new THREE.MeshBasicMaterial({ color: '#0a0f30' }))
  sea.rotation.x = -Math.PI / 2
  sea.position.y = -3
  env.add(sea)
  const softbox = new THREE.Mesh(new THREE.PlaneGeometry(300, 150), new THREE.MeshBasicMaterial({ color: new THREE.Color('#c9c1ff').multiplyScalar(2.6), side: THREE.DoubleSide }))
  softbox.position.set(150, 190, -230)
  softbox.lookAt(0, 0, 0)
  env.add(softbox)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const texture = pmrem.fromScene(env, 0.02, 1, 2000).texture
  pmrem.dispose()
  env.traverse((o) => {
    o.geometry?.dispose()
    o.material?.dispose()
  })
  return texture
}

// Where the camera sits for each vehicle, how fast the world moves, and whether the hull leaves a wake.
// `shift` is how far right of centre the subject sits on wide screens, as a share of the width.
const VIEWS = {
  ship: { position: [29, 9.5, -40], target: [-1, 2.8, 0], shift: 0.075, waterSpeed: 6.5, wake: 1 },
  plane: { position: [26, 19, -36], target: [-0.5, 11.2, 0], shift: 0.07, waterSpeed: 34, wake: 0 },
  train: { position: [31, 10.5, -29], target: [-2, DECK_HEIGHT + 1.9, 0], shift: 0.14, waterSpeed: 0, wake: 0, groundSpeed: 24 },
  truck: { position: [16.5, 7.8, -19.5], target: [-0.4, DECK_HEIGHT + 1.9, -1.7], shift: 0.09, waterSpeed: 0, wake: 0, groundSpeed: 17 },
}

// Real model files, when public/models/manifest.json lists them. Each is scaled to this length unless its entry says otherwise.
const MODEL_LENGTH = { ship: 34, plane: 21, train: 42, truck: 13.5 }

async function loadManifest() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}models/manifest.json`)
    // A missing file comes back as a 404, or as the app's HTML page from a dev server.
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return {}
    const manifest = await response.json()
    return manifest && typeof manifest === 'object' ? manifest : {}
  } catch (error) {
    console.warn('Hero scene: public/models/manifest.json could not be read, so the built-in models are shown.', error)
    return {}
  }
}

/** Solid parts cast and receive shadows. Glow sprites and transparent lettering do not. */
function castShadows(root) {
  root.traverse((object) => {
    if (!object.isMesh || object.material?.transparent) return
    object.castShadow = true
    object.receiveShadow = true
  })
}

/**
 * Starts the scene on a canvas. Throws when WebGL is unavailable, so the
 * caller can fall back to a plain background.
 */
export function createHeroScene(canvas, { vehicle = 'ship', animate = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(SKY.horizon, 110, 340)
  scene.environment = buildEnvironment(renderer)
  scene.environmentIntensity = 0.85
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 1400)

  // Near-white lights keep the violet paint from turning pure blue. The key
  // light sits behind the camera and casts the shadows; the moon rims the far side.
  scene.add(new THREE.HemisphereLight('#cfc9ff', '#141a40', 0.55))
  const moon = new THREE.DirectionalLight('#e6e0ff', 1.5)
  moon.position.copy(LIGHT_DIR).multiplyScalar(100)
  scene.add(moon)
  const key = new THREE.DirectionalLight('#f6f2ff', 2.3)
  key.position.set(38, 34, -46).normalize().multiplyScalar(90)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0004
  key.shadow.normalBias = 0.05
  Object.assign(key.shadow.camera, { left: -30, right: 30, top: 24, bottom: -24, near: 1, far: 220 })
  scene.add(key)

  const water = buildWater()
  scene.add(buildSky(), buildDistantLights(), water)

  // Bloom makes lamps, lit windows and the moon glow. If it cannot be set up, the scene renders without it.
  let composer = null
  try {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    composer = new EffectComposer(renderer, target)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.75, 0.95))
    composer.addPass(new OutputPass())
  } catch {
    composer = null
  }

  // Each vehicle is put together the first time it is shown. `model` is a loaded
  // model file; without one, the vehicle is built in code.
  const builders = {
    ship: (model) => ({ root: model ?? buildShip() }),
    plane: (model) => {
      const root = new THREE.Group()
      const body = model ?? buildPlane()
      const clouds = buildClouds()
      root.add(body, clouds)
      return { root, body, clouds }
    },
    train: (model) => {
      const root = new THREE.Group()
      const bridge = buildBridge('rail')
      const body = model ?? buildTrain()
      root.add(bridge, body)
      root.position.y = DECK_HEIGHT
      return { root, body, bridge }
    },
    truck: (model) => {
      const root = new THREE.Group()
      const bridge = buildBridge('road')
      const body = model ?? buildTruck()
      body.position.z = -1.9
      root.add(bridge, body)
      root.position.y = DECK_HEIGHT
      return { root, body, bridge }
    },
  }
  const built = {}
  const views = { ...VIEWS }
  let active = null
  let view = VIEWS.ship
  let disposed = false

  const cameraPosition = new THREE.Vector3()
  const cameraTarget = new THREE.Vector3()
  const wantPosition = new THREE.Vector3()
  const wantTarget = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)
  let distanceScale = 1
  let shift = null
  let viewWidth = 0
  let viewHeight = 0
  let yaw = 0
  let travelled = 0
  let time = 0
  let settled = false

  function placeCamera(dt) {
    wantTarget.fromArray(view.target)
    wantPosition.fromArray(view.position).sub(wantTarget).multiplyScalar(distanceScale).applyAxisAngle(UP, yaw).add(wantTarget)
    const k = settled && dt > 0 ? 1 - Math.exp(-dt * 3.2) : 1
    cameraPosition.lerp(wantPosition, k)
    cameraTarget.lerp(wantTarget, k)
    // Wide layouts keep the text on the left, so the subject moves right. Narrow layouts lift it into the gap under the text.
    const wide = viewWidth >= 900
    const wantShift = wide ? view.shift : 0
    shift = shift === null ? wantShift : shift + (wantShift - shift) * k
    if (viewWidth) camera.setViewOffset(viewWidth, viewHeight, -viewWidth * shift, wide ? 0 : viewHeight * 0.07, viewWidth, viewHeight)
    settled = true
    camera.position.copy(cameraPosition)
    camera.lookAt(cameraTarget)
  }

  function update(dt) {
    time += dt
    const uniforms = water.material.uniforms
    uniforms.uTime.value = time
    uniforms.uOffset.value.x += view.waterSpeed * dt
    uniforms.uWake.value += (view.wake - uniforms.uWake.value) * Math.min(1, dt * 4)
    travelled += (view.groundSpeed ?? 0) * dt
    const item = built[active]

    if (!item) {
      // Still loading its model file.
    } else if (active === 'ship') {
      // Ride the swell: sample the water under the bow, stern and both sides.
      const ox = uniforms.uOffset.value.x
      const h = (x, z) => waveHeight(x + ox, z, time)
      const bow = h(12, 0)
      const stern = h(-12, 0)
      item.root.position.y = (bow + stern + h(0, 0)) * 0.2
      item.root.rotation.z = Math.atan2(bow - stern, 24) * 0.75
      item.root.rotation.x = -Math.atan2(h(0, 3) - h(0, -3), 6) * 0.35 + Math.sin(time * 0.55) * 0.012
      item.root.rotation.y = Math.sin(time * 0.17) * 0.035
      const radar = item.root.userData.radar
      if (radar) radar.rotation.y += dt * 2.6
    } else if (active === 'plane') {
      item.body.position.y = 11 + Math.sin(time * 0.7) * 0.45
      item.body.rotation.x = Math.sin(time * 0.42) * 0.11
      item.body.rotation.z = 0.035 + Math.sin(time * 0.7 + 1) * 0.02
      const { strobe, beacon } = item.body.userData
      if (strobe) strobe.visible = time % 1.4 < 0.1
      if (beacon) beacon.visible = (time + 0.7) % 1.4 < 0.16
      item.clouds.children.forEach((cloud) => {
        cloud.position.x -= view.waterSpeed * cloud.userData.speed * dt
        if (cloud.position.x < -190) cloud.position.x += 380
      })
    } else {
      item.bridge.userData.scrollers.forEach(({ object, spacing }) => {
        object.position.x = -(travelled % spacing)
      })
      const { wheels, wheelRadius } = item.body.userData
      if (wheels) {
        const spin = ((view.groundSpeed ?? 0) / wheelRadius) * dt
        wheels.forEach((wheel) => {
          wheel.rotation.z -= spin
        })
      }
      if (active === 'truck') item.body.position.y = Math.sin(time * 11) * 0.012 + Math.sin(time * 4.3) * 0.01
      else item.body.rotation.x = Math.sin(time * 5) * 0.003
    }
    placeCamera(dt)
  }

  const render = () => (composer ? composer.render() : renderer.render(scene, camera))
  const redraw = () => {
    if (animate || disposed) return
    settled = false
    update(0)
    render()
  }

  // A vehicle listed in the manifest uses its model file. If that fails, it is built in code instead.
  const manifest = loadManifest()
  const pending = new Set()
  async function prepare(name) {
    if (built[name] || pending.has(name)) return
    pending.add(name)
    const entry = (await manifest)[name]
    let model = null
    if (entry?.file) {
      try {
        const { loadModelFile } = await import('./modelFile.js')
        const loaded = await loadModelFile(`${import.meta.env.BASE_URL}models/${entry.file}`, entry, { length: MODEL_LENGTH[name], centred: name === 'plane' })
        model = loaded.object
        model.userData = { wheels: loaded.wheels, wheelRadius: loaded.wheelRadius }
        if (entry.view) views[name] = { ...VIEWS[name], ...entry.view }
      } catch (error) {
        console.warn(`Hero scene: could not load the ${name} model, so the built-in one is shown.`, error)
      }
    }
    if (disposed) return
    built[name] = builders[name](model)
    castShadows(built[name].root)
    built[name].root.visible = name === active
    scene.add(built[name].root)
    if (name === active) {
      view = views[name]
      canvas.dataset.sceneVehicle = name
    }
    redraw()
  }

  function setVehicle(next) {
    if (!builders[next] || next === active) return
    Object.entries(built).forEach(([name, item]) => {
      item.root.visible = name === next
    })
    active = next
    view = views[next]
    if (built[next]) canvas.dataset.sceneVehicle = next
    if (!animate) water.material.uniforms.uWake.value = view.wake
    redraw()
    prepare(next)
  }

  function resize(width, height) {
    if (!width || !height) return
    renderer.setSize(width, height, false)
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio())
      composer.setSize(width, height)
    }
    camera.aspect = width / height
    viewWidth = width
    viewHeight = height
    shift = null
    distanceScale = THREE.MathUtils.clamp(2.5 / camera.aspect, 1, 2.6)
    redraw()
  }

  /** Turns the view around the vehicle. `delta` is in radians. */
  function orbit(delta) {
    yaw = THREE.MathUtils.clamp(yaw + delta, -0.75, 0.75)
    redraw()
  }

  let frame = 0
  let running = false
  let last = 0
  const loop = (now) => {
    frame = requestAnimationFrame(loop)
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    update(dt)
    render()
  }
  function setRunning(on) {
    if (!animate || on === running) return
    running = on
    if (on) {
      last = performance.now()
      frame = requestAnimationFrame(loop)
    } else {
      cancelAnimationFrame(frame)
    }
  }

  function dispose() {
    disposed = true
    setRunning(false)
    cancelAnimationFrame(frame)
    scene.traverse((object) => {
      object.geometry?.dispose()
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : []
      materials.forEach((m) => {
        Object.values(m).forEach((value) => value?.isTexture && value.dispose())
        m.dispose()
      })
    })
    scene.environment?.dispose()
    composer?.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }

  setVehicle(vehicle)
  return { setVehicle, resize, orbit, setRunning, dispose }
}
