import { Suspense } from 'react'
import { TalkingAvatar } from '../components/TalkingAvatar'

function LoadingState() {
  return (
    <div className="loading-state">
      <p>Loading model test scene...</p>
    </div>
  )
}

export function AvatarTestPage() {
  return (
    <main className="page-shell">
      <Suspense fallback={<LoadingState />}>
        <TalkingAvatar />
      </Suspense>
    </main>
  )
}
