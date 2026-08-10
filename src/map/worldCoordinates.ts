import type { LngLatBoundsLike } from 'maplibre-gl'
import type { WorldBounds, WorldPoint } from '../types/world'
import { clamp } from '../utils/clamp'

// The public coordinate system used by all future world data.
// One unit currently equals one source-image pixel; (0, 0) is the top-left.
export const WORLD_BOUNDS: WorldBounds = Object.freeze({
  width: 1925,
  height: 1080,
})

// MapLibre wraps +180 to -180. Keeping a tiny inset avoids treating the two
// edges of our finite world as the same point while remaining pixel-identical.
const MAX_MAP_LONGITUDE = 179.999
const HORIZONTAL_SPAN = MAX_MAP_LONGITUDE * 2
const PROJECTED_VERTICAL_SPAN =
  HORIZONTAL_SPAN * (WORLD_BOUNDS.height / WORLD_BOUNDS.width)

type MapCoordinate = [number, number]

function projectedYToLatitude(projectedY: number) {
  const radians = (-projectedY * Math.PI) / 180
  return (Math.atan(Math.sinh(radians)) * 180) / Math.PI
}

function latitudeToProjectedY(latitude: number) {
  const radians = (latitude * Math.PI) / 180
  return (-Math.log(Math.tan(Math.PI / 4 + radians / 2)) * 180) / Math.PI
}

/**
 * Adapter for MapLibre's camera. Application data must use WorldPoint instead
 * of accessing these implementation coordinates directly.
 */
export function worldToMap(point: WorldPoint): MapCoordinate {
  const x = clamp(point.x, 0, WORLD_BOUNDS.width)
  const y = clamp(point.y, 0, WORLD_BOUNDS.height)
  const longitude = (x / WORLD_BOUNDS.width) * HORIZONTAL_SPAN - MAX_MAP_LONGITUDE
  const projectedY =
    (y / WORLD_BOUNDS.height - 0.5) * PROJECTED_VERTICAL_SPAN

  return [longitude, projectedYToLatitude(projectedY)]
}

export function mapToWorld(longitude: number, latitude: number): WorldPoint {
  const x = ((longitude + MAX_MAP_LONGITUDE) / HORIZONTAL_SPAN) * WORLD_BOUNDS.width
  const projectedY = latitudeToProjectedY(latitude)
  const y =
    (projectedY / PROJECTED_VERTICAL_SPAN + 0.5) * WORLD_BOUNDS.height

  return {
    x: clamp(x, 0, WORLD_BOUNDS.width),
    y: clamp(y, 0, WORLD_BOUNDS.height),
  }
}

export const WORLD_CENTER = worldToMap({
  x: WORLD_BOUNDS.width / 2,
  y: WORLD_BOUNDS.height / 2,
})

export const MAP_BOUNDS: LngLatBoundsLike = [
  worldToMap({ x: 0, y: WORLD_BOUNDS.height }),
  worldToMap({ x: WORLD_BOUNDS.width, y: 0 }),
]

export const IMAGE_CORNERS: [
  MapCoordinate,
  MapCoordinate,
  MapCoordinate,
  MapCoordinate,
] = [
  worldToMap({ x: 0, y: 0 }),
  worldToMap({ x: WORLD_BOUNDS.width, y: 0 }),
  worldToMap({ x: WORLD_BOUNDS.width, y: WORLD_BOUNDS.height }),
  worldToMap({ x: 0, y: WORLD_BOUNDS.height }),
]
