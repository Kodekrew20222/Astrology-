import React from 'react'
import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import {
  type ErrorInfo,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Group, Mesh, Object3D } from 'three'
import {
  type LipSyncCue,
  type VisemeWeights,
  useAvatarFaceController,
} from '../hooks/useAvatarFaceController'

const MODEL_PATH = '/models/astrologer-poc.glb'
const FACE_MESH_PREFIXES = ['Face_(merged)baked', 'Face', 'face']
const MODEL_Y_ROTATION = Math.PI
const MIN_FACE_FRAME_PADDING = new Vector3(0.08, 0.14, 0.16)
const GEMINI_CHAT_ENDPOINT = '/.netlify/functions/gemini'
const DEFAULT_VOICE_ENDPOINT =
  import.meta.env.VITE_VOICE_ENDPOINT || 'http://127.0.0.1:8020/speak'
const DEFAULT_VOICE_NAME = import.meta.env.VITE_VOICE_NAME || 'hi-IN-MadhurNeural'
const ASSISTANT_SPEECH_FLUSH_PATTERN = /([.!?;:]\s+|\n+)/
const MAX_STREAMING_SPEECH_BUFFER_LENGTH = 96

const CLOSED_MOUTH: VisemeWeights = {}
const OPEN_A: VisemeWeights = { A: 0.9, E: 0.14 }
const OPEN_E: VisemeWeights = { E: 0.84, I: 0.18 }
const OPEN_I: VisemeWeights = { I: 0.92, E: 0.2 }
const OPEN_O: VisemeWeights = { O: 0.88, U: 0.18 }
const OPEN_U: VisemeWeights = { U: 0.9, O: 0.24 }
const NARROW_FRONT: VisemeWeights = { E: 0.34, I: 0.26 }
const SOFT_ROUND: VisemeWeights = { O: 0.44, U: 0.52 }
const LABIODENTAL: VisemeWeights = { E: 0.3, I: 0.16, U: 0.16 }
const RHOTIC: VisemeWeights = { E: 0.26, O: 0.26 }

type TextToken = {
  text: string
  type: 'punctuation' | 'word'
}

type PhonemeRecipe = {
  durationMs: number
  patterns: string[]
  smoothingMs?: number
  weights: VisemeWeights
}

type ChatRole = 'assistant' | 'user'
type ChatMessage = {
  content: string
  id: string
  role: ChatRole
}
type RhubarbMouthCue = {
  end: number
  start: number
  value: string
}
type VoiceWithCuesResponse = {
  audioBase64: string
  contentType: string
  mouthCues: RhubarbMouthCue[]
  voice: string
}

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

type LogFn = (message: string) => void
type LoadedGLTFState = {
  error: string | null
  gltf: GLTF | null
  loading: boolean
}

type OrbitControlsLike = {
  target: Vector3
  update: () => void
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }

  return String(error)
}

function useAvatarDebugLog() {
  const [logs, setLogs] = useState<string[]>([])

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

    const entry = `[${timestamp}] ${message}`
    console.log('[AvatarDebug]', entry)
    setLogs((current) => [...current.slice(-79), entry])
  }, [])

  return { addLog, logs }
}

function isOrbitControlsLike(value: unknown): value is OrbitControlsLike {
  if (!value || typeof value !== 'object') {
    return false
  }

  return 'target' in value && 'update' in value
}

const PHONEME_RECIPES: PhonemeRecipe[] = [
  { durationMs: 120, patterns: ['tion', 'sion'], smoothingMs: 64, weights: NARROW_FRONT },
  { durationMs: 96, patterns: ['ch', 'sh'], smoothingMs: 58, weights: NARROW_FRONT },
  { durationMs: 90, patterns: ['th'], smoothingMs: 56, weights: OPEN_E },
  { durationMs: 88, patterns: ['ph'], smoothingMs: 58, weights: LABIODENTAL },
  { durationMs: 78, patterns: ['ng'], smoothingMs: 56, weights: { A: 0.16, E: 0.1 } },
  { durationMs: 176, patterns: ['ee', 'ea', 'ie'], smoothingMs: 86, weights: OPEN_I },
  { durationMs: 188, patterns: ['oo'], smoothingMs: 92, weights: OPEN_U },
  { durationMs: 170, patterns: ['ow'], smoothingMs: 88, weights: { O: 0.76, U: 0.42 } },
  { durationMs: 164, patterns: ['ou'], smoothingMs: 86, weights: { U: 0.78, O: 0.28 } },
  { durationMs: 166, patterns: ['oi', 'oy'], smoothingMs: 86, weights: { O: 0.54, I: 0.4 } },
  { durationMs: 154, patterns: ['ai', 'ay'], smoothingMs: 82, weights: { A: 0.76, E: 0.24 } },
  { durationMs: 152, patterns: ['au'], smoothingMs: 84, weights: { O: 0.42, U: 0.5 } },
  { durationMs: 148, patterns: ['ar'], smoothingMs: 80, weights: { A: 0.74, O: 0.2 } },
  { durationMs: 148, patterns: ['or'], smoothingMs: 80, weights: { O: 0.76, U: 0.16 } },
  { durationMs: 130, patterns: ['er', 'ir', 'ur'], smoothingMs: 74, weights: { E: 0.4, I: 0.14, O: 0.22 } },
]

function createCue(
  durationMs: number,
  weights: VisemeWeights,
  smoothingMs = 72,
): LipSyncCue {
  return {
    durationMs,
    smoothingMs,
    weights,
  }
}

function weightsSignature(weights: VisemeWeights) {
  const keys = Object.keys(weights).sort() as Array<keyof VisemeWeights>
  return keys
    .map((key) => `${key}:${(weights[key] ?? 0).toFixed(2)}`)
    .join('|')
}

function appendCue(cues: LipSyncCue[], nextCue: LipSyncCue) {
  const previousCue = cues[cues.length - 1]
  if (!previousCue) {
    cues.push(nextCue)
    return
  }

  const previousSignature = weightsSignature(previousCue.weights ?? CLOSED_MOUTH)
  const nextSignature = weightsSignature(nextCue.weights ?? CLOSED_MOUTH)
  if (previousSignature !== nextSignature) {
    cues.push(nextCue)
    return
  }

  previousCue.durationMs += nextCue.durationMs
  previousCue.smoothingMs = Math.round(
    ((previousCue.smoothingMs ?? 72) + (nextCue.smoothingMs ?? 72)) / 2,
  )
}

function tokenizeSpeech(text: string): TextToken[] {
  const matches = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .match(/[a-z']+|[.,!?;:]/g)

  if (!matches) {
    return []
  }

  return matches.map((match) => ({
    text: match,
    type: /[a-z']/.test(match[0]) ? 'word' : 'punctuation',
  }))
}

function matchRecipe(word: string, startIndex: number) {
  const slice = word.slice(startIndex)

  return PHONEME_RECIPES.find((recipe) =>
    recipe.patterns.some((pattern) => slice.startsWith(pattern)),
  )
}

function buildLetterCue(character: string, isWordEnd: boolean): LipSyncCue | null {
  switch (character) {
    case 'a':
      return createCue(142, OPEN_A, 76)
    case 'e':
      return isWordEnd ? null : createCue(122, OPEN_E, 70)
    case 'i':
    case 'y':
      return createCue(128, OPEN_I, 76)
    case 'o':
      return createCue(140, OPEN_O, 78)
    case 'u':
      return createCue(136, OPEN_U, 76)
    case 'm':
    case 'b':
    case 'p':
      return createCue(82, CLOSED_MOUTH, 48)
    case 'f':
    case 'v':
      return createCue(82, LABIODENTAL, 58)
    case 'w':
      return createCue(92, SOFT_ROUND, 64)
    case 'r':
      return createCue(74, RHOTIC, 58)
    case 'l':
      return createCue(76, { E: 0.38, I: 0.22 }, 58)
    case 's':
    case 'z':
    case 'x':
      return createCue(70, { E: 0.28, I: 0.18 }, 56)
    case 't':
    case 'd':
    case 'n':
      return createCue(58, CLOSED_MOUTH, 44)
    case 'g':
    case 'k':
    case 'c':
    case 'h':
    case 'j':
    case 'q':
      return createCue(64, { A: 0.12, E: 0.06 }, 54)
    default:
      return null
  }
}

function buildWordLipSyncCues(word: string) {
  const sanitizedWord = word
    .replace(/(^'+|'+$)/g, '')
    .replace(/'/g, '')

  if (!sanitizedWord) {
    return []
  }

  const spokenWord =
    sanitizedWord.length > 2 &&
    sanitizedWord.endsWith('e') &&
    !/[aeiou]e$/.test(sanitizedWord)
      ? sanitizedWord.slice(0, -1)
      : sanitizedWord

  const cues: LipSyncCue[] = []
  let index = 0

  while (index < spokenWord.length) {
    const recipe = matchRecipe(spokenWord, index)
    if (recipe) {
      appendCue(cues, createCue(recipe.durationMs, recipe.weights, recipe.smoothingMs))
      index += recipe.patterns.find((pattern) => spokenWord.startsWith(pattern, index))?.length ?? 1
      continue
    }

    const character = spokenWord[index]
    const cue = buildLetterCue(character, index === spokenWord.length - 1)
    if (cue) {
      appendCue(cues, cue)
    }

    index += 1
  }

  return cues
}

function buildLipSyncCues(text: string): LipSyncCue[] {
  const tokens = tokenizeSpeech(text)
  if (tokens.length === 0) {
    return []
  }

  const cues: LipSyncCue[] = []

  tokens.forEach((token, index) => {
    if (token.type === 'punctuation') {
      const punctuationPauseMs = /[!?]/.test(token.text) ? 170 : 130
      appendCue(cues, createCue(punctuationPauseMs, CLOSED_MOUTH, 56))
      return
    }

    const wordCues = buildWordLipSyncCues(token.text)
    wordCues.forEach((cue) => {
      appendCue(cues, cue)
    })

    const nextToken = tokens[index + 1]
    if (!nextToken) {
      return
    }

    if (nextToken.type === 'punctuation') {
      appendCue(cues, createCue(60, CLOSED_MOUTH, 48))
      return
    }

    appendCue(cues, createCue(74, CLOSED_MOUTH, 48))
  })

  appendCue(cues, createCue(120, CLOSED_MOUTH, 58))
  return cues
}

function getVoiceCuesEndpoint(endpoint: string) {
  return endpoint.replace(/\/speak\/?$/, '/speak-with-cues')
}

function base64ToBlob(base64: string, contentType: string) {
  const binaryString = window.atob(base64)
  const bytes = new Uint8Array(binaryString.length)

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index)
  }

  return new Blob([bytes], { type: contentType })
}

function getRhubarbWeights(value: string): VisemeWeights {
  switch (value) {
    case 'B':
      return { A: 0.08 }
    case 'C':
      return { E: 0.62, I: 0.48 }
    case 'D':
      return { A: 0.92, E: 0.12 }
    case 'E':
      return { O: 0.84 }
    case 'F':
      return { U: 0.9, O: 0.22 }
    case 'G':
      return { E: 0.34, I: 0.18, U: 0.2 }
    case 'H':
      return { E: 0.52, I: 0.34 }
    case 'A':
    case 'X':
    default:
      return CLOSED_MOUTH
  }
}

function buildRhubarbLipSyncCues(mouthCues: RhubarbMouthCue[]): LipSyncCue[] {
  const cues: LipSyncCue[] = []
  let cursorSeconds = 0

  mouthCues.forEach((mouthCue) => {
    const start = Math.max(0, mouthCue.start)
    const end = Math.max(start, mouthCue.end)

    if (start > cursorSeconds + 0.012) {
      cues.push(createCue(Math.round((start - cursorSeconds) * 1000), CLOSED_MOUTH, 20))
    }

    cues.push(createCue(
      Math.max(24, Math.round((end - start) * 1000)),
      getRhubarbWeights(mouthCue.value),
      18,
    ))
    cursorSeconds = end
  })

  cues.push(createCue(80, CLOSED_MOUTH, 24))
  return cues
}

function getCueDurationMs(cues: LipSyncCue[]) {
  return cues.reduce((totalMs, cue) => totalMs + cue.durationMs, 0)
}

function waitForAudioMetadata(audio: HTMLAudioElement) {
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    return Promise.resolve(audio.duration)
  }

  return new Promise<number>((resolve, reject) => {
    const handleLoadedMetadata = () => {
      cleanup()
      resolve(audio.duration)
    }

    const handleError = () => {
      cleanup()
      reject(new Error('Audio metadata failed to load.'))
    }

    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('error', handleError)
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true })
    audio.addEventListener('error', handleError, { once: true })
    audio.load()
  })
}

function useAvatarGLTF(addLog: LogFn): LoadedGLTFState {
  const [state, setState] = useState<LoadedGLTFState>({
    error: null,
    gltf: null,
    loading: true,
  })

  useEffect(() => {
    let isActive = true

    async function loadModel() {
      addLog(`Model fetch starting for ${MODEL_PATH}`)

      try {
        const response = await fetch(MODEL_PATH)
        addLog(
          `Model fetch response: ${response.status} ${response.statusText}, content-type=${response.headers.get(
            'content-type',
          )}, content-length=${response.headers.get('content-length')}`,
        )

        if (!response.ok) {
          throw new Error(`Fetch failed with status ${response.status}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        if (!isActive) {
          return
        }

        addLog(`Downloaded ${arrayBuffer.byteLength} bytes of GLB data`)

        const loader = new GLTFLoader()
        loader.manager.onError = (url) => {
          addLog(`LoadingManager error while fetching asset: ${url}`)
        }
        loader.manager.onLoad = () => {
          addLog('LoadingManager finished GLB parse')
        }

        loader.parse(
          arrayBuffer,
          window.location.origin,
          (gltf) => {
            if (!isActive) {
              return
            }

            addLog(
              `GLB parsed successfully with ${gltf.scene.children.length} top-level scene children.`,
            )
            setState({ error: null, gltf, loading: false })
          },
          (error) => {
            if (!isActive) {
              return
            }

            const message = formatError(error)
            addLog(`GLB parse failed: ${message}`)
            setState({ error: message, gltf: null, loading: false })
          },
        )
      } catch (error) {
        if (!isActive) {
          return
        }

        const message = formatError(error)
        addLog(`Model load failed before parse: ${message}`)
        setState({ error: message, gltf: null, loading: false })
      }
    }

    void loadModel()

    return () => {
      isActive = false
    }
  }, [addLog])

  return state
}

function findMorphMeshes(root: Object3D, addLog: LogFn): Mesh[] {
  const namedMatches: Mesh[] = []
  const allMorphMeshes: Mesh[] = []

  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
      return
    }

    const morphNames = Object.keys(mesh.morphTargetDictionary)
    addLog(
      `Morph mesh detected: ${mesh.name || '(unnamed)'} with ${morphNames.length} targets`,
    )

    allMorphMeshes.push(mesh)

    if (FACE_MESH_PREFIXES.some((prefix) => mesh.name.startsWith(prefix))) {
      namedMatches.push(mesh)
    }
  })

  return namedMatches.length > 0 ? namedMatches : allMorphMeshes
}

function logMaterialSummary(root: Object3D, addLog: LogFn) {
  let meshCount = 0
  let materialCount = 0
  let texturedMaterialCount = 0

  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) {
      return
    }

    meshCount += 1

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    materialCount += materials.length

    materials.forEach((material) => {
      if (
        material &&
        typeof material === 'object' &&
        'map' in material &&
        material.map
      ) {
        texturedMaterialCount += 1
      }
    })
  })

  addLog(
    `Loaded authored materials on ${meshCount} meshes (${materialCount} materials, ${texturedMaterialCount} textured).`,
  )
}

class AvatarCanvasErrorBoundary extends React.Component<
  {
    children: ReactNode
    onError: (error: Error, info: ErrorInfo) => void
  },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: ReactNode; onError: (error: Error, info: ErrorInfo) => void }) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: `${error.name}: ${error.message}`,
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError(error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="loading-state">
          <p>Avatar render failed: {this.state.message}</p>
        </div>
      )
    }

    return this.props.children
  }
}

function AvatarModel({
  onMorphsDetected,
  addLog,
}: {
  onMorphsDetected: ReturnType<typeof useAvatarFaceController>
  addLog: LogFn
}) {
  const sceneGroupRef = useRef<Group>(null)
  const [focusMeshes, setFocusMeshes] = useState<Mesh[]>([])
  const { error, gltf, loading } = useAvatarGLTF(addLog)

  useEffect(() => {
    if (!gltf) {
      return
    }

    gltf.scene.rotation.y = MODEL_Y_ROTATION
    gltf.scene.updateMatrixWorld(true)
    addLog('Rotated avatar 180 degrees so the face points toward the camera')

    logMaterialSummary(gltf.scene, addLog)

    const faceMeshes = findMorphMeshes(gltf.scene, addLog)
    setFocusMeshes(faceMeshes)
    onMorphsDetected.attachFaceMeshes(faceMeshes)

    if (faceMeshes.length > 0) {
      addLog(
        `Using face meshes: ${faceMeshes
          .map((mesh) => mesh.name || '(unnamed)')
          .join(', ')}`,
      )
    } else {
      addLog('No mesh with morph targets found in loaded scene')
    }
  }, [addLog, gltf, onMorphsDetected])

  if (loading) {
    return null
  }

  if (error) {
    throw new Error(`AvatarModel load failed: ${error}`)
  }

  if (!gltf) {
    throw new Error('AvatarModel load failed: GLB returned no scene')
  }

  return (
    <group ref={sceneGroupRef}>
      <FitCameraToModel addLog={addLog} focusMeshes={focusMeshes} modelRoot={sceneGroupRef} />
      <primitive object={gltf.scene} />
    </group>
  )
}

function FitCameraToModel({
  modelRoot,
  addLog,
  focusMeshes,
}: {
  modelRoot: React.RefObject<Group | null>
  addLog: LogFn
  focusMeshes: Mesh[]
}) {
  const { camera, controls, invalidate } = useThree()
  const hasLoggedFit = useRef(false)

  useEffect(() => {
    if (!modelRoot.current) {
      addLog('FitCameraToModel skipped because model root is missing')
      return
    }

    if (!(camera instanceof PerspectiveCamera)) {
      addLog('FitCameraToModel skipped because camera is not perspective')
      return
    }

    const hasFaceFocus = focusMeshes.length > 0
    const box = new Box3()

    if (hasFaceFocus) {
      focusMeshes.forEach((mesh) => {
        box.expandByObject(mesh)
      })
    } else {
      box.setFromObject(modelRoot.current)
    }

    if (box.isEmpty()) {
      addLog(`FitCameraToModel found an empty ${hasFaceFocus ? 'face' : 'model'} bounding box`)
      return
    }

    const initialSize = box.getSize(new Vector3())

    if (hasFaceFocus) {
      box.expandByVector(
        new Vector3(
          Math.max(initialSize.x * 0.42, MIN_FACE_FRAME_PADDING.x),
          Math.max(initialSize.y * 0.82, MIN_FACE_FRAME_PADDING.y),
          Math.max(initialSize.z * 1.35, MIN_FACE_FRAME_PADDING.z),
        ),
      )
    }

    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = (camera.fov * Math.PI) / 180
    const distance = maxDim / (2 * Math.tan(fov / 2))
    const distanceMultiplier = hasFaceFocus ? 1.35 : 1.45

    if (hasFaceFocus) {
      center.y -= size.y * 0.1
    }

    camera.position.set(center.x, center.y, center.z + distance * distanceMultiplier)
    camera.near = Math.max(0.01, distance / 100)
    camera.far = Math.max(100, distance * 100)
    camera.lookAt(center)
    camera.updateProjectionMatrix()

    if (isOrbitControlsLike(controls)) {
      controls.target.copy(center)
      controls.update()
    }

    invalidate()

    if (!hasLoggedFit.current) {
      hasLoggedFit.current = true
      addLog(
        `Camera fit applied (${hasFaceFocus ? 'face-first' : 'full model'}). center=${center
          .toArray()
          .map((v) => v.toFixed(3))
          .join(', ')} size=${size
          .toArray()
          .map((v) => v.toFixed(3))
          .join(', ')} distance=${distance.toFixed(3)}`,
      )
    }
  }, [addLog, camera, controls, focusMeshes, invalidate, modelRoot])

  return null
}

export function TalkingAvatar() {
  const controller = useAvatarFaceController()
  const { addLog, logs } = useAvatarDebugLog()
  const [draftMessage, setDraftMessage] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      content: 'Welcome. Ask for a reading and I will speak the answer as it streams in.',
      id: 'welcome',
      role: 'assistant',
    },
  ])
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [chatError, setChatError] = useState('')
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [voiceEndpoint, setVoiceEndpoint] = useState(DEFAULT_VOICE_ENDPOINT)
  const [voiceName, setVoiceName] = useState(DEFAULT_VOICE_NAME)
  const [voiceStatus, setVoiceStatus] = useState('Madhur voice is ready.')
  const [voiceError, setVoiceError] = useState('')
  const morphSummary = useMemo(
    () => controller.availableMorphs.join(', '),
    [controller.availableMorphs],
  )
  const debugSummary = useMemo(() => logs.join('\n'), [logs])
  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const messagesRef = useRef(messages)
  const objectUrlRef = useRef<string | null>(null)
  const speechBufferRef = useRef('')

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const stopVoicePlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    addLog(`Avatar test page mounted. userAgent=${navigator.userAgent}`)

    const handleWindowError = (event: ErrorEvent) => {
      addLog(`Window error: ${event.message}`)
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      addLog(`Unhandled promise rejection: ${formatError(event.reason)}`)
    }

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      stopVoicePlayback()
    }
  }, [addLog, stopVoicePlayback])

  useEffect(() => {
    let isCancelled = false

    async function inspectModelFetch() {
      addLog(`Preflight fetch starting for ${MODEL_PATH}`)

      try {
        const response = await fetch(MODEL_PATH, { method: 'GET' })
        addLog(
          `Preflight fetch response: ${response.status} ${response.statusText}, content-type=${response.headers.get(
            'content-type',
          )}, content-length=${response.headers.get('content-length')}`,
        )

        if (!response.ok) {
          return
        }

        const blob = await response.blob()
        if (isCancelled) {
          return
        }

        addLog(
          `Preflight blob created: size=${blob.size}, type=${blob.type || '(empty type)'}`,
        )
      } catch (error) {
        addLog(`Preflight fetch failed: ${formatError(error)}`)
      }
    }

    void inspectModelFetch()

    return () => {
      isCancelled = true
    }
  }, [addLog])

  const appendAssistantSpeech = useCallback((text: string, force = false) => {
    speechBufferRef.current += text

    let shouldFlush =
      force ||
      ASSISTANT_SPEECH_FLUSH_PATTERN.test(speechBufferRef.current) ||
      speechBufferRef.current.length >= MAX_STREAMING_SPEECH_BUFFER_LENGTH

    while (shouldFlush) {
      const buffer = speechBufferRef.current
      const sentenceBoundary = buffer.search(ASSISTANT_SPEECH_FLUSH_PATTERN)
      const splitIndex =
        sentenceBoundary >= 0
          ? sentenceBoundary + 1
          : buffer.lastIndexOf(' ', MAX_STREAMING_SPEECH_BUFFER_LENGTH)

      if (!force && splitIndex <= 0) {
        return
      }

      const spokenText =
        splitIndex > 0 ? buffer.slice(0, splitIndex).trim() : buffer.trim()

      speechBufferRef.current =
        splitIndex > 0 ? buffer.slice(splitIndex).trimStart() : ''

      if (spokenText) {
        const cues = buildLipSyncCues(spokenText)
        controller.enqueueVisemeSequence(cues, 'Gemini response')
      }

      shouldFlush =
        force && speechBufferRef.current.trim().length > 0
          ? true
          : ASSISTANT_SPEECH_FLUSH_PATTERN.test(speechBufferRef.current) ||
            speechBufferRef.current.length >= MAX_STREAMING_SPEECH_BUFFER_LENGTH
    }
  }, [controller])

  const readGeminiStream = useCallback(async (
    response: Response,
    onText: (text: string) => void,
  ) => {
    if (!response.body) {
      const data = await response.json()
      const text = data?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? '')
        .join('')

      if (text) {
        onText(text)
      }

      return
    }

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\n\n/)
      buffer = events.pop() ?? ''

      events.forEach((eventText) => {
        const dataLines = eventText
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.replace(/^data:\s?/, '').trim())

        dataLines.forEach((line) => {
          if (!line || line === '[DONE]') {
            return
          }

          try {
            const data = JSON.parse(line)
            const text = data?.candidates?.[0]?.content?.parts
              ?.map((part: { text?: string }) => part.text ?? '')
              .join('')

            if (text) {
              onText(text)
            }
          } catch (error) {
            addLog(`Skipped malformed Gemini stream event: ${formatError(error)}`)
          }
        })
      })
    }

    if (buffer.trim()) {
      buffer
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s?/, '').trim())
        .forEach((line) => {
          try {
            const data = JSON.parse(line)
            const text = data?.candidates?.[0]?.content?.parts
              ?.map((part: { text?: string }) => part.text ?? '')
              .join('')

            if (text) {
              onText(text)
            }
          } catch {
            // The final SSE buffer can contain a partial frame after an abort.
          }
        })
    }
  }, [addLog])

  const playVoiceSpeech = useCallback(async (text: string) => {
    const spokenText = text.trim()
    if (!spokenText) {
      return
    }

    stopVoicePlayback()
    setVoiceError('')
    setVoiceStatus('Generating Madhur audio...')

    try {
      const response = await fetch(getVoiceCuesEndpoint(voiceEndpoint), {
        body: JSON.stringify({
          text: spokenText,
          voice: voiceName.trim() || DEFAULT_VOICE_NAME,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `Voice request failed with ${response.status}`)
      }

      const voiceData = await response.json() as VoiceWithCuesResponse
      const audioBlob = base64ToBlob(voiceData.audioBase64, voiceData.contentType)
      const objectUrl = URL.createObjectURL(audioBlob)
      const audio = new Audio(objectUrl)
      objectUrlRef.current = objectUrl
      audioRef.current = audio
      const audioDurationSeconds = await waitForAudioMetadata(audio)

      audio.addEventListener('ended', () => {
        controller.stopSpeech()
        stopVoicePlayback()
        setVoiceStatus('Madhur voice is ready.')
      }, { once: true })

      audio.addEventListener('error', () => {
        controller.stopSpeech()
        stopVoicePlayback()
        setVoiceStatus('Voice playback failed.')
        setVoiceError('The browser could not play the returned audio.')
      }, { once: true })

      await audio.play()
      const cues = buildRhubarbLipSyncCues(voiceData.mouthCues)
      controller.playVisemeSequence(cues, 'Madhur audio')
      setVoiceStatus('Playing Madhur audio.')
      addLog(
        `Playing voice speech (${audioBlob.size} bytes, audio=${audioDurationSeconds.toFixed(
          2,
        )}s, rhubarbCues=${voiceData.mouthCues.length}, cueDuration=${getCueDurationMs(
          cues,
        )}ms)`,
      )
    } catch (error) {
      const message = formatError(error)
      setVoiceStatus('Madhur voice failed.')
      setVoiceError(message)
      addLog(`Voice failed: ${message}`)
    }
  }, [
    addLog,
    controller,
    stopVoicePlayback,
    voiceEndpoint,
    voiceName,
  ])

  const stopGeminiStream = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    speechBufferRef.current = ''
    stopVoicePlayback()
    controller.stopSpeech()
    setStreamingMessageId(null)
    addLog('Stopped Gemini stream')
  }, [addLog, controller, stopVoicePlayback])

  const sendMessage = useCallback(async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()

    const prompt = draftMessage.trim()
    if (!prompt || streamingMessageId) {
      return
    }

    const userMessage: ChatMessage = {
      content: prompt,
      id: crypto.randomUUID(),
      role: 'user',
    }
    const assistantMessage: ChatMessage = {
      content: '',
      id: crypto.randomUUID(),
      role: 'assistant',
    }
    const nextMessages = [...messagesRef.current, userMessage, assistantMessage]
    const abortController = new AbortController()

    abortControllerRef.current = abortController
    speechBufferRef.current = ''
    setChatError('')
    setDraftMessage('')
    setMessages(nextMessages)
    setStreamingMessageId(assistantMessage.id)
    setVoiceError('')
    controller.stopSpeech()
    stopVoicePlayback()

    const contents = nextMessages
      .filter((message) => message.id !== assistantMessage.id)
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }))

    try {
      const response = await fetch(GEMINI_CHAT_ENDPOINT, {
        body: JSON.stringify({ contents }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `Gemini request failed with ${response.status}`)
      }

      let fullAssistantText = ''
      await readGeminiStream(response, (text) => {
        fullAssistantText += text
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: `${message.content}${text}` }
            : message,
          ),
        )
        if (!voiceEnabled) {
          appendAssistantSpeech(text)
        }
      })

      if (voiceEnabled) {
        await playVoiceSpeech(fullAssistantText)
      } else {
        appendAssistantSpeech('', true)
      }
      addLog(`Completed Gemini stream for prompt "${prompt}"`)
    } catch (error) {
      if (abortController.signal.aborted) {
        return
      }

      const message = formatError(error)
      setChatError(message)
      setMessages((currentMessages) =>
        currentMessages.map((chatMessage) =>
          chatMessage.id === assistantMessage.id && !chatMessage.content
            ? { ...chatMessage, content: 'I could not complete that response.' }
            : chatMessage,
        ),
      )
      addLog(`Gemini stream failed: ${message}`)
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
      setStreamingMessageId(null)
    }
  }, [
    appendAssistantSpeech,
    controller,
    draftMessage,
    playVoiceSpeech,
    readGeminiStream,
    streamingMessageId,
    addLog,
    stopVoicePlayback,
    voiceEnabled,
  ])

  return (
    <div className="avatar-test-layout">
      <div className="canvas-panel">
        <div ref={canvasContainerRef} className="canvas-mount">
          <AvatarCanvasErrorBoundary
            onError={(error, info) => {
              addLog(`React error boundary caught: ${formatError(error)}`)
              addLog(`Component stack: ${info.componentStack?.trim() || '(empty stack)'}`)
            }}
          >
            <Canvas
              camera={{ position: [0, 1.4, 2.2], fov: 28 }}
              onCreated={({ gl, scene }) => {
                gl.setClearColor('#111111')
                addLog(`Canvas created. sceneChildren=${scene.children.length}`)

                const handleContextLost = (event: Event) => {
                  event.preventDefault()
                  addLog('WebGL context lost on canvas')
                }

                const handleContextRestored = () => {
                  addLog('WebGL context restored on canvas')
                }

                gl.domElement.addEventListener('webglcontextlost', handleContextLost)
                gl.domElement.addEventListener('webglcontextrestored', handleContextRestored)
              }}
            >
              <color attach="background" args={['#111111']} />
              <ambientLight intensity={1.6} />
              <directionalLight position={[1.8, 2.6, 2.4]} intensity={2.4} />
              <directionalLight position={[-1.2, 1.7, 1.6]} intensity={1.2} />
              <AvatarModel addLog={addLog} onMorphsDetected={controller} />
              <OrbitControls enablePan={false} makeDefault />
            </Canvas>
          </AvatarCanvasErrorBoundary>
        </div>
      </div>

      <div className="control-panel">
        <div>
          <p className="eyebrow">Live Gemini Avatar</p>
          <h1>Astrology Chat</h1>
          <p className="panel-copy">
            Gemini responses stream directly into the avatar face rig. As text arrives,
            the model queues matching mouth shapes, pauses, and closures so the face
            speaks along with the answer instead of waiting for the full response.
          </p>
        </div>

        <section className="chat-shell" aria-label="Gemini astrology chat">
          <div className="chat-messages">
            {messages.map((message) => (
              <article className={`chat-message ${message.role}`} key={message.id}>
                <p>{message.content || '...'}</p>
              </article>
            ))}
          </div>

          {chatError ? <p className="chat-error">{chatError}</p> : null}
          {voiceError ? <p className="chat-error">{voiceError}</p> : null}

          <form className="chat-composer" onSubmit={sendMessage}>
            <textarea
              className="chat-input"
              disabled={Boolean(streamingMessageId)}
              onChange={(event) => setDraftMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder="Ask about your chart, transit, or compatibility"
              rows={4}
              value={draftMessage}
            />
            <div className="composer-actions">
              <span className="morph-status">
                {streamingMessageId
                  ? 'Gemini is streaming to the avatar.'
                  : controller.isSpeaking
                    ? `Speaking "${controller.activeSpeechLabel}"`
                    : 'Ready for a question.'}
              </span>
              {streamingMessageId ? (
                <button className="control-button secondary" onClick={stopGeminiStream} type="button">
                  Stop
                </button>
              ) : (
                <button className="control-button" disabled={!draftMessage.trim()} type="submit">
                  Send
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="control-group voice-controls" aria-label="Madhur voice controls">
          <label className="toggle-row">
            <input
              checked={voiceEnabled}
              onChange={(event) => {
                const enabled = event.target.checked
                setVoiceEnabled(enabled)
                setVoiceStatus(enabled ? 'Madhur voice is ready.' : 'Madhur voice is off.')
                if (!enabled) {
                  stopVoicePlayback()
                }
              }}
              type="checkbox"
            />
            <span>Madhur voice</span>
          </label>

          <input
            className="word-input"
            disabled={Boolean(streamingMessageId)}
            onChange={(event) => setVoiceEndpoint(event.target.value)}
            placeholder="Voice endpoint"
            value={voiceEndpoint}
          />
          <input
            className="word-input"
            disabled={Boolean(streamingMessageId)}
            onChange={(event) => setVoiceName(event.target.value)}
            placeholder="Voice name"
            value={voiceName}
          />
          <div className="voice-row">
            <span className="morph-status">{voiceStatus}</span>
          </div>
        </section>

        <details className="control-group diagnostics">
          <summary>Avatar Diagnostics</summary>
          <p className="morph-status">
            {controller.availableMorphs.length > 0
              ? `Detected ${controller.availableMorphs.length} morph targets.`
              : `No morph targets detected yet. Put your model at ${MODEL_PATH} and open the page.`}
          </p>
          <textarea className="morph-log" readOnly value={morphSummary} />
          <textarea className="morph-log" readOnly value={debugSummary} />
        </details>
      </div>
    </div>
  )
}
