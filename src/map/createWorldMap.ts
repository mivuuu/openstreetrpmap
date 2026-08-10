import { Map as MapLibreMap, setWorkerUrl, type Map } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { BASE_MAP_STYLE } from './mapStyle'
import { MAP_BOUNDS, WORLD_BOUNDS, WORLD_CENTER } from './worldCoordinates'

const MAX_ZOOM = 18
const MIN_ZOOM_EXTRA = 0.45
const MAPLIBRE_WORLD_SIZE_AT_ZOOM_ZERO = 512

setWorkerUrl(workerUrl)

function calculateInitialMinZoom(container: HTMLElement) {
  const viewportWidth = Math.max(1, container.clientWidth)
  const viewportHeight = Math.max(1, container.clientHeight)
  const projectedWorldWidth = MAPLIBRE_WORLD_SIZE_AT_ZOOM_ZERO
  const projectedWorldHeight = projectedWorldWidth * (WORLD_BOUNDS.height / WORLD_BOUNDS.width)
  const oldCalculatedMinZoom = Math.log2(Math.min(
    viewportWidth / projectedWorldWidth,
    viewportHeight / projectedWorldHeight,
  ))

  return oldCalculatedMinZoom - MIN_ZOOM_EXTRA
}

export function createWorldMap(container: HTMLElement): Map {
  const minZoom = calculateInitialMinZoom(container)
  const map = new MapLibreMap({
    container,
    style: BASE_MAP_STYLE,
    center: WORLD_CENTER,
    zoom: minZoom,
    minZoom,
    maxZoom: MAX_ZOOM,
    maxBounds: MAP_BOUNDS,
    renderWorldCopies: false,
    attributionControl: false,
    pitchWithRotate: false,
    dragRotate: false,
    touchPitch: false,
  })

  map.keyboard.disableRotation()
  map.touchZoomRotate.disableRotation()

  return map
}
