import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import type { Group, Mesh, Object3D } from 'three'
import { useAvatarFaceController } from '../hooks/useAvatarFaceController'

const MODEL_PATH = '/models/astrologer-poc.glb'
const FACE_MESH_PREFIXES = ['Face_(merged)baked', 'Face', 'face']

// Some WebKit builds will briefly show GLB textures and then lose them when
// GLTFLoader chooses ImageBitmapLoader. For this isolated POC we prefer the
// more stable TextureLoader path on Safari-like browsers.
if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
  const userAgent = navigator.userAgent
  const isSafariLike =
    /Safari/i.test(userAgent) &&
    !/Chrome|Chromium|Android/i.test(userAgent)

  if (isSafariLike && 'createImageBitmap' in window) {
    Object.defineProperty(window, 'createImageBitmap', {
      configurable: true,
      value: undefined,
      writable: true,
    })
  }
}

function findMorphMeshes(root: Object3D): Mesh[] {
  const namedMatches: Mesh[] = []
  const allMorphMeshes: Mesh[] = []

  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
      return
    }

    console.log('Mesh with morphs:', mesh.name || '(unnamed)')
    console.log('Morph targets:', mesh.morphTargetDictionary)

    allMorphMeshes.push(mesh)

    if (FACE_MESH_PREFIXES.some((prefix) => mesh.name.startsWith(prefix))) {
      namedMatches.push(mesh)
    }
  })

  return namedMatches.length > 0 ? namedMatches : allMorphMeshes
}

function AvatarModel({
  onMorphsDetected,
}: {
  onMorphsDetected: ReturnType<typeof useAvatarFaceController>
}) {
  const { scene } = useGLTF(MODEL_PATH)
  const sceneGroupRef = useRef<Group>(null)

  useEffect(() => {
    const faceMeshes = findMorphMeshes(scene)
    onMorphsDetected.attachFaceMeshes(faceMeshes)

    if (faceMeshes.length > 0) {
      console.log(
        'Using face meshes:',
        faceMeshes.map((mesh) => mesh.name || '(unnamed)'),
      )
    } else {
      console.warn('No mesh with morph targets found in model.')
    }
  }, [onMorphsDetected, scene])

  return (
    <group ref={sceneGroupRef}>
      <FitCameraToModel modelRoot={sceneGroupRef} />
      <primitive object={scene} />
    </group>
  )
}

function FitCameraToModel({
  modelRoot,
}: {
  modelRoot: React.RefObject<Group | null>
}) {
  const { camera, invalidate } = useThree()

  useEffect(() => {
    if (!modelRoot.current) {
      return
    }

    if (!(camera instanceof PerspectiveCamera)) {
      return
    }

    const box = new Box3().setFromObject(modelRoot.current)
    if (box.isEmpty()) {
      return
    }

    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = (camera.fov * Math.PI) / 180
    const distance = maxDim / (2 * Math.tan(fov / 2))

    camera.position.set(center.x, center.y, center.z + distance * 1.45)
    camera.near = Math.max(0.01, distance / 100)
    camera.far = Math.max(100, distance * 100)
    camera.lookAt(center)
    camera.updateProjectionMatrix()
    invalidate()
  }, [camera, invalidate, modelRoot])

  return null
}

function ControlButton({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button className="control-button" onClick={onClick} type="button">
      {label}
    </button>
  )
}

export function TalkingAvatar() {
  const controller = useAvatarFaceController()
  const morphSummary = useMemo(
    () => controller.availableMorphs.join(', '),
    [controller.availableMorphs],
  )

  return (
    <div className="avatar-test-layout">
      <div className="canvas-panel">
        <Canvas
          camera={{ position: [0, 1.4, 2.2], fov: 30 }}
          onCreated={({ gl }) => {
            gl.setClearColor('#111111')
          }}
        >
          <color attach="background" args={['#111111']} />
          <ambientLight intensity={1.2} />
          <directionalLight position={[2, 3, 2]} intensity={2} />
          <AvatarModel onMorphsDetected={controller} />
          <OrbitControls enablePan={false} makeDefault />
        </Canvas>
      </div>

      <div className="control-panel">
        <div>
          <p className="eyebrow">Standalone POC</p>
          <h1>Avatar Face Rig Test</h1>
          <p className="panel-copy">
            This page stays isolated from the chat flow so we can confirm the
            face rig before adding speech, streaming, or Gemini.
          </p>
        </div>

        <div className="control-group">
          <h2>Visemes</h2>
          <div className="button-row">
            <ControlButton label="A" onClick={() => controller.setViseme('A', 1)} />
            <ControlButton label="I" onClick={() => controller.setViseme('I', 1)} />
            <ControlButton label="U" onClick={() => controller.setViseme('U', 1)} />
            <ControlButton label="E" onClick={() => controller.setViseme('E', 1)} />
            <ControlButton label="O" onClick={() => controller.setViseme('O', 1)} />
            <ControlButton label="Reset Mouth" onClick={controller.resetMouth} />
          </div>
        </div>

        <div className="control-group">
          <h2>Expressions</h2>
          <div className="button-row">
            <ControlButton label="Blink" onClick={() => controller.blink()} />
            <ControlButton label="Joy" onClick={() => controller.setExpression('Joy', 1)} />
            <ControlButton
              label="Angry"
              onClick={() => controller.setExpression('Angry', 1)}
            />
            <ControlButton
              label="Reset Face"
              onClick={() => {
                controller.resetExpressions()
                controller.resetMouth()
                controller.setRawMorph('Fcl_EYE_Close', 0)
              }}
            />
          </div>
        </div>

        <div className="control-group">
          <h2>Morph Target Discovery</h2>
          <p className="morph-status">
            {controller.availableMorphs.length > 0
              ? `Detected ${controller.availableMorphs.length} morph targets.`
              : `No morph targets detected yet. Put your model at ${MODEL_PATH} and open the page.`}
          </p>
          <textarea
            className="morph-log"
            readOnly
            value={morphSummary}
          />
        </div>
      </div>
    </div>
  )
}

useGLTF.preload(MODEL_PATH)
