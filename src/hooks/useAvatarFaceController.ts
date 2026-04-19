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

export function useAvatarFaceController() {
  const faceMeshRef = useRef<Mesh | null>(null)
  const blinkTimeoutRef = useRef<number | null>(null)
  const [availableMorphs, setAvailableMorphs] = useState<string[]>([])

  const attachFaceMesh = useCallback((mesh: Mesh | null) => {
    faceMeshRef.current = mesh

    const morphs = mesh?.morphTargetDictionary
      ? Object.keys(mesh.morphTargetDictionary).sort()
      : []

    setAvailableMorphs(morphs)
  }, [])

  const setRawMorph = useCallback((name: string, weight: number) => {
    return setMorphValue(faceMeshRef.current, name, weight)
  }, [])

  const resetMouth = useCallback(() => {
    Object.values(visemeToMorph).forEach((morphName) => {
      setMorphValue(faceMeshRef.current, morphName, 0)
    })
  }, [])

  const resetExpressions = useCallback(() => {
    Object.values(expressionToMorph).forEach((morphName) => {
      setMorphValue(faceMeshRef.current, morphName, 0)
    })
  }, [])

  const setViseme = useCallback((name: VisemeName, weight: number) => {
    resetMouth()
    return setMorphValue(faceMeshRef.current, visemeToMorph[name], weight)
  }, [resetMouth])

  const setExpression = useCallback((name: ExpressionName, weight: number) => {
    resetExpressions()
    return setMorphValue(faceMeshRef.current, expressionToMorph[name], weight)
  }, [resetExpressions])

  const blink = useCallback((durationMs = 180) => {
    if (!setMorphValue(faceMeshRef.current, 'Fcl_EYE_Close', 1)) {
      return false
    }

    if (blinkTimeoutRef.current) {
      window.clearTimeout(blinkTimeoutRef.current)
    }

    blinkTimeoutRef.current = window.setTimeout(() => {
      setMorphValue(faceMeshRef.current, 'Fcl_EYE_Close', 0)
    }, durationMs)

    return true
  }, [])

  useEffect(() => {
    return () => {
      if (blinkTimeoutRef.current) {
        window.clearTimeout(blinkTimeoutRef.current)
      }
    }
  }, [])

  return {
    attachFaceMesh,
    availableMorphs,
    blink,
    resetExpressions,
    resetMouth,
    setExpression,
    setRawMorph,
    setViseme,
    visemeToMorph,
  }
}

export type { ExpressionName, VisemeName }
