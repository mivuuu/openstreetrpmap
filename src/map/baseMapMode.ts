import type { Map } from 'maplibre-gl'
import { LAYER_IDS } from '../layers/layerIds'
import {
  DEFAULT_GEOMETRY_DEBUG,
  type GeometryDebugVisibility,
} from './geometryDebug'
import { MAP_EXPRESSIONS, MAP_THEME } from './mapTheme'

export const BASE_MAP_MODES = [
  'vector',
  'terrain',
  'original',
  'combined',
  'land',
  'landOverlay',
] as const
export type BaseMapMode = (typeof BASE_MAP_MODES)[number]

export const BASE_MAP_MODE_LABELS: Readonly<Record<BaseMapMode, string>> = {
  vector: 'Векторная карта',
  terrain: 'Карта + рельеф',
  original: 'Оригинальная карта',
  combined: 'Вектор + оригинал',
  land: 'Вектор суши',
  landOverlay: 'Оригинал + вектор суши',
}

function setVisibility(map: Map, layerId: string, visible: boolean) {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none')
  }
}

export function applyBaseMapMode(
  map: Map,
  mode: BaseMapMode,
  extractionDebug: boolean,
  geometryDebug: GeometryDebugVisibility = DEFAULT_GEOMETRY_DEBUG,
) {
  const landComparison = mode === 'land' || mode === 'landOverlay'
  const showVector = mode !== 'original' || extractionDebug
  setVisibility(map, LAYER_IDS.landFill, showVector && mode !== 'landOverlay')
  setVisibility(map, LAYER_IDS.unclaimedFill, showVector && !landComparison)
  setVisibility(map, LAYER_IDS.unclaimedBorder, showVector && !landComparison)
  setVisibility(
    map,
    LAYER_IDS.countriesFill,
    showVector && !landComparison && geometryDebug.countryFills,
  )
  setVisibility(
    map,
    LAYER_IDS.coastline,
    showVector && mode !== 'landOverlay' && geometryDebug.coastline,
  )
  setVisibility(
    map,
    LAYER_IDS.countriesBorderCasing,
    showVector && !landComparison && geometryDebug.borderCasing,
  )
  setVisibility(
    map,
    LAYER_IDS.countriesBorder,
    showVector && !landComparison && geometryDebug.countryBorders,
  )
  setVisibility(map, LAYER_IDS.countryDebugIds, geometryDebug.countryIds)
  setVisibility(map, LAYER_IDS.countryLabels, showVector && !landComparison)
  setVisibility(map, LAYER_IDS.countryLabelPoints, geometryDebug.countryLabelPoints)
  setVisibility(
    map,
    LAYER_IDS.regionsFill,
    showVector && !landComparison && geometryDebug.regionFills,
  )
  setVisibility(
    map,
    LAYER_IDS.regionsBorder,
    showVector && !landComparison && geometryDebug.regionBorders,
  )
  setVisibility(
    map,
    LAYER_IDS.regionsLabels,
    showVector && !landComparison && geometryDebug.regionLabels && !geometryDebug.regionNumbers,
  )
  setVisibility(
    map,
    LAYER_IDS.capitalsPoint,
    showVector && !landComparison && geometryDebug.regionLabels && !geometryDebug.regionNumbers,
  )
  setVisibility(
    map,
    LAYER_IDS.capitalsLabel,
    showVector && !landComparison && geometryDebug.regionLabels && !geometryDebug.regionNumbers,
  )
  setVisibility(
    map,
    LAYER_IDS.debugRegionNumbers,
    showVector && !landComparison && geometryDebug.regionNumbers,
  )

  if (map.getLayer(LAYER_IDS.originalReference)) {
    map.setPaintProperty(
      LAYER_IDS.originalReference,
      'raster-opacity',
      mode === 'landOverlay'
        ? 0.78
        : extractionDebug
          ? 0
          : mode === 'original'
          ? 1
          : mode === 'combined'
            ? MAP_THEME.raster.originalComparisonOpacity
            : 0,
    )
  }
  if (map.getLayer(LAYER_IDS.terrain)) {
    map.setPaintProperty(
      LAYER_IDS.terrain,
      'raster-opacity',
      extractionDebug || mode !== 'terrain' ? 0 : MAP_EXPRESSIONS.terrainOpacity,
    )
  }
  if (map.getLayer(LAYER_IDS.countryMaskReference)) {
    map.setPaintProperty(
      LAYER_IDS.countryMaskReference,
      'raster-opacity',
      extractionDebug && !landComparison ? MAP_THEME.raster.maskComparisonOpacity : 0,
    )
  }
  if (map.getLayer(LAYER_IDS.landFill)) {
    map.setPaintProperty(
      LAYER_IDS.landFill,
      'fill-opacity',
      extractionDebug && !landComparison ? 0 : mode === 'combined' ? 0.35 : 1,
    )
  }
  if (map.getLayer(LAYER_IDS.countriesFill)) {
    map.setPaintProperty(
      LAYER_IDS.countriesFill,
      'fill-opacity',
      extractionDebug
        ? 0.08
        : mode === 'terrain'
          ? MAP_EXPRESSIONS.countryFillTerrainOpacity
          : mode === 'combined'
            ? MAP_EXPRESSIONS.countryFillReferenceOpacity
            : MAP_EXPRESSIONS.countryFillVectorOpacity,
    )
  }

  setVisibility(map, LAYER_IDS.debugLand, false)
  setVisibility(map, LAYER_IDS.debugLandFill, false)
  setVisibility(map, LAYER_IDS.debugCountriesFill, extractionDebug && !landComparison)
  setVisibility(map, LAYER_IDS.debugCountriesBorder, extractionDebug && !landComparison)
  setVisibility(map, LAYER_IDS.debugRawCountries, geometryDebug.rawGeometry)
  setVisibility(map, LAYER_IDS.debugCleanCountries, geometryDebug.cleanGeometry)
  setVisibility(map, LAYER_IDS.debugCountryVertices, geometryDebug.vertices)
  setVisibility(map, LAYER_IDS.debugUnassignedLand, geometryDebug.unassignedLand)
  setVisibility(map, LAYER_IDS.debugOriginalCountriesFill, geometryDebug.originalCountries)
  setVisibility(map, LAYER_IDS.debugOriginalCountriesBorder, geometryDebug.originalCountries)
  setVisibility(map, LAYER_IDS.debugRegionsFill, geometryDebug.regionDebug)
  setVisibility(map, LAYER_IDS.debugRegionsBorder, geometryDebug.regionDebug)
  setVisibility(map, LAYER_IDS.debugRegionsRaw, geometryDebug.regionDebug)

  if (mode === 'landOverlay') {
    setVisibility(map, LAYER_IDS.debugLandFill, true)
    setVisibility(map, LAYER_IDS.debugLand, true)
  }
}
