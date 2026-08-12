import type {
  Map,
  MapGeoJSONFeature,
  MapMouseEvent,
} from 'maplibre-gl'
import { worldFeatureCollectionToMap } from '../map/geojsonCoordinates'
import {
  cityLabelSizeExpression,
  cityRadiusExpression,
  MAP_THEME,
} from '../map/mapTheme'
import { mapToWorld } from '../map/worldCoordinates'
import { CITY_MIN_ZOOM } from '../map/zoomLevels'
import {
  CITY_RANKS,
  type CityFeature,
  type CityFeatureCollection,
  type CityProperties,
  type CityRank,
  type SelectedCity,
} from '../types/mapFeatures'
import type { WorldPoint } from '../types/world'
import {
  CAPITAL_FILTER,
  CAPITAL_LABEL_FONT,
  CAPITAL_LABEL_SIZE,
  CAPITAL_POINT_RADIUS,
  CAPITAL_STYLE,
} from './capitalStyle'

const CITIES_URL = `${import.meta.env.BASE_URL}data/cities.geojson`
const CITIES_SOURCE_ID = 'cities'
const cityPointLayerId = (rank: CityRank) => `cities-${rank}-points`
const cityLabelLayerId = (rank: CityRank) => `cities-${rank}-labels`
const CITY_POINT_LAYER_IDS = CITY_RANKS.map(cityPointLayerId)
const CITY_INTERACTIVE_LAYER_IDS = [
  ...CITY_POINT_LAYER_IDS,
  ...CITY_RANKS.map(cityLabelLayerId),
]

export const CITY_ZOOM_THRESHOLDS: Readonly<Record<CityRank, number>> = {
  ...CITY_MIN_ZOOM,
}

type CitiesLayerOptions = {
  signal: AbortSignal
  onSelectCity: (city: SelectedCity) => void
  onEmptyMapClick?: (point: WorldPoint) => void
}

type CitiesLayerCleanup = () => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCityRank(value: unknown): value is CityRank {
  return typeof value === 'string' && CITY_RANKS.includes(value as CityRank)
}

function isCityFeature(value: unknown): value is CityFeature {
  if (!isRecord(value) || value.type !== 'Feature') return false
  if (!isRecord(value.geometry) || value.geometry.type !== 'Point') return false

  const coordinates = value.geometry.coordinates
  if (
    !Array.isArray(coordinates) ||
    coordinates.length !== 2 ||
    !coordinates.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  ) {
    return false
  }

  const properties = value.properties
  return (
    isRecord(properties) &&
    typeof properties.id === 'string' &&
    typeof properties.name === 'string' &&
    properties.type === 'city' &&
    isCityRank(properties.rank) &&
    typeof properties.population === 'number' &&
    Number.isFinite(properties.population)
  )
}

function parseCityFeatureCollection(value: unknown): CityFeatureCollection {
  if (!isRecord(value) || value.type !== 'FeatureCollection') {
    throw new Error('Некорректный формат /data/cities.geojson')
  }

  const features = value.features
  if (!Array.isArray(features) || !features.every(isCityFeature)) {
    throw new Error('Некорректный формат /data/cities.geojson')
  }

  return { type: 'FeatureCollection', features }
}

async function loadCities(signal: AbortSignal): Promise<CityFeatureCollection> {
  const response = await fetch(CITIES_URL, { signal })
  if (!response.ok) {
    throw new Error(`Не удалось загрузить города: HTTP ${response.status}`)
  }

  return parseCityFeatureCollection(await response.json())
}

function convertCitiesToMapCoordinates(
  cities: CityFeatureCollection,
): CityFeatureCollection {
  return worldFeatureCollectionToMap(cities) as CityFeatureCollection
}

function cityRankFromFeature(feature: MapGeoJSONFeature): CityRank | null {
  const rank = feature.properties.rank
  return isCityRank(rank) ? rank : null
}

function isFeatureVisibleAtZoom(feature: MapGeoJSONFeature, zoom: number) {
  if (
    feature.properties.isCapital === true ||
    feature.properties.capital === true ||
    feature.properties.rank === 'capital'
  ) return true
  const rank = cityRankFromFeature(feature)
  return rank !== null && zoom >= CITY_ZOOM_THRESHOLDS[rank]
}

function firstVisibleCityFeature(map: Map, event: MapMouseEvent) {
  return map
    .queryRenderedFeatures(event.point, {
      layers: CITY_INTERACTIVE_LAYER_IDS,
    })
    .find((feature) => isFeatureVisibleAtZoom(feature, map.getZoom()))
}

function originalCityIndex(cities: CityFeatureCollection) {
  return new globalThis.Map(
    cities.features.map((feature) => {
      const [x, y] = feature.geometry.coordinates
      const selected: SelectedCity = {
        properties: feature.properties,
        worldCoordinates: { x, y },
      }
      return [feature.properties.id, selected] as const
    }),
  )
}

function cityIdFromFeature(feature: MapGeoJSONFeature) {
  const id = feature.properties.id
  return typeof id === 'string' ? id : null
}

export async function addCitiesLayer(
  map: Map,
  options: CitiesLayerOptions,
): Promise<CitiesLayerCleanup> {
  const cities = await loadCities(options.signal)
  if (options.signal.aborted) return () => undefined

  const cityById = originalCityIndex(cities)

  map.addSource(CITIES_SOURCE_ID, {
    type: 'geojson',
    data: convertCitiesToMapCoordinates(cities),
    promoteId: 'id',
  })

  for (const rank of CITY_RANKS) {
    const isCapital = rank === 'capital'
    const baseRadius = cityRadiusExpression(rank)

    map.addLayer({
      id: cityPointLayerId(rank),
      type: 'circle',
      source: CITIES_SOURCE_ID,
      ...(isCapital ? {} : { minzoom: CITY_ZOOM_THRESHOLDS[rank] }),
      filter: isCapital
        ? CAPITAL_FILTER
        : ['all', ['==', ['get', 'rank'], rank], ['!', CAPITAL_FILTER]],
      paint: {
        'circle-radius': isCapital ? CAPITAL_POINT_RADIUS : baseRadius,
        'circle-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          MAP_THEME.colors.citySymbol.hover,
          isCapital ? CAPITAL_STYLE.pointColor : MAP_THEME.colors.citySymbol[rank],
        ],
        'circle-stroke-color': isCapital
          ? CAPITAL_STYLE.pointStrokeColor
          : MAP_THEME.colors.citySymbol.stroke,
        'circle-stroke-width': isCapital
          ? CAPITAL_STYLE.pointStrokeWidth
          : MAP_THEME.symbols.strokeWidth,
      },
    })
  }

  for (const rank of CITY_RANKS) {
    const isCapital = rank === 'capital'

    map.addLayer({
      id: cityLabelLayerId(rank),
      type: 'symbol',
      source: CITIES_SOURCE_ID,
      ...(isCapital ? {} : { minzoom: CITY_ZOOM_THRESHOLDS[rank] }),
      filter: isCapital
        ? CAPITAL_FILTER
        : ['all', ['==', ['get', 'rank'], rank], ['!', CAPITAL_FILTER]],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': isCapital ? [...CAPITAL_LABEL_FONT] : [...MAP_THEME.typography.fonts],
        'text-size': isCapital ? CAPITAL_LABEL_SIZE : cityLabelSizeExpression(rank),
        ...(isCapital
          ? { 'text-anchor': 'left' as const, 'text-offset': [0.75, 0] as [number, number] }
          : {
              'text-variable-anchor': ['top', 'bottom', 'left', 'right'] as const,
              'text-radial-offset': 0.8,
              'text-justify': 'auto' as const,
            }),
        'text-padding': isCapital ? 4 : 3,
        'text-max-width': isCapital ? 9 : 10,
        'text-allow-overlap': isCapital,
        'text-ignore-placement': false,
        ...(isCapital ? { 'symbol-sort-key': 0 } : {}),
      },
      paint: {
        'text-color': isCapital
          ? CAPITAL_STYLE.textColor
          : MAP_THEME.colors.labels.secondary,
        'text-halo-color': MAP_THEME.colors.labels.halo,
        'text-halo-width': isCapital
          ? CAPITAL_STYLE.textHaloWidth
          : MAP_THEME.typography.haloWidth,
        'text-halo-blur': MAP_THEME.typography.haloBlur,
      },
    })
  }

  let hoveredCityId: string | number | null = null

  const clearHoveredCity = () => {
    if (hoveredCityId !== null) {
      map.setFeatureState(
        { source: CITIES_SOURCE_ID, id: hoveredCityId },
        { hover: false },
      )
      hoveredCityId = null
    }
  }

  const handleMouseMove = (event: MapMouseEvent) => {
    const feature = firstVisibleCityFeature(map, event)
    const nextId = feature?.id ?? null

    if (nextId === hoveredCityId) return
    clearHoveredCity()

    if (nextId !== null) {
      hoveredCityId = nextId
      map.setFeatureState(
        { source: CITIES_SOURCE_ID, id: hoveredCityId },
        { hover: true },
      )
    }

    map.getCanvas().style.cursor = nextId === null ? '' : 'pointer'
  }

  const handleMouseLeave = () => {
    clearHoveredCity()
    map.getCanvas().style.cursor = ''
  }

  const handleClick = (event: MapMouseEvent) => {
    const feature = firstVisibleCityFeature(map, event)
    if (feature) {
      const id = cityIdFromFeature(feature)
      const selectedCity = id === null ? undefined : cityById.get(id)
      if (selectedCity) options.onSelectCity(selectedCity)
      return
    }

    if (options.onEmptyMapClick) {
      options.onEmptyMapClick(mapToWorld(event.lngLat.lng, event.lngLat.lat))
    }
  }

  map.on('mousemove', handleMouseMove)
  map.on('click', handleClick)
  map.getCanvas().addEventListener('mouseleave', handleMouseLeave)

  return () => {
    map.off('mousemove', handleMouseMove)
    map.off('click', handleClick)
    map.getCanvas().removeEventListener('mouseleave', handleMouseLeave)
  }
}
