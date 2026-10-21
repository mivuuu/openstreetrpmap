import { useEffect, useRef, useState } from 'react'
import type { Map } from 'maplibre-gl'
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'
import * as turf from '@turf/turf'
import { mapToWorld, worldToMap } from '../map/worldCoordinates'
import type { StudioMode, StudioTool } from './types'

type Props = {
  map: Map | null
  activeTool: StudioTool
  mode: StudioMode
  countryLabels: FeatureCollection<Point>
  regionLabels: FeatureCollection<Point>
  countries: FeatureCollection<Polygon | MultiPolygon>
  regions: FeatureCollection<Polygon | MultiPolygon>
  onSliceLine: (points: [number, number][]) => void
  onRedrawBorderLine: (points: [number, number][]) => void
  onBucketClick: (worldPt: [number, number]) => void
  onMoveLabel: (labelId: string, newWorldPt: [number, number], type: 'country' | 'region') => void
}

export function StudioDrawingCanvas({
  map,
  activeTool,
  mode,
  countryLabels,
  regionLabels,
  countries,
  regions,
  onSliceLine,
  onRedrawBorderLine,
  onBucketClick,
  onMoveLabel,
}: Props) {
  const [isDrawing, setIsDrawing] = useState(false)
  const [screenStroke, setScreenStroke] = useState<[number, number][]>([])
  const worldPointsRef = useRef<[number, number][]>([])
  const containerRef = useRef<SVGSVGElement | null>(null)

  // Label dragging state
  const [draggingLabel, setDraggingLabel] = useState<{
    id: string
    type: 'country' | 'region'
    feature: Feature<Polygon | MultiPolygon>
    currentWorldPt: [number, number]
  } | null>(null)

  // Map panning with right click or spacebar
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<{ x: number; y: number } | null>(null)
  const isSpacePressedRef = useRef(false)

  const isInteractive = activeTool !== 'select'

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        isSpacePressedRef.current = true
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // Keep scroll zoom ALWAYS enabled on map
  useEffect(() => {
    if (!map) return
    map.scrollZoom.enable()
    if (activeTool === 'slice-region' || activeTool === 'redraw-border') {
      map.dragPan.disable()
      map.boxZoom.disable()
    } else {
      map.dragPan.enable()
      map.boxZoom.enable()
    }
    return () => {
      map.dragPan.enable()
      map.boxZoom.enable()
      map.scrollZoom.enable()
    }
  }, [map, activeTool])

  const getScreenCoords = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  const screenToWorld = (screenX: number, screenY: number): [number, number] | null => {
    if (!map) return null
    const lngLat = map.unproject([screenX, screenY])
    const world = mapToWorld(lngLat.lng, lngLat.lat)
    return [world.x, world.y]
  }

  // Forward mouse wheel events to MapLibre canvas for zooming
  const handleWheel = (e: React.WheelEvent) => {
    if (!map) return
    const canvas = map.getCanvas()
    const simulatedEvent = new WheelEvent('wheel', {
      clientX: e.clientX,
      clientY: e.clientY,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaZ: e.deltaZ,
      deltaMode: e.deltaMode,
      bubbles: true,
      cancelable: true,
    })
    canvas.dispatchEvent(simulatedEvent)
  }

  // Clamp world point inside a polygon boundary
  const clampPointInside = (
    worldPt: [number, number],
    feature: Feature<Polygon | MultiPolygon>,
  ): [number, number] => {
    try {
      if (turf.booleanPointInPolygon(worldPt, feature)) {
        return worldPt
      }
      // If outside, find nearest point on border
      const line = turf.polygonToLine(feature)
      if (line) {
        const nearest = turf.nearestPointOnLine(line as any, turf.point(worldPt))
        const coords = nearest.geometry.coordinates as [number, number]
        return coords
      }
    } catch {
      // Return unconstrained on error
    }
    return worldPt
  }

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Right click (2), middle click (1), or Spacebar: start panning map!
    if (e.button === 2 || e.button === 1 || isSpacePressedRef.current) {
      e.preventDefault()
      e.stopPropagation()
      setIsPanning(true)
      panStartRef.current = { x: e.clientX, y: e.clientY }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }

    if (!isInteractive || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Ignore
    }

    const [sx, sy] = getScreenCoords(e)
    const world = screenToWorld(sx, sy)
    if (!world) return

    // Tool: Bucket fill
    if (activeTool === 'bucket-fill') {
      onBucketClick(world)
      return
    }

    // Tool: Move label
    if (activeTool === 'move-label') {
      const activeLabelSet = mode === 'countries' ? countryLabels : regionLabels
      const activePolygonSet = mode === 'countries' ? countries : regions

      // Find nearest label handle to click within 24 screen pixels
      let nearestLabel: Feature<Point> | null = null
      let nearestDist = 32

      for (const lbl of activeLabelSet.features) {
        const [wx, wy] = lbl.geometry.coordinates
        const [lng, lat] = worldToMap({ x: wx, y: wy })
        const screen = map?.project([lng, lat])
        if (screen) {
          const d = Math.hypot(screen.x - sx, screen.y - sy)
          if (d < nearestDist) {
            nearestDist = d
            nearestLabel = lbl
          }
        }
      }

      if (nearestLabel) {
        const targetId = mode === 'countries'
          ? nearestLabel.properties?.countryId
          : nearestLabel.properties?.id
        const poly = activePolygonSet.features.find((f) => f.properties?.id === targetId)

        if (poly) {
          setDraggingLabel({
            id: nearestLabel.properties?.id,
            type: mode === 'countries' ? 'country' : 'region',
            feature: poly,
            currentWorldPt: [nearestLabel.geometry.coordinates[0], nearestLabel.geometry.coordinates[1]],
          })
          return
        }
      }
      return
    }

    // Tools: Slice region & Redraw border
    setIsDrawing(true)
    setScreenStroke([[sx, sy]])
    worldPointsRef.current = [world]
  }

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // Handle panning
    if (isPanning && panStartRef.current && map) {
      e.preventDefault()
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
      panStartRef.current = { x: e.clientX, y: e.clientY }
      map.panBy([-dx, -dy], { duration: 0 })
      return
    }

    // Handle dragging label
    if (draggingLabel) {
      e.preventDefault()
      const [sx, sy] = getScreenCoords(e)
      const rawWorld = screenToWorld(sx, sy)
      if (!rawWorld) return

      const clamped = clampPointInside(rawWorld, draggingLabel.feature)
      setDraggingLabel((prev) => (prev ? { ...prev, currentWorldPt: clamped } : null))
      onMoveLabel(draggingLabel.id, clamped, draggingLabel.type)
      return
    }

    if (!isDrawing || !isInteractive) return
    e.preventDefault()
    e.stopPropagation()

    const [sx, sy] = getScreenCoords(e)
    const last = screenStroke[screenStroke.length - 1]
    if (last && Math.hypot(sx - last[0], sy - last[1]) < 2) {
      return
    }

    const world = screenToWorld(sx, sy)
    if (!world) return

    setScreenStroke((prev) => [...prev, [sx, sy]])
    worldPointsRef.current.push(world)
  }

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isPanning) {
      setIsPanning(false)
      panStartRef.current = null
      return
    }

    if (draggingLabel) {
      setDraggingLabel(null)
      return
    }

    if (!isDrawing) return
    e.preventDefault()
    e.stopPropagation()

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
    } catch {
      // Ignore
    }

    setIsDrawing(false)
    const worldPts = worldPointsRef.current
    setScreenStroke([])
    worldPointsRef.current = []

    if (worldPts.length < 2) return

    if (activeTool === 'slice-region') {
      onSliceLine(worldPts)
    } else if (activeTool === 'redraw-border') {
      onRedrawBorderLine(worldPts)
    }
  }

  if (!isInteractive) return null

  const pathD = screenStroke.length > 1
    ? `M ${screenStroke.map(([x, y]) => `${x} ${y}`).join(' L ')}`
    : ''

  // Project label points to screen for visible drag handles
  const activeLabels = mode === 'countries' ? countryLabels : regionLabels
  const visibleLabelHandles = activeTool === 'move-label' && map
    ? activeLabels.features.map((f) => {
        const [wx, wy] = f.geometry.coordinates
        const [lng, lat] = worldToMap({ x: wx, y: wy })
        const pos = map.project([lng, lat])
        return {
          id: f.properties?.id,
          name: f.properties?.name || '',
          x: pos.x,
          y: pos.y,
        }
      })
    : []

  return (
    <svg
      ref={containerRef}
      className="studio-drawing-overlay"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 40,
        pointerEvents: 'auto',
        touchAction: 'none',
        userSelect: 'none',
        cursor:
          isPanning
            ? 'grabbing'
            : activeTool === 'bucket-fill'
              ? 'cell'
              : activeTool === 'move-label'
                ? draggingLabel ? 'grabbing' : 'grab'
                : 'crosshair',
      }}
    >
      <defs>
        <filter id="studio-line-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Render thin crisp drawn line */}
      {pathD && (
        <path
          d={pathD}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#studio-line-glow)"
        />
      )}

      {/* Render visible draggable label handles in move-label mode */}
      {visibleLabelHandles.map((handle) => (
        <g key={handle.id} transform={`translate(${handle.x}, ${handle.y})`}>
          <circle r="9" fill="rgba(56, 189, 248, 0.25)" stroke="#38bdf8" strokeWidth="1.5" />
          <circle r="3.5" fill="#38bdf8" />
          <text
            x="12"
            y="4"
            fill="#f8fafc"
            fontSize="11"
            fontWeight="600"
            style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)', pointerEvents: 'none' }}
          >
            {handle.name}
          </text>
        </g>
      ))}
    </svg>
  )
}
