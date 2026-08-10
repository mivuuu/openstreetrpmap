import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'
import type { Map } from 'maplibre-gl'
import { assignCountryThemeColors } from '../map/countryColorAssignment'
import { worldFeatureCollectionToMap } from '../map/geojsonCoordinates'
import {
  countryPaletteExpression,
  MAP_EXPRESSIONS,
  MAP_THEME,
} from '../map/mapTheme'
import { LAYER_IDS } from './layerIds'

export const COUNTRIES_SOURCE_ID = 'countries'
export const COUNTRY_BORDERS_SOURCE_ID = 'country-borders'
const RAW_COUNTRIES_SOURCE_ID = 'countries-raw'
const COUNTRY_VERTICES_SOURCE_ID = 'country-vertices'
const ORIGINAL_COUNTRIES_SOURCE_ID = 'countries-original'
const ORIGINAL_COUNTRY_BORDERS_SOURCE_ID = 'country-borders-original'

export function addCountriesFillLayer(
  map: Map,
  countries: FeatureCollection<Geometry, GeoJsonProperties>,
) {
  map.addSource(COUNTRIES_SOURCE_ID, {
    type: 'geojson',
    data: worldFeatureCollectionToMap(assignCountryThemeColors(countries)),
    promoteId: 'id',
  })
  map.addLayer({
    id: LAYER_IDS.countriesFill,
    type: 'fill',
    source: COUNTRIES_SOURCE_ID,
    paint: {
      'fill-color': countryPaletteExpression(),
      'fill-opacity': MAP_EXPRESSIONS.countryFillVectorOpacity,
    },
  })
}

export function addCountriesBorderLayers(
  map: Map,
  borders: FeatureCollection<Geometry, GeoJsonProperties>,
) {
  map.addSource(COUNTRY_BORDERS_SOURCE_ID, {
    type: 'geojson',
    data: worldFeatureCollectionToMap(borders),
    promoteId: 'id',
  })
  map.addLayer({
    id: LAYER_IDS.countriesBorderCasing,
    type: 'line',
    source: COUNTRY_BORDERS_SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_THEME.colors.countryBorderCasing,
      'line-width': MAP_EXPRESSIONS.countryBorderCasingWidth,
      'line-opacity': 0.42,
    },
  })
  map.addLayer({
    id: LAYER_IDS.countriesBorder,
    type: 'line',
    source: COUNTRY_BORDERS_SOURCE_ID,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': MAP_THEME.colors.countryBorder,
      'line-width': MAP_EXPRESSIONS.countryBorderWidth,
      'line-opacity': 0.88,
    },
  })
}

export function addCountriesDebugLayers(
  map: Map,
  rawCountries?: FeatureCollection<Geometry, GeoJsonProperties>,
  vertices?: FeatureCollection<Geometry, GeoJsonProperties>,
  originalCountries?: FeatureCollection<Geometry, GeoJsonProperties>,
  originalBorders?: FeatureCollection<Geometry, GeoJsonProperties>,
) {
  map.addLayer({
    id: LAYER_IDS.debugCountriesFill,
    type: 'fill',
    source: COUNTRIES_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': MAP_THEME.colors.debug.fill,
      'fill-opacity': 0.12,
    },
  })
  map.addLayer({
    id: LAYER_IDS.debugCountriesBorder,
    type: 'line',
    source: COUNTRIES_SOURCE_ID,
    layout: { visibility: 'none' },
    paint: {
      'line-color': MAP_THEME.colors.debug.border,
      'line-width': 1.8,
      'line-opacity': 0.98,
    },
  })
  map.addLayer({
    id: LAYER_IDS.debugCleanCountries,
    type: 'line',
    source: COUNTRIES_SOURCE_ID,
    layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#28f2c4',
      'line-width': 1.4,
      'line-opacity': 0.9,
    },
  })

  if (rawCountries) {
    map.addSource(RAW_COUNTRIES_SOURCE_ID, {
      type: 'geojson',
      data: worldFeatureCollectionToMap(rawCountries),
      promoteId: 'id',
    })
    map.addLayer({
      id: LAYER_IDS.debugRawCountries,
      type: 'line',
      source: RAW_COUNTRIES_SOURCE_ID,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ff3fa4',
        'line-width': 1.4,
        'line-opacity': 0.88,
      },
    })
  }

  if (vertices) {
    map.addSource(COUNTRY_VERTICES_SOURCE_ID, {
      type: 'geojson',
      data: worldFeatureCollectionToMap(vertices),
      promoteId: 'id',
    })
    map.addLayer({
      id: LAYER_IDS.debugCountryVertices,
      type: 'circle',
      source: COUNTRY_VERTICES_SOURCE_ID,
      minzoom: 9,
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 2.2,
        'circle-color': '#fff36c',
        'circle-stroke-color': '#222b2c',
        'circle-stroke-width': 0.7,
        'circle-opacity': 0.95,
      },
    })
  }

  if (originalCountries && originalBorders) {
    map.addSource(ORIGINAL_COUNTRIES_SOURCE_ID, {
      type: 'geojson',
      data: worldFeatureCollectionToMap(originalCountries),
      promoteId: 'id',
    })
    map.addSource(ORIGINAL_COUNTRY_BORDERS_SOURCE_ID, {
      type: 'geojson',
      data: worldFeatureCollectionToMap(originalBorders),
      promoteId: 'id',
    })
    map.addLayer({
      id: LAYER_IDS.debugOriginalCountriesFill,
      type: 'fill',
      source: ORIGINAL_COUNTRIES_SOURCE_ID,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': '#ff2bb5',
        'fill-opacity': 0.22,
      },
    })
    map.addLayer({
      id: LAYER_IDS.debugOriginalCountriesBorder,
      type: 'line',
      source: ORIGINAL_COUNTRY_BORDERS_SOURCE_ID,
      layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ff75d1',
        'line-width': 1.8,
        'line-opacity': 0.95,
      },
    })
  }
}
