/*
  Canvas wrapper for the hero scene. Loaded lazily, so three.js stays out of
  the main bundle. Renders nothing when WebGL is unavailable: the hero's own
  gradient background shows instead.
*/
import { useEffect, useRef, useState } from 'react'
import { cinematicEnabled } from '../../../config/motion.js'
import { createHeroScene } from './engine.js'

export default function HeroScene({ vehicle }) {
  const holder = useRef(null)
  const engine = useRef(null)
  const [failed, setFailed] = useState(false)
  const initialVehicle = useRef(vehicle)

  useEffect(() => {
    // A fresh canvas per mount: disposing the scene ends that canvas's WebGL context for good,
    // and React's strict mode mounts twice in development.
    const el = document.createElement('canvas')
    el.setAttribute('aria-hidden', 'true')
    el.className = 'absolute inset-0 h-full w-full cursor-grab touch-pan-y active:cursor-grabbing'
    holder.current.appendChild(el)
    let scene
    try {
      scene = createHeroScene(el, { vehicle: initialVehicle.current, animate: cinematicEnabled() })
    } catch (error) {
      console.warn('Hero scene: the 3D view could not start, so the plain background is shown.', error)
      el.remove()
      setFailed(true)
      return undefined
    }
    setFailed(false)
    engine.current = scene

    const fit = () => scene.resize(el.clientWidth, el.clientHeight)
    fit()
    const resizer = new ResizeObserver(fit)
    resizer.observe(el)

    // Only animate while the hero is on screen and the tab is visible.
    let onScreen = true
    const sync = () => scene.setRunning(onScreen && !document.hidden)
    const watcher = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      sync()
    })
    watcher.observe(el)
    document.addEventListener('visibilitychange', sync)
    sync()
    el.dataset.sceneReady = 'true'

    // Drag sideways to look around the vehicle. Vertical drags still scroll the page.
    let dragX = null
    const down = (e) => {
      dragX = e.clientX
      el.setPointerCapture(e.pointerId)
    }
    const move = (e) => {
      if (dragX === null) return
      scene.orbit((e.clientX - dragX) * -0.005)
      dragX = e.clientX
    }
    const up = () => {
      dragX = null
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)

    return () => {
      resizer.disconnect()
      watcher.disconnect()
      document.removeEventListener('visibilitychange', sync)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      engine.current = null
      scene.dispose()
      el.remove()
    }
  }, [])

  useEffect(() => {
    engine.current?.setVehicle(vehicle)
  }, [vehicle])

  return <div ref={holder} className="absolute inset-0" data-scene-failed={failed || undefined} />
}
