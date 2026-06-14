import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import * as THREE from 'three'
import type { LayoutUvResponse } from '@/types'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  TAP_HIGHLIGHT_DECAY_MS,
  deviceEquirectUToSphereU,
  sphereHitUvToDeviceEquirectUv,
  unitDirYUpToUv,
  uvToUnitDirYUp,
} from '@/lib/layout-uv-geometry'
import type { TapUvHighlight } from '@/components/LayoutUvMap'

/** LED (u,v) を単位球へ射影。クリック用シェルと干渉しないよう法線方向にわずかにオフセット。 */
const LED_SURFACE_OFFSET = 1.0 + 1e-3
const HI_SURFACE = 1.0 + 2e-3

const SPHERE_TAP_MAX_PX = 20
const SPHERE_TAP_MAX_MS = 750
/** 主指がこの移動量を超えると回転モード（タップ扱いしない） */
const ROTATE_START_PX = 10
const ROTATE_SPEED = 0.85

const SPHERE_ORBIT_MIN_R = 1.55
const SPHERE_ORBIT_MAX_R = 5
/** Default camera distance from origin (matches initial camera direction). */
const DEFAULT_SPHERE_ORBIT_R = 3

function clampOrbitRadius(r: number): number {
  return Math.min(SPHERE_ORBIT_MAX_R, Math.max(SPHERE_ORBIT_MIN_R, r))
}

type SphereTapBridge = {
  camera: THREE.Camera | null
  gl: THREE.WebGLRenderer | null
  hitMesh: THREE.Mesh | null
}

type PointerEntry = {
  startX: number
  startY: number
  t0: number
  lastX: number
  lastY: number
}

function firstPointerId(m: Map<number, PointerEntry>): number | null {
  const it = m.keys().next()
  return it.done ? null : it.value
}

function LedInstanced({ uv, liveLedRgb }: { uv: LayoutUvResponse; liveLedRgb?: Uint8Array | null }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const count = uv.leds.length
  const useLive = liveLedRgb != null && liveLedRgb.length === count * 3
  /** 同一参照のまま中身だけ更新されても追従する（WS 受信は React を回さない最適化のため） */
  const liveRgbRef = useRef(liveLedRgb)
  liveRgbRef.current = liveLedRgb

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    mesh.raycast = () => {}
    uv.leds.forEach((led, i) => {
      const [x, y, z] = uvToUnitDirYUp(deviceEquirectUToSphereU(led.u), led.v)
      const s = LED_SURFACE_OFFSET
      dummy.position.set(x * s, y * s, z * s)
      dummy.scale.setScalar(1)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [uv, dummy])

  useFrame(() => {
    if (!useLive) return
    const mesh = ref.current
    const buf = liveRgbRef.current
    if (!mesh || !buf || buf.length !== count * 3) return
    if (!mesh.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    }
    const attr = mesh.instanceColor as THREE.InstancedBufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < count; i++) {
      const o = i * 3
      arr[o] = buf[o]! / 255
      arr[o + 1] = buf[o + 1]! / 255
      arr[o + 2] = buf[o + 2]! / 255
    }
    attr.needsUpdate = true
  })

  if (useLive) {
    return (
      <instancedMesh key="live-led" ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
        <sphereGeometry args={[0.018, 10, 10]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
    )
  }

  return (
    <instancedMesh key="std-led" ref={ref} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[0.018, 10, 10]} />
      <meshStandardMaterial
        color="#0e7490"
        emissive="#22d3ee"
        emissiveIntensity={1.1}
        roughness={0.35}
        metalness={0.2}
      />
    </instancedMesh>
  )
}

function BackdropSphere() {
  const ref = useRef<THREE.Mesh>(null)
  useLayoutEffect(() => {
    if (ref.current) ref.current.raycast = () => {}
  }, [])
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.995, 48, 48]} />
      <meshStandardMaterial color="#1e293b" roughness={0.9} metalness={0.05} />
    </mesh>
  )
}

/** +Y が北（v=0）、赤道面は XZ。 */
function UvWorldAxes() {
  const axes = useMemo(() => {
    const h = new THREE.AxesHelper(1.34)
    h.renderOrder = 4
    return h
  }, [])
  return <primitive object={axes} />
}

function TapHighlight3D({ pulse }: { pulse: TapUvHighlight }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const uForSphere = pulse.uSphere ?? deviceEquirectUToSphereU(pulse.u)
  const [x, y, z] = useMemo(
    () => uvToUnitDirYUp(uForSphere, pulse.v).map((c) => c * HI_SURFACE) as [number, number, number],
    [uForSphere, pulse.v],
  )

  useLayoutEffect(() => {
    if (meshRef.current) meshRef.current.raycast = () => {}
  }, [])

  useFrame(() => {
    const m = meshRef.current
    if (!m) return
    const phase = Math.max(0, 1 - (performance.now() - pulse.t0) / TAP_HIGHLIGHT_DECAY_MS)
    const s = 0.045 + 0.11 * (1 - phase)
    m.scale.setScalar(s)
    const mat = m.material as THREE.MeshBasicMaterial
    mat.opacity = 0.12 + 0.55 * phase
    m.visible = phase > 0.002
  })

  return (
    <mesh ref={meshRef} position={[x, y, z]} renderOrder={10}>
      <sphereGeometry args={[1, 28, 28]} />
      <meshBasicMaterial
        color="#fde047"
        transparent
        opacity={0.5}
        depthTest
        depthWrite={false}
      />
    </mesh>
  )
}

function BridgeCameraSync({ bridge }: { bridge: RefObject<SphereTapBridge> }) {
  const { camera, gl } = useThree()
  useFrame(() => {
    const b = bridge.current
    if (!b) return
    b.camera = camera
    b.gl = gl
  })
  return null
}

function PreventBrowserPinchZoomOnCanvas() {
  const { gl } = useThree()
  useEffect(() => {
    const el = gl.domElement
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gl])
  return null
}

/** Map の先頭 pointerId を回転、それ以外はタップ。主指が短いドラッグで離れたらレイでタップ。 */
function SpherePointerRouter({
  disabled,
  bridge,
  onTap,
  orbitRadius,
}: {
  disabled: boolean
  bridge: RefObject<SphereTapBridge>
  onTap: (u: number, v: number, uSphere?: number) => void
  orbitRadius: number
}) {
  const { camera, gl } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const onTapRef = useRef(onTap)
  onTapRef.current = onTap

  const target = useMemo(() => new THREE.Vector3(0, 0, 0), [])
  const spherical = useRef(new THREE.Spherical())
  const sphericalInit = useRef(false)

  const st = useRef({
    pointers: new Map<number, PointerEntry>(),
    primaryRotating: false,
  })

  const updateCameraFromSpherical = useCallback(() => {
    const sp = spherical.current
    sp.radius = clampOrbitRadius(sp.radius)
    const off = new THREE.Vector3().setFromSpherical(sp)
    camera.position.copy(target).add(off)
    camera.lookAt(target)
  }, [camera, target])

  useLayoutEffect(() => {
    if (sphericalInit.current) return
    const off = new THREE.Vector3().copy(camera.position).sub(target)
    if (off.lengthSq() < 1e-6) return
    spherical.current.setFromVector3(off)
    spherical.current.phi = Math.PI - spherical.current.phi
    const eps = 0.06
    spherical.current.phi = Math.max(eps, Math.min(Math.PI - eps, spherical.current.phi))
    spherical.current.radius = clampOrbitRadius(orbitRadius)
    sphericalInit.current = true
    updateCameraFromSpherical()
  }, [camera, target, orbitRadius, updateCameraFromSpherical])

  useLayoutEffect(() => {
    if (!sphericalInit.current) return
    spherical.current.radius = clampOrbitRadius(orbitRadius)
    updateCameraFromSpherical()
  }, [orbitRadius, updateCameraFromSpherical])

  useEffect(() => {
    if (disabled) return
    const el = gl.domElement

    const tryTapAt = (clientX: number, clientY: number) => {
      const b = bridge.current
      const mesh = b.hitMesh
      const cam = b.camera ?? camera
      const gll = b.gl ?? gl
      if (!mesh) return
      const rect = gll.domElement.getBoundingClientRect()
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam)
      const hits = raycaster.intersectObject(mesh, false)
      const hit = hits[0]
      if (!hit) return
      const p = hit.point.clone().normalize()
      const hitUv = unitDirYUpToUv(p.x, p.y, p.z)
      const { u, v } = sphereHitUvToDeviceEquirectUv(hitUv.u, hitUv.v)
      onTapRef.current(u, v, hitUv.u)
    }

    const onDown = (e: PointerEvent) => {
      e.preventDefault()
      const s = st.current
      s.pointers.set(e.pointerId, {
        startX: e.clientX,
        startY: e.clientY,
        t0: performance.now(),
        lastX: e.clientX,
        lastY: e.clientY,
      })
    }

    const onMove = (e: PointerEvent) => {
      const s = st.current
      const p = s.pointers.get(e.pointerId)
      if (!p) return

      const primary = firstPointerId(s.pointers)
      const isPrimary = primary === e.pointerId

      if (isPrimary) {
        const total = Math.hypot(e.clientX - p.startX, e.clientY - p.startY)
        if (!s.primaryRotating && total > ROTATE_START_PX) {
          s.primaryRotating = true
        }
        if (s.primaryRotating) {
          const dx = e.clientX - p.lastX
          const dy = e.clientY - p.lastY
          const h = el.clientHeight || 1
          const sp = spherical.current
          sp.theta -= ((2 * Math.PI * dx) / h) * ROTATE_SPEED * 0.5
          sp.phi -= ((2 * Math.PI * dy) / h) * ROTATE_SPEED * 0.5
          const eps = 0.06
          sp.phi = Math.max(eps, Math.min(Math.PI - eps, sp.phi))
          updateCameraFromSpherical()
        }
      }

      p.lastX = e.clientX
      p.lastY = e.clientY
    }

    const onUp = (e: PointerEvent) => {
      const s = st.current
      const p = s.pointers.get(e.pointerId)
      if (!p) return

      const primaryBefore = firstPointerId(s.pointers)
      const wasPrimary = primaryBefore === e.pointerId

      s.pointers.delete(e.pointerId)

      const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY)
      const dt = performance.now() - p.t0

      if (wasPrimary) {
        if (!s.primaryRotating && dist <= SPHERE_TAP_MAX_PX && dt <= SPHERE_TAP_MAX_MS) {
          tryTapAt(e.clientX, e.clientY)
        }
        s.primaryRotating = false
      } else {
        if (dist <= SPHERE_TAP_MAX_PX && dt <= SPHERE_TAP_MAX_MS) {
          tryTapAt(e.clientX, e.clientY)
        }
      }

      if (wasPrimary && s.pointers.size > 0) {
        s.primaryRotating = false
      }
    }

    const onCancel = (ev: PointerEvent) => {
      const s = st.current
      const primaryBefore = firstPointerId(s.pointers)
      const wasPrimary = primaryBefore === ev.pointerId
      s.pointers.delete(ev.pointerId)
      if (wasPrimary) s.primaryRotating = false
    }

    el.addEventListener('pointerdown', onDown, { passive: false })
    el.addEventListener('pointermove', onMove, { passive: false })
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onCancel)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onCancel)
    }
  }, [disabled, gl, camera, bridge, raycaster, updateCameraFromSpherical])

  return null
}

function Scene({
  uv,
  disabled,
  pulseHighlights,
  bridge,
  onSphereTap,
  orbitRadius,
  liveLedRgb,
}: {
  uv: LayoutUvResponse
  disabled: boolean
  pulseHighlights: TapUvHighlight[]
  bridge: RefObject<SphereTapBridge>
  onSphereTap: (u: number, v: number, uSphere?: number) => void
  orbitRadius: number
  liveLedRgb?: Uint8Array | null
}) {
  const hitSphereRef = useRef<THREE.Mesh>(null)

  useLayoutEffect(() => {
    bridge.current.hitMesh = hitSphereRef.current
    return () => {
      bridge.current.hitMesh = null
    }
  }, [bridge])

  return (
    <>
      <BridgeCameraSync bridge={bridge} />
      <color attach="background" args={['#0a0a0f']} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 5]} intensity={0.85} />
      <directionalLight position={[-4, -1, -2]} intensity={0.25} />

      <BackdropSphere />

      <mesh ref={hitSphereRef}>
        <sphereGeometry args={[1, 72, 72]} />
        <meshStandardMaterial
          color="#94a3b8"
          opacity={disabled ? 0.06 : 0.16}
          transparent
          roughness={0.4}
          metalness={0.08}
          depthWrite={false}
        />
      </mesh>

      <LedInstanced uv={uv} liveLedRgb={liveLedRgb} />

      <UvWorldAxes />

      {pulseHighlights.map((h) => (
        <TapHighlight3D key={h.id} pulse={h} />
      ))}

      <PreventBrowserPinchZoomOnCanvas />
      <SpherePointerRouter
        disabled={disabled}
        bridge={bridge}
        onTap={onSphereTap}
        orbitRadius={orbitRadius}
      />
    </>
  )
}

/** Live 用: レイアウト UV の球面プレビュー（R3F）。 */
export function LayoutUvSphereCanvas({
  uv,
  disabled,
  onSphereTap,
  pulseHighlights,
  className,
  liveLedRgb,
}: {
  uv: LayoutUvResponse
  disabled: boolean
  onSphereTap: (u: number, v: number, uSphere?: number) => void
  pulseHighlights: TapUvHighlight[]
  className?: string
  /** Raw RGB per LED (`leds.length * 3`). When set, each sphere instance uses these colors. */
  liveLedRgb?: Uint8Array | null
}) {
  const [orbitRadius, setOrbitRadius] = useState(() => clampOrbitRadius(DEFAULT_SPHERE_ORBIT_R))

  const bridge = useRef<SphereTapBridge>({
    camera: null,
    gl: null,
    hitMesh: null,
  })

  return (
    <div
      className={cn(
        'touch-none flex flex-col overflow-hidden rounded-xl border border-border bg-[#0a0a0f] select-none',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      role="img"
      aria-label="LED layout on sphere"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="relative h-[min(62vw,620px)] w-full min-h-[380px] md:min-h-[460px] lg:min-h-[500px]">
        <Canvas
          className="absolute inset-0 block h-full w-full"
          camera={{
            position: (() => {
              const y = 0.15
              const z = 2.55
              const s = DEFAULT_SPHERE_ORBIT_R / Math.hypot(0, y, z)
              return [0, y * s, z * s] as [number, number, number]
            })(),
            fov: 48,
            near: 0.1,
            far: 40,
          }}
          gl={{ antialias: true, alpha: false }}
        >
          <Suspense fallback={null}>
            <Scene
              uv={uv}
              disabled={disabled}
              pulseHighlights={pulseHighlights}
              bridge={bridge}
              onSphereTap={onSphereTap}
              orbitRadius={orbitRadius}
              liveLedRgb={liveLedRgb}
            />
          </Suspense>
        </Canvas>

        <div className="pointer-events-none absolute inset-x-0 bottom-14 z-[5] flex justify-center">
          <span className="rounded bg-background/55 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Drag to orbit · extra finger tap for pulse
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-border/60 px-3 py-2">
        <Label htmlFor="sphere-orbit-r" className="w-24 shrink-0 text-xs font-medium">
          Distance
        </Label>
        <Slider
          id="sphere-orbit-r"
          className="flex-1"
          disabled={disabled}
          min={Math.round(SPHERE_ORBIT_MIN_R * 100)}
          max={Math.round(SPHERE_ORBIT_MAX_R * 100)}
          step={4}
          value={[Math.round(orbitRadius * 100)]}
          onValueChange={(v) => setOrbitRadius(clampOrbitRadius((v[0] ?? SPHERE_ORBIT_MIN_R * 100) / 100))}
          aria-label="Camera distance for 3D sphere"
        />
        <span className="w-11 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {orbitRadius.toFixed(2)}
        </span>
      </div>
    </div>
  )
}
