import { useEffect, useRef, useState } from 'react'
import type { Map } from 'maplibre-gl'
import { addBaseMapLayers } from '../layers/baseMapLayers'
import { addKleropolInteractions } from '../layers/regionsLayer'
import { applyBaseMapMode, type BaseMapMode } from '../map/baseMapMode'
import { createWorldMap } from '../map/createWorldMap'
import { DEFAULT_GEOMETRY_DEBUG } from '../map/geometryDebug'
import { worldToMap } from '../map/worldCoordinates'
import type { SelectedMapFeature } from '../types/mapFeatures'
import { BaseMapModeControl } from './BaseMapModeControl'
import { FeatureInfoPanel } from './FeatureInfoPanel'
import { GeometryDebugControl } from './GeometryDebugControl'
import { MapControls } from './MapControls'

const ZOOM_DURATION_MS = 300
const CITY_PANEL_WIDTH = 390
const MOBILE_PANEL_BREAKPOINT = 640
const DEBUG_MAP = new URLSearchParams(window.location.search).get('debug') === '1'

function cityPanelCameraOffset(container: HTMLElement): [number, number] {
  if (container.clientWidth <= MOBILE_PANEL_BREAKPOINT) {
    const panelHeight = Math.min(container.clientHeight * 0.72, 600)
    return [0, -panelHeight / 2]
  }

  const panelWidth = Math.min(CITY_PANEL_WIDTH, container.clientWidth - 72)
  return [panelWidth / 2, 0]
}

export function MapViewport() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedCity, setSelectedCity] = useState<SelectedMapFeature | null>(null)
  const [baseMapMode, setBaseMapMode] = useState<BaseMapMode>('vector')
  const [extractionDebug, setExtractionDebug] = useState(DEBUG_MAP)
  const [geometryDebug, setGeometryDebug] = useState(DEFAULT_GEOMETRY_DEBUG)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = createWorldMap(container)
    mapRef.current = map
    const abortController = new AbortController()
    let removeKleropolInteractions: (() => void) | undefined

    const handleLoad = async () => {
      try {
        await addBaseMapLayers(map, abortController.signal, { debugGeometry: DEBUG_MAP })
        applyBaseMapMode(map, baseMapMode, extractionDebug, geometryDebug)
        removeKleropolInteractions = addKleropolInteractions(map, (city) => {
          setSelectedCity(city)
          map.easeTo({
            center: worldToMap(city.worldCoordinates),
            offset: cityPanelCameraOffset(container),
            duration: 550,
          })
        })
        setIsReady(true)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.error(error)
        setLoadError('Не удалось загрузить данные карты')
      }
    }

    map.on('load', handleLoad)

    const resizeObserver = new ResizeObserver(() => {
      if (map.loaded()) map.resize()
    })
    resizeObserver.observe(container)

    return () => {
      abortController.abort()
      removeKleropolInteractions?.()
      resizeObserver.disconnect()
      map.off('load', handleLoad)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (map && isReady) applyBaseMapMode(map, baseMapMode, extractionDebug, geometryDebug)
  }, [baseMapMode, extractionDebug, geometryDebug, isReady])

  const changeZoom = (delta: number) => {
    const map = mapRef.current
    if (!map) return

    map.easeTo({
      zoom: map.getZoom() + delta,
      duration: ZOOM_DURATION_MS,
    })
  }

  return (
    <section className="map-frame" aria-label="Интерактивная карта вымышленного мира">
      <div ref={containerRef} className="map-canvas" />
      <MapControls
        onZoomIn={() => changeZoom(1)}
        onZoomOut={() => changeZoom(-1)}
      />
      <BaseMapModeControl
        mode={baseMapMode}
        extractionDebug={extractionDebug}
        onModeChange={setBaseMapMode}
        onExtractionDebugChange={setExtractionDebug}
        development={DEBUG_MAP}
      />
      {DEBUG_MAP && (
        <GeometryDebugControl visibility={geometryDebug} onChange={setGeometryDebug} />
      )}
      {selectedCity && (
        <FeatureInfoPanel city={selectedCity} onClose={() => setSelectedCity(null)} />
      )}
      <div className={`map-status${isReady ? ' map-status--hidden' : ''}`} role="status">
        {loadError ?? 'Загрузка карты…'}
      </div>
      <div className="map-hint">Перетащите карту · Масштабируйте колесом</div>
    </section>
  )
}
