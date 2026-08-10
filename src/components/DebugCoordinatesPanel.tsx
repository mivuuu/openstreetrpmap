import { useState } from 'react'
import type { WorldPoint } from '../types/world'

type DebugCoordinatesPanelProps = {
  point: WorldPoint
}

export function DebugCoordinatesPanel({ point }: DebugCoordinatesPanelProps) {
  const [copied, setCopied] = useState(false)
  const x = Math.round(point.x)
  const y = Math.round(point.y)

  const copyCoordinates = async () => {
    await navigator.clipboard.writeText(`[${x}, ${y}]`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <aside className="debug-panel" aria-label="Debug coordinates">
      <span className="debug-panel__badge">DEBUG</span>
      <div>World X: {x}</div>
      <div>World Y: {y}</div>
      <button type="button" onClick={copyCoordinates}>
        {copied ? 'Copied' : 'Copy coordinates'}
      </button>
    </aside>
  )
}
