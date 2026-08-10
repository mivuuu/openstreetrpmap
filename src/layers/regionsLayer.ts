import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'
import type {
  ExpressionSpecification,
  Map,
  MapGeoJSONFeature,
  MapMouseEvent,
} from 'maplibre-gl'
import { worldFeatureCollectionToMap } from '../map/geojsonCoordinates'
import { MAP_THEME } from '../map/mapTheme'
import { mapToWorld } from '../map/worldCoordinates'
import { REGION_LABEL_MIN_ZOOM, REGION_MIN_ZOOM, ZOOM_LEVELS } from '../map/zoomLevels'
import type { SelectedMapFeature } from '../types/mapFeatures'
import { LAYER_IDS } from './layerIds'

const REGIONS_SOURCE_ID = 'regions'
const REGION_BORDERS_SOURCE_ID = 'region-borders'
const REGION_LABELS_SOURCE_ID = 'region-label-points'
const REGIONS_RAW_SOURCE_ID = 'regions-raw-world'
const KLEROPOL_REGION_ID = 'region-010'

const REGION_COLORS = [
  '#e6e1d7', '#e2ded4', '#e8e3da', '#dedbd2', '#e5dfd5',
] as const

function withKleropolCitySemantics(
  collection: FeatureCollection<Geometry, GeoJsonProperties>,
): FeatureCollection<Geometry, GeoJsonProperties> {
  return {
    ...collection,
    features: collection.features.map((feature) => {
      if (feature.properties?.id !== KLEROPOL_REGION_ID) return feature
      return {
        ...feature,
        properties: {
          ...feature.properties,
          featureKind: 'city',
          isCity: true,
          isCapital: true,
        },
      }
    }),
  }
}

function regionColorExpression(): ExpressionSpecification {
  const expression: unknown[] = ['match', ['get', 'styleIndex']]
  REGION_COLORS.forEach((color, index) => expression.push(index, color))
  expression.push(REGION_COLORS[0])
  return expression as ExpressionSpecification
}

export function addRegionAreaLayers(
  map: Map,
  regions: FeatureCollection<Geometry, GeoJsonProperties>,
  borders: FeatureCollection<Geometry, GeoJsonProperties>,
) {
  map.addSource(REGIONS_SOURCE_ID, {
    type: 'geojson',
    data: worldFeatureCollectionToMap(withKleropolCitySemantics(regions)),
    promoteId: 'id',
  })
  map.addSource(REGION_BORDERS_SOURCE_ID, {
    type: 'geojson',
    data: worldFeatureCollectionToMap(borders),
    promoteId: 'id',
  })
  map.addLayer({
    id: LAYER_IDS.regionsFill,
    type: 'fill',
    source: REGIONS_SOURCE_ID,
    minzoom: REGION_MIN_ZOOM,
    paint: {
      'fill-color': regionColorExpression(),
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        REGION_MIN_ZOOM, 0,
        ZOOM_LEVELS.REGION, 0.025,
        ZOOM_LEVELS.CITY, 0.045,
        ZOOM_LEVELS.LOCAL, 0.065,
      ],
    },
  })
  map.addLayer({
    id: LAYER_IDS.regionsBorder,
    type: 'line',
    source: REGION_BORDERS_SOURCE_ID,
    minzoom: REGION_MIN_ZOOM,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_THEME.colors.regionBorder,
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        REGION_MIN_ZOOM, 0.3,
        3.2, 0.4,
        ZOOM_LEVELS.REGION, 0.7,
        ZOOM_LEVELS.CITY, 1.05,
        ZOOM_LEVELS.LOCAL, 1.2,
        ZOOM_LEVELS.DETAIL, 1.3,
      ],
      'line-opacity': [
        'interpolate', ['linear'], ['zoom'],
        REGION_MIN_ZOOM, 0,
        3.2, 0.25,
        ZOOM_LEVELS.REGION, 0.55,
        ZOOM_LEVELS.CITY, 0.82,
        ZOOM_LEVELS.LOCAL, 0.94,
      ],
    },
  })
}

export function addRegionLabelLayer(
  map: Map,
  labels: FeatureCollection<Geometry, GeoJsonProperties>,
) {
  map.addSource(REGION_LABELS_SOURCE_ID, {
    type: 'geojson',
    data: worldFeatureCollectionToMap(withKleropolCitySemantics(labels)),
    promoteId: 'id',
  })
  map.addLayer({
    id: LAYER_IDS.kleropolCapitalPoint,
    type: 'circle',
    source: REGION_LABELS_SOURCE_ID,
    filter: ['==', ['get', 'isCity'], true],
    paint: {
      'circle-radius': [
        'case',
        ['boolean', ['feature-state', 'hover'], false], 4,
        3.2,
      ],
      'circle-color': '#263638',
      'circle-stroke-color': '#fffdf6',
      'circle-stroke-width': 1.25,
    },
  })
  map.addLayer({
    id: LAYER_IDS.regionsLabels,
    type: 'symbol',
    source: REGION_LABELS_SOURCE_ID,
    minzoom: 3,
    filter: ['!=', ['get', 'isCity'], true],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': [...MAP_THEME.typography.fonts],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        REGION_LABEL_MIN_ZOOM, [
          'case',
          ['boolean', ['get', 'isCapital'], false], 11.5,
          ['==', ['get', 'labelRank'], 1], 11,
          ['==', ['get', 'labelRank'], 2], 10.5,
          10,
        ],
        ZOOM_LEVELS.LOCAL, [
          'case',
          ['boolean', ['get', 'isCapital'], false], 14,
          ['==', ['get', 'labelRank'], 1], 13.5,
          ['==', ['get', 'labelRank'], 2], 12.5,
          11,
        ],
      ],
      'text-padding': 4,
      'text-max-width': 9,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'symbol-sort-key': [
        'case',
        ['boolean', ['get', 'isCapital'], false], 0,
        ['get', 'labelRank'],
      ],
    },
    paint: {
      'text-color': [
        'case',
        ['boolean', ['get', 'isCapital'], false], MAP_THEME.colors.regionCapitalLabel,
        MAP_THEME.colors.regionLabel,
      ],
      'text-halo-color': MAP_THEME.colors.labels.halo,
      'text-halo-width': MAP_THEME.typography.haloWidth,
      'text-halo-blur': MAP_THEME.typography.haloBlur,
      'text-opacity': [
        'interpolate', ['linear'], ['zoom'],
        3, 0,
        REGION_LABEL_MIN_ZOOM, [
          'case', ['boolean', ['get', 'isCapital'], false], 0.55, 0,
        ],
        4.3, [
          'case',
          ['boolean', ['get', 'isCapital'], false], 0.95,
          ['==', ['get', 'labelRank'], 1], 0.92,
          ['==', ['get', 'labelRank'], 2], 0.15,
          0,
        ],
        5, [
          'case', ['==', ['get', 'labelRank'], 3], 0, 0.92,
        ],
        6.2, 0.92,
      ],
    },
  })
  map.addLayer({
    id: LAYER_IDS.kleropolLabel,
    type: 'symbol',
    source: REGION_LABELS_SOURCE_ID,
    filter: ['==', ['get', 'isCity'], true],
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Segoe UI Semibold', 'Arial Bold', 'sans-serif'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        ZOOM_LEVELS.WORLD, 12,
        ZOOM_LEVELS.LOCAL, 14.5,
        ZOOM_LEVELS.DETAIL, 15,
      ],
      'text-anchor': 'left',
      'text-offset': [0.75, 0],
      'text-padding': 4,
      'text-max-width': 9,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'symbol-sort-key': 0,
    },
    paint: {
      'text-color': '#263638',
      'text-halo-color': MAP_THEME.colors.labels.halo,
      'text-halo-width': 1.3,
      'text-halo-blur': MAP_THEME.typography.haloBlur,
    },
  })
}

function isKleropolFeature(feature: MapGeoJSONFeature) {
  return feature.properties.id === KLEROPOL_REGION_ID && feature.properties.isCity === true
}

function firstKleropolFeature(map: Map, event: MapMouseEvent) {
  return map
    .queryRenderedFeatures(event.point, {
      layers: [LAYER_IDS.kleropolCapitalPoint, LAYER_IDS.kleropolLabel],
    })
    .find(isKleropolFeature)
}

export function addKleropolInteractions(
  map: Map,
  onSelect: (feature: SelectedMapFeature) => void,
) {
  let hovered = false

  const setHovered = (nextHovered: boolean) => {
    if (hovered === nextHovered) return
    hovered = nextHovered
    map.setFeatureState(
      { source: REGION_LABELS_SOURCE_ID, id: KLEROPOL_REGION_ID },
      { hover: hovered },
    )
  }

  const handleMouseMove = (event: MapMouseEvent) => {
    const nextHovered = Boolean(firstKleropolFeature(map, event))
    setHovered(nextHovered)
    map.getCanvas().style.cursor = nextHovered ? 'pointer' : ''
  }

  const handleMouseLeave = () => {
    setHovered(false)
    map.getCanvas().style.cursor = ''
  }

  const handleClick = (event: MapMouseEvent) => {
    const feature = firstKleropolFeature(map, event)
    if (!feature || feature.geometry.type !== 'Point') return

    const [longitude, latitude] = feature.geometry.coordinates
    const number = feature.properties.number
    const name = feature.properties.name
    onSelect({
      properties: {
        id: KLEROPOL_REGION_ID,
        number: typeof number === 'number' ? number : 10,
        name: typeof name === 'string' ? name : 'Клерополь',
        type: 'region',
        featureKind: 'city',
        isCity: true,
        isCapital: true,
      },
      worldCoordinates: mapToWorld(longitude, latitude),
    })
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

export function addRegionDebugLayers(
  map: Map,
  rawRegions?: FeatureCollection<Geometry, GeoJsonProperties>,
) {
  map.addLayer({
    id: LAYER_IDS.debugRegionNumbers,
    type: 'symbol',
    source: REGION_LABELS_SOURCE_ID,
    minzoom: REGION_LABEL_MIN_ZOOM,
    layout: {
      visibility: 'none',
      'text-field': [
        'concat',
        ['to-string', ['get', 'number']],
        '\n',
        ['get', 'name'],
      ],
      'text-font': [...MAP_THEME.typography.fonts],
      'text-size': 11,
      'text-padding': 3,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'symbol-sort-key': ['get', 'labelRank'],
    },
    paint: {
      'text-color': MAP_THEME.colors.regionLabel,
      'text-halo-color': MAP_THEME.colors.labels.halo,
      'text-halo-width': 1.3,
      'text-halo-blur': MAP_THEME.typography.haloBlur,
    },
  })
  map.addLayer({
    id: LAYER_IDS.debugRegionsFill,
    type: 'fill',
    source: REGIONS_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: { 'fill-color': '#ffe85b', 'fill-opacity': 0.22 },
  })
  map.addLayer({
    id: LAYER_IDS.debugRegionsBorder,
    type: 'line',
    source: REGION_BORDERS_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: { 'line-color': '#33f4ff', 'line-width': 2, 'line-opacity': 0.95 },
  })
  if (!rawRegions) return
  map.addSource(REGIONS_RAW_SOURCE_ID, {
    type: 'geojson',
    data: worldFeatureCollectionToMap(rawRegions),
    promoteId: 'id',
  })
  map.addLayer({
    id: LAYER_IDS.debugRegionsRaw,
    type: 'line',
    source: REGIONS_RAW_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: { 'line-color': '#ff3fa4', 'line-width': 1.5, 'line-opacity': 0.9 },
  })
}
