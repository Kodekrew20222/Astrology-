import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import type { Mesh, Object3D } from 'three'
import { useAvatarFaceController } from '../hooks/useAvatarFaceController'

const MODEL_PATH = '/models/astrologer-poc.glb'
const FACE_MESH_CANDIDATES = ['Face (merged).baked', 'Face', 'face']

function findMorphMesh(root: Object3D): Mesh | null {
  let namedMatch: Mesh | null = null
  let firstMorphMesh: Mesh | null = null

  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
      return
    }

    console.log('Mesh with morphs:', mesh.name || '(unnamed)')
    console.log('Morph targets:', mesh.morphTargetDictionary)

    if (!firstMorphMesh) {
      firstMorphMesh = mesh
    }

    if (FACE_MESH_CANDIDATES.includes(mesh.name)) {
      namedMatch = mesh
    }
  })

  return namedMatch ?? firstMorphMesh
}

function AvatarModel({
  onMorphsDetected,
}: {
  onMorphsDetected: ReturnType<typeof useAvatarFaceController>
}) {
  const { scene } = useGLTF(MODEL_PATH)

  useEffect(() => {
    const faceMesh = findMorphMesh(scene)
    onMorphsDetected.attachFaceMesh(faceMesh)

    if (faceMesh) {
      console.log('Using face mesh:', faceMesh.name || '(unnamed)')
    } else {
      console.warn('No mesh with morph targets found in model.')
    }
  }, [onMorphsDetected, scene])

  return <primitive object={scene} position={[0, -1.4, 0]} />
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
        <Canvas camera={{ position: [0, 1.4, 2.2], fov: 30 }}>
          <color attach="background" args={['#111111']} />
          <ambientLight intensity={1.2} />
          <directionalLight position={[2, 3, 2]} intensity={2} />
          <AvatarModel onMorphsDetected={controller} />
          <OrbitControls enablePan={false} />
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
