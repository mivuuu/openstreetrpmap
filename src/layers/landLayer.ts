import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'
import type { Map } from 'maplibre-gl'
import { worldFeatureCollectionToMap } from '../map/geojsonCoordinates'
import { MAP_EXPRESSIONS, MAP_THEME } from '../map/mapTheme'
import { LAYER_IDS } from './layerIds'

export const LAND_SOURCE_ID = 'land'
export const COASTLINE_SOURCE_ID = 'coastline'
const UNASSIGNED_LAND_SOURCE_ID = 'unassigned-land'
const UNCLAIMED_SOURCE_ID = 'unclaimed-land'

export function addLandLayer(
  map: Map,
  land: FeatureCollection<Geometry, GeoJsonProperties>,
) {
  map.addSource(LAND_SOURCE_ID, {
    type: 'geojson',
    data: worldFeatureCollectionToMap(land),
    promoteId: 'id',
  })
  map.addLayer({
    id: LAYER_IDS.landFill,
    type: 'fill',
    source: LAND_SOURCE_ID,
    paint: { 'fill-color': MAP_THEME.colors.land, 'fill-opacity': 1 },
  })
}

export function addCoastlineLayer(
  map: Map,
  coastline: FeatureCollection<Geometry, GeoJsonProperties>,
) {
  map.addSource(COASTLINE_SOURCE_ID, {
    type: 'geojson',
    data: worldFeatureCollectionToMap(coastline),
    promoteId: 'id',
  })
  map.addLayer({
    id: LAYER_IDS.coastline,
    type: 'line',
    source: COASTLINE_SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_THEME.colors.coastline,
      'line-width': MAP_EXPRESSIONS.coastlineWidth,
      'line-opacity': 0.82,
    },
  })
}

export function addUnclaimedLandLayer(
  map: Map,
  unclaimed: FeatureCollection<Geometry, GeoJsonProperties>,
) {
  map.addSource(UNCLAIMED_SOURCE_ID, {
    type: 'geojson',
    data: worldFeatureCollectionToMap(unclaimed),
    promoteId: 'id',
  })
  map.addLayer({
    id: LAYER_IDS.unclaimedFill,
    type: 'fill',
    source: UNCLAIMED_SOURCE_ID,
    paint: {
      'fill-color': MAP_THEME.colors.unclaimedLand,
      'fill-opacity': 1,
    },
  })
  map.addLayer({
    id: LAYER_IDS.unclaimedBorder,
    type: 'line',
    source: UNCLAIMED_SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_THEME.colors.unclaimedBorder,
      'line-width': 0.8,
      'line-opacity': 0.72,
    },
  })
}

export function addLandDebugLayer(map: Map) {
  map.addLayer({
    id: LAYER_IDS.debugLandFill,
    type: 'fill',
    source: LAND_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': '#35d89a',
      'fill-opacity': 0.34,
    },
  })
  map.addLayer({
    id: LAYER_IDS.debugLand,
    type: 'line',
    source: LAND_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'line-color': '#25edff',
      'line-width': 2.2,
      'line-opacity': 0.95,
    },
  })
}

export function addUnassignedLandDebugLayer(
  map: Map,
  unassignedLand?: FeatureCollection<Geometry, GeoJsonProperties>,
) {
  if (!unassignedLand) return
  map.addSource(UNASSIGNED_LAND_SOURCE_ID, {
    type: 'geojson',
    data: worldFeatureCollectionToMap(unassignedLand),
    promoteId: 'id',
  })
  map.addLayer({
    id: LAYER_IDS.debugUnassignedLand,
    type: 'fill',
    source: UNASSIGNED_LAND_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': '#ff9f43',
      'fill-opacity': 0.52,
      'fill-outline-color': '#713d16',
    },
  })
}
