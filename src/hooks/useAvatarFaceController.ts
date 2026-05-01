import { useCallback, useEffect, useRef, useState } from 'react'
import type { Mesh } from 'three'

const visemeToMorph = {
  A: 'Fcl_MTH_A',
  I: 'Fcl_MTH_I',
  U: 'Fcl_MTH_U',
  E: 'Fcl_MTH_E',
  O: 'Fcl_MTH_O',
} as const

const expressionToMorph = {
  Joy: 'Fcl_BRW_Fun',
  Angry: 'Fcl_BRW_Angry',
} as const

type VisemeName = keyof typeof visemeToMorph
type ExpressionName = keyof typeof expressionToMorph
type VisemeWeights = Partial<Record<VisemeName, number>>
type LipSyncCue = {
  durationMs: number
  smoothingMs?: number
  weights?: VisemeWeights
}

type ResolvedVisemeWeights = Record<VisemeName, number>
type SpeechPlan = {
  cueEndTimes: number[]
  cues: Required<LipSyncCue>[]
  label: string
  startTimeMs: number | null
  totalDurationMs: number
}

const ZERO_VISEME_WEIGHTS: ResolvedVisemeWeights = {
  A: 0,
  E: 0,
  I: 0,
  O: 0,
  U: 0,
}

function setMorphValue(mesh: Mesh | null, name: string, value: number) {
  if (!mesh?.morphTargetDictionary || !mesh.morphTargetInfluences) {
    return false
  }

  const index = mesh.morphTargetDictionary[name]
  if (index === undefined) {
    return false
  }

  mesh.morphTargetInfluences[index] = value
  return true
}

function clampWeight(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(1, Math.max(0, value ?? 0))
}

function resolveVisemeWeights(weights?: VisemeWeights): ResolvedVisemeWeights {
  return {
    A: clampWeight(weights?.A),
    E: clampWeight(weights?.E),
    I: clampWeight(weights?.I),
    O: clampWeight(weights?.O),
    U: clampWeight(weights?.U),
  }
}

function resolveCue(cue: LipSyncCue): Required<LipSyncCue> {
  return {
    durationMs: Math.max(16, cue.durationMs),
    smoothingMs: Math.max(24, cue.smoothingMs ?? 72),
    weights: resolveVisemeWeights(cue.weights),
  }
}

function resolveCues(cues: LipSyncCue[]) {
  return cues
    .filter((cue) => cue.durationMs > 0)
    .map(resolveCue)
}

function interpolateWeight(current: number, target: number, deltaMs: number, smoothingMs: number) {
  const blend = 1 - Math.exp(-deltaMs / smoothingMs)
  return current + (target - current) * blend
}

export function useAvatarFaceController() {
  const faceMeshesRef = useRef<Mesh[]>([])
  const blinkTimeoutRef = useRef<number | null>(null)
  const speechFrameRef = useRef<number | null>(null)
  const speechLastTickRef = useRef<number | null>(null)
  const speechPlanRef = useRef<SpeechPlan | null>(null)
  const appliedVisemeWeightsRef = useRef<ResolvedVisemeWeights>(ZERO_VISEME_WEIGHTS)
  const [activeSpeechLabel, setActiveSpeechLabel] = useState('')
  const [availableMorphs, setAvailableMorphs] = useState<string[]>([])
  const [isSpeaking, setIsSpeaking] = useState(false)

  const attachFaceMeshes = useCallback((meshes: Mesh[]) => {
    faceMeshesRef.current = meshes

    const morphs = meshes[0]?.morphTargetDictionary
      ? Object.keys(meshes[0].morphTargetDictionary).sort()
      : []

    setAvailableMorphs(morphs)
  }, [])

  const setRawMorph = useCallback((name: string, weight: number) => {
    let updated = false

    faceMeshesRef.current.forEach((mesh) => {
      updated = setMorphValue(mesh, name, weight) || updated
    })

    return updated
  }, [])

  const clearSpeechAnimation = useCallback(() => {
    if (speechFrameRef.current) {
      window.cancelAnimationFrame(speechFrameRef.current)
      speechFrameRef.current = null
    }

    speechLastTickRef.current = null
    speechPlanRef.current = null
  }, [])

  const applyVisemeWeights = useCallback((weights?: VisemeWeights) => {
    const resolvedWeights = resolveVisemeWeights(weights)
    appliedVisemeWeightsRef.current = resolvedWeights

    let updated = false

    ;(Object.keys(visemeToMorph) as VisemeName[]).forEach((name) => {
      updated = setRawMorph(visemeToMorph[name], resolvedWeights[name]) || updated
    })

    return updated
  }, [setRawMorph])

  const resetMouth = useCallback(() => {
    applyVisemeWeights()
  }, [applyVisemeWeights])

  const resetExpressions = useCallback(() => {
    Object.values(expressionToMorph).forEach((morphName) => {
      faceMeshesRef.current.forEach((mesh) => {
        setMorphValue(mesh, morphName, 0)
      })
    })
  }, [])

  const stopSpeech = useCallback(() => {
    clearSpeechAnimation()
    applyVisemeWeights()
    setActiveSpeechLabel('')
    setIsSpeaking(false)
  }, [applyVisemeWeights, clearSpeechAnimation])

  const setViseme = useCallback((name: VisemeName, weight: number) => {
    clearSpeechAnimation()
    setActiveSpeechLabel('')
    setIsSpeaking(false)
    return applyVisemeWeights({ [name]: weight })
  }, [applyVisemeWeights, clearSpeechAnimation])

  const setExpression = useCallback((name: ExpressionName, weight: number) => {
    resetExpressions()
    return setRawMorph(expressionToMorph[name], weight)
  }, [resetExpressions, setRawMorph])

  const blink = useCallback((durationMs = 180) => {
    if (!setRawMorph('Fcl_EYE_Close', 1)) {
      return false
    }

    if (blinkTimeoutRef.current) {
      window.clearTimeout(blinkTimeoutRef.current)
    }

    blinkTimeoutRef.current = window.setTimeout(() => {
      setRawMorph('Fcl_EYE_Close', 0)
    }, durationMs)

    return true
  }, [setRawMorph])

  const playVisemeSequence = useCallback((cues: LipSyncCue[], label = 'Preview') => {
    clearSpeechAnimation()

    const resolvedCues = resolveCues(cues)

    if (resolvedCues.length === 0) {
      applyVisemeWeights()
      setActiveSpeechLabel('')
      setIsSpeaking(false)
      return false
    }

    const cueEndTimes: number[] = []
    let totalDurationMs = 0

    resolvedCues.forEach((cue) => {
      totalDurationMs += cue.durationMs
      cueEndTimes.push(totalDurationMs)
    })

    speechPlanRef.current = {
      cueEndTimes,
      cues: resolvedCues,
      label,
      startTimeMs: null,
      totalDurationMs,
    }
    speechLastTickRef.current = null
    setActiveSpeechLabel(label)
    setIsSpeaking(true)

    const tick = (now: number) => {
      const plan = speechPlanRef.current
      if (!plan) {
        return
      }

      if (plan.startTimeMs === null) {
        plan.startTimeMs = now
      }

      const lastTick = speechLastTickRef.current ?? now
      const deltaMs = Math.max(16, now - lastTick)
      speechLastTickRef.current = now

      const elapsedMs = now - plan.startTimeMs
      if (elapsedMs >= plan.totalDurationMs) {
        stopSpeech()
        return
      }

      const cueIndex = plan.cueEndTimes.findIndex((endTimeMs) => elapsedMs < endTimeMs)
      const activeCue = plan.cues[Math.max(0, cueIndex)]
      const targetWeights = resolveVisemeWeights(activeCue.weights)
      const currentWeights = appliedVisemeWeightsRef.current

      applyVisemeWeights({
        A: interpolateWeight(currentWeights.A, targetWeights.A, deltaMs, activeCue.smoothingMs),
        E: interpolateWeight(currentWeights.E, targetWeights.E, deltaMs, activeCue.smoothingMs),
        I: interpolateWeight(currentWeights.I, targetWeights.I, deltaMs, activeCue.smoothingMs),
        O: interpolateWeight(currentWeights.O, targetWeights.O, deltaMs, activeCue.smoothingMs),
        U: interpolateWeight(currentWeights.U, targetWeights.U, deltaMs, activeCue.smoothingMs),
      })

      speechFrameRef.current = window.requestAnimationFrame(tick)
    }

    speechFrameRef.current = window.requestAnimationFrame(tick)
    return true
  }, [applyVisemeWeights, clearSpeechAnimation, stopSpeech])

  const enqueueVisemeSequence = useCallback((cues: LipSyncCue[], label = 'Assistant') => {
    const resolvedCues = resolveCues(cues)

    if (resolvedCues.length === 0) {
      return false
    }

    const activePlan = speechPlanRef.current
    if (!activePlan) {
      return playVisemeSequence(cues, label)
    }

    resolvedCues.forEach((cue) => {
      activePlan.totalDurationMs += cue.durationMs
      activePlan.cueEndTimes.push(activePlan.totalDurationMs)
      activePlan.cues.push(cue)
    })

    activePlan.label = label
    setActiveSpeechLabel(label)
    setIsSpeaking(true)

    return true
  }, [playVisemeSequence])

  useEffect(() => {
    return () => {
      if (blinkTimeoutRef.current) {
        window.clearTimeout(blinkTimeoutRef.current)
      }

      clearSpeechAnimation()
    }
  }, [clearSpeechAnimation])

  return {
    activeSpeechLabel,
    applyVisemeWeights,
    attachFaceMeshes,
    availableMorphs,
    blink,
    enqueueVisemeSequence,
    isSpeaking,
    playVisemeSequence,
    resetExpressions,
    resetMouth,
    setExpression,
    setRawMorph,
    setViseme,
    stopSpeech,
    visemeToMorph,
  }
}

export type { ExpressionName, LipSyncCue, VisemeName, VisemeWeights }
