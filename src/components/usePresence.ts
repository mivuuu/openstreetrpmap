import { useEffect, useRef, useState } from 'react'

export type PresenceState = 'open' | 'closed'

export function usePresence(open: boolean, exitDurationMs: number) {
  const [isMounted, setIsMounted] = useState(open)
  const [state, setState] = useState<PresenceState>(open ? 'open' : 'closed')
  const frameRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)

    if (open) {
      setIsMounted(true)
      setState('closed')
      frameRef.current = requestAnimationFrame(() => setState('open'))
    } else if (isMounted) {
      setState('closed')
      timerRef.current = window.setTimeout(() => setIsMounted(false), exitDurationMs)
    }

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [exitDurationMs, isMounted, open])

  return { isMounted, state }
}
