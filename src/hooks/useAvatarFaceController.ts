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
  const faceMeshesRef = useRef<Mesh[]>([])
  const blinkTimeoutRef = useRef<number | null>(null)
  const [availableMorphs, setAvailableMorphs] = useState<string[]>([])

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

  const resetMouth = useCallback(() => {
    Object.values(visemeToMorph).forEach((morphName) => {
      faceMeshesRef.current.forEach((mesh) => {
        setMorphValue(mesh, morphName, 0)
      })
    })
  }, [])

  const resetExpressions = useCallback(() => {
    Object.values(expressionToMorph).forEach((morphName) => {
      faceMeshesRef.current.forEach((mesh) => {
        setMorphValue(mesh, morphName, 0)
      })
    })
  }, [])

  const setViseme = useCallback((name: VisemeName, weight: number) => {
    resetMouth()
    return setRawMorph(visemeToMorph[name], weight)
  }, [resetMouth, setRawMorph])

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

  useEffect(() => {
    return () => {
      if (blinkTimeoutRef.current) {
        window.clearTimeout(blinkTimeoutRef.current)
      }
    }
  }, [])

  return {
    attachFaceMeshes,
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
