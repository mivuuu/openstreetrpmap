import type { Dispatch, SetStateAction } from 'react'
import {
  GEOMETRY_DEBUG_LABELS,
  type GeometryDebugVisibility,
} from '../map/geometryDebug'

type GeometryDebugControlProps = {
  visibility: GeometryDebugVisibility
  onChange: Dispatch<SetStateAction<GeometryDebugVisibility>>
}

export function GeometryDebugControl({ visibility, onChange }: GeometryDebugControlProps) {
  return (
    <aside className="geometry-debug" aria-label="Отладочные слои геометрии">
      <span className="geometry-debug__title">Отладка геометрии</span>
      <div className="geometry-debug__options">
        {(Object.keys(GEOMETRY_DEBUG_LABELS) as Array<keyof GeometryDebugVisibility>).map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={visibility[key]}
              onChange={(event) => {
                const checked = event.target.checked
                onChange((current) => ({ ...current, [key]: checked }))
              }}
            />
            <span>{GEOMETRY_DEBUG_LABELS[key]}</span>
          </label>
        ))}
      </div>
    </aside>
  )
}
