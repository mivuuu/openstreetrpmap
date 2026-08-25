import type { ExpressionSpecification, Map } from 'maplibre-gl'
import { LAYER_IDS } from '../layers/layerIds'
import { CITY_RANKS, type CityRank } from '../types/mapFeatures'

export type MapColorScheme = 'light' | 'dark'

export const DEFAULT_MAP_COLOR_SCHEME: MapColorScheme = 'dark'
export const MAP_COLOR_SCHEME_STORAGE_KEY = 'fictional-world-map-color-scheme'

type MapColorPalette = {
  ocean: string
  land: string
  unclaimedLand: string
  unclaimedBorder: string
  countryPalette: readonly string[]
  countryBorder: string
  countryBorderCasing: string
  coastline: string
  regionPalette: readonly string[]
  regionBorder: string
  regionLabel: string
  regionCapitalLabel: string
  countryLabel: string
  labelHalo: string
  capitalPoint: string
  capitalStroke: string
  capitalLabel: string
  cityHover: string
  cityStroke: string
  citySymbols: Readonly<Record<CityRank, string>>
  raster: {
    brightnessMax: number
    contrast: number
    saturation: number
  }
}

export const MAP_COLOR_PALETTES: Readonly<Record<MapColorScheme, MapColorPalette>> = {
  light: {
    ocean: '#a9c7ce',
    land: '#f1ede3',
    unclaimedLand: '#d8d0c3',
    unclaimedBorder: '#8a8882',
    countryPalette: [
      '#d8c8ad', '#c4d5bc', '#b9d1d3', '#dbc0bc',
      '#cbc5d8', '#d7d2a9', '#dfc7b4', '#bad2c8',
    ],
    countryBorder: '#67655f',
    countryBorderCasing: '#77736c',
    coastline: '#6c8589',
    regionPalette: ['#e6e1d7', '#e2ded4', '#e8e3da', '#dedbd2', '#e5dfd5'],
    regionBorder: '#68665f',
    regionLabel: '#343632',
    regionCapitalLabel: '#4b3933',
    countryLabel: '#3f4645',
    labelHalo: 'rgba(250, 247, 238, 0.9)',
    capitalPoint: '#263638',
    capitalStroke: '#fffdf6',
    capitalLabel: '#263638',
    cityHover: '#c65e55',
    cityStroke: '#fffaf0',
    citySymbols: {
      capital: '#a6554e',
      major: '#405c61',
      city: '#526a6e',
      town: '#667b7e',
      village: '#77898b',
    },
    raster: { brightnessMax: 1, contrast: 0, saturation: 0 },
  },
  dark: {
    ocean: '#102832',
    land: '#293235',
    unclaimedLand: '#3a3d3c',
    unclaimedBorder: '#838d8e',
    countryPalette: [
      '#5a4c3b', '#405846', '#3b5860', '#604749',
      '#4f4a63', '#5a573d', '#624e40', '#3e5953',
    ],
    countryBorder: '#b0b9ba',
    countryBorderCasing: '#1c282c',
    coastline: '#7697a0',
    regionPalette: ['#51585a', '#4b5453', '#56585a', '#4d4f55', '#525652'],
    regionBorder: '#96a1a2',
    regionLabel: '#d5dddd',
    regionCapitalLabel: '#f0e7da',
    countryLabel: '#e2e8e8',
    labelHalo: 'rgba(11, 20, 24, 0.94)',
    capitalPoint: '#f3eee4',
    capitalStroke: '#111a1e',
    capitalLabel: '#f3eee4',
    cityHover: '#ff8f73',
    cityStroke: '#172126',
    citySymbols: {
      capital: '#f3eee4',
      major: '#b7c9cb',
      city: '#9fb3b6',
      town: '#8da3a6',
      village: '#7f9699',
    },
    raster: { brightnessMax: 0.55, contrast: 0.08, saturation: -0.28 },
  },
}

export function readStoredMapColorScheme(): MapColorScheme {
  try {
    const stored = window.localStorage.getItem(MAP_COLOR_SCHEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_MAP_COLOR_SCHEME
  } catch {
    return DEFAULT_MAP_COLOR_SCHEME
  }
}

export function storeMapColorScheme(scheme: MapColorScheme) {
  try {
    window.localStorage.setItem(MAP_COLOR_SCHEME_STORAGE_KEY, scheme)
  } catch {
    // The switch still works when persistent storage is unavailable.
  }
}

function paletteExpression(
  property: string,
  colors: readonly string[],
): ExpressionSpecification {
  const expression: unknown[] = ['match', ['get', property]]
  colors.forEach((color, index) => expression.push(index, color))
  expression.push(colors[0])
  return expression as ExpressionSpecification
}

function setPaint(
  map: Map,
  layerId: string,
  property: Parameters<Map['setPaintProperty']>[1],
  value: Parameters<Map['setPaintProperty']>[2],
) {
  if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value)
}

function applyRasterPalette(map: Map, layerId: string, palette: MapColorPalette) {
  setPaint(map, layerId, 'raster-brightness-min', 0)
  setPaint(map, layerId, 'raster-brightness-max', palette.raster.brightnessMax)
  setPaint(map, layerId, 'raster-contrast', palette.raster.contrast)
  setPaint(map, layerId, 'raster-saturation', palette.raster.saturation)
}

function applyCityPalette(map: Map, palette: MapColorPalette) {
  for (const rank of CITY_RANKS) {
    const pointLayerId = `cities-${rank}-points`
    const labelLayerId = `cities-${rank}-labels`
    const isCapital = rank === 'capital'

    setPaint(map, pointLayerId, 'circle-color', [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      palette.cityHover,
      isCapital ? palette.capitalPoint : palette.citySymbols[rank],
    ])
    setPaint(
      map,
      pointLayerId,
      'circle-stroke-color',
      isCapital ? palette.capitalStroke : palette.cityStroke,
    )
    setPaint(
      map,
      labelLayerId,
      'text-color',
      isCapital ? palette.capitalLabel : palette.regionLabel,
    )
    setPaint(map, labelLayerId, 'text-halo-color', palette.labelHalo)
  }
}

export function applyMapColorScheme(map: Map, scheme: MapColorScheme) {
  const palette = MAP_COLOR_PALETTES[scheme]

  setPaint(map, LAYER_IDS.ocean, 'background-color', palette.ocean)
  setPaint(map, LAYER_IDS.landFill, 'fill-color', palette.land)
  setPaint(map, LAYER_IDS.unassignedFill, 'fill-color', palette.unclaimedLand)
  setPaint(map, LAYER_IDS.unclaimedFill, 'fill-color', palette.unclaimedLand)
  setPaint(map, LAYER_IDS.unclaimedBorder, 'line-color', palette.unclaimedBorder)
  setPaint(map, LAYER_IDS.countriesFill, 'fill-color', paletteExpression('themeColorIndex', palette.countryPalette))
  setPaint(map, LAYER_IDS.countriesBorderCasing, 'line-color', palette.countryBorderCasing)
  setPaint(map, LAYER_IDS.countriesBorder, 'line-color', palette.countryBorder)
  setPaint(map, LAYER_IDS.coastline, 'line-color', palette.coastline)
  setPaint(map, LAYER_IDS.regionsFill, 'fill-color', paletteExpression('styleIndex', palette.regionPalette))
  setPaint(map, LAYER_IDS.regionsBorder, 'line-color', palette.regionBorder)
  setPaint(map, LAYER_IDS.regionsLabels, 'text-color', [
    'case',
    ['boolean', ['get', 'isCapital'], false],
    palette.regionCapitalLabel,
    palette.regionLabel,
  ])
  setPaint(map, LAYER_IDS.regionsLabels, 'text-halo-color', palette.labelHalo)
  setPaint(map, LAYER_IDS.countryLabels, 'text-color', palette.countryLabel)
  setPaint(map, LAYER_IDS.countryLabels, 'text-halo-color', palette.labelHalo)
  setPaint(map, LAYER_IDS.capitalsPoint, 'circle-color', palette.capitalPoint)
  setPaint(map, LAYER_IDS.capitalsPoint, 'circle-stroke-color', palette.capitalStroke)
  setPaint(map, LAYER_IDS.capitalsLabel, 'text-color', palette.capitalLabel)
  setPaint(map, LAYER_IDS.capitalsLabel, 'text-halo-color', palette.labelHalo)
  setPaint(map, LAYER_IDS.debugRegionNumbers, 'text-color', palette.regionLabel)
  setPaint(map, LAYER_IDS.debugRegionNumbers, 'text-halo-color', palette.labelHalo)
  applyRasterPalette(map, LAYER_IDS.originalReference, palette)
  applyRasterPalette(map, LAYER_IDS.terrain, palette)
  applyCityPalette(map, palette)
}
