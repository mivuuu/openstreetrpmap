import type { ExpressionSpecification } from 'maplibre-gl'
import type { CityRank } from '../types/mapFeatures'
import { ZOOM_LEVELS } from './zoomLevels'

export const MAP_THEME = Object.freeze({
  colors: {
    ocean: '#a9c7ce',
    land: '#f1ede3',
    unclaimedLand: '#d8d0c3',
    unclaimedBorder: '#8a8882',
    countryPalette: [
      '#d8c8ad',
      '#c4d5bc',
      '#b9d1d3',
      '#dbc0bc',
      '#cbc5d8',
      '#d7d2a9',
      '#dfc7b4',
      '#bad2c8',
    ],
    countryBorder: '#67655f',
    countryBorderCasing: '#77736c',
    coastline: '#6c8589',
    regionBorder: '#68665f',
    regionLabel: '#343632',
    regionCapitalLabel: '#4b3933',
    river: '#6aa6bc',
    roads: {
      motorway: '#cf937c',
      primary: '#d8ad82',
      secondary: '#dfc89f',
      local: '#d8d3ca',
      casing: '#fffaf0',
    },
    citySymbol: {
      capital: '#a6554e',
      major: '#405c61',
      city: '#526a6e',
      town: '#667b7e',
      village: '#77898b',
      hover: '#c65e55',
      stroke: '#fffaf0',
    },
    labels: {
      primary: '#28383a',
      secondary: '#48595b',
      water: '#3e7f98',
      road: '#5f554c',
      poi: '#5c5148',
      halo: 'rgba(250, 247, 238, 0.9)',
    },
    debug: {
      coastline: '#25edff',
      fill: '#ffffff',
      border: '#e9ffff',
    },
  },
  typography: {
    fonts: ['Segoe UI', 'Arial', 'sans-serif'],
    sizes: {
      country: 18,
      region: 14,
      capital: 13.5,
      major: 12.5,
      city: 12,
      town: 11.5,
      village: 11,
      river: 11,
      road: 10.5,
      poi: 10.5,
    },
    haloWidth: 1.1,
    haloBlur: 0.35,
  },
  raster: {
    originalComparisonOpacity: 0.58,
    maskComparisonOpacity: 0.78,
  },
  symbols: {
    strokeWidth: 1.2,
    capitalStrokeWidth: 1.6,
    hoverRadiusDelta: 1.4,
  },
})

export const MAP_EXPRESSIONS: Readonly<Record<string, ExpressionSpecification>> = {
  terrainOpacity: [
    'interpolate', ['linear'], ['zoom'],
    ZOOM_LEVELS.WORLD, 0,
    ZOOM_LEVELS.COUNTRY, 0,
    ZOOM_LEVELS.REGION, 0.07,
    ZOOM_LEVELS.CITY, 0.2,
    ZOOM_LEVELS.LOCAL, 0.42,
    ZOOM_LEVELS.STREET, 0.66,
    ZOOM_LEVELS.DETAIL, 0.82,
    ZOOM_LEVELS.MAX, 0.9,
  ],
  countryFillVectorOpacity: [
    'interpolate', ['linear'], ['zoom'],
    ZOOM_LEVELS.WORLD, 0.92,
    ZOOM_LEVELS.CITY, 0.86,
    ZOOM_LEVELS.STREET, 0.8,
    ZOOM_LEVELS.MAX, 0.76,
  ],
  countryFillTerrainOpacity: [
    'interpolate', ['linear'], ['zoom'],
    ZOOM_LEVELS.WORLD, 0.94,
    ZOOM_LEVELS.COUNTRY, 0.9,
    ZOOM_LEVELS.REGION, 0.8,
    ZOOM_LEVELS.CITY, 0.62,
    ZOOM_LEVELS.LOCAL, 0.44,
    ZOOM_LEVELS.STREET, 0.28,
    ZOOM_LEVELS.DETAIL, 0.18,
    ZOOM_LEVELS.MAX, 0.12,
  ],
  countryFillReferenceOpacity: [
    'interpolate', ['linear'], ['zoom'],
    ZOOM_LEVELS.WORLD, 0.5,
    ZOOM_LEVELS.REGION, 0.4,
    ZOOM_LEVELS.LOCAL, 0.28,
    ZOOM_LEVELS.MAX, 0.18,
  ],
  countryBorderWidth: [
    'interpolate', ['linear'], ['zoom'],
    ZOOM_LEVELS.WORLD, 1.2,
    ZOOM_LEVELS.COUNTRY, 1.05,
    ZOOM_LEVELS.CITY, 0.9,
    ZOOM_LEVELS.STREET, 0.75,
    ZOOM_LEVELS.DETAIL, 0.8,
    ZOOM_LEVELS.MAX, 0.9,
  ],
  countryBorderCasingWidth: [
    'interpolate', ['linear'], ['zoom'],
    ZOOM_LEVELS.WORLD, 2.2,
    ZOOM_LEVELS.COUNTRY, 1.85,
    ZOOM_LEVELS.CITY, 1.55,
    ZOOM_LEVELS.STREET, 1.35,
    ZOOM_LEVELS.DETAIL, 1.45,
    ZOOM_LEVELS.MAX, 1.55,
  ],
  coastlineWidth: [
    'interpolate', ['linear'], ['zoom'],
    ZOOM_LEVELS.WORLD, 1,
    ZOOM_LEVELS.COUNTRY, 0.85,
    ZOOM_LEVELS.CITY, 0.7,
    ZOOM_LEVELS.STREET, 0.65,
    ZOOM_LEVELS.DETAIL, 0.7,
    ZOOM_LEVELS.MAX, 0.78,
  ],
}

export function countryPaletteExpression(): ExpressionSpecification {
  const expression: unknown[] = ['match', ['get', 'themeColorIndex']]
  MAP_THEME.colors.countryPalette.forEach((color, index) => expression.push(index, color))
  expression.push(MAP_THEME.colors.countryPalette[0])
  return expression as ExpressionSpecification
}

const CITY_RADIUS: Readonly<Record<CityRank, number>> = {
  capital: 4.2,
  major: 3.6,
  city: 3.1,
  town: 2.7,
  village: 2.3,
}

export function cityRadiusExpression(rank: CityRank): ExpressionSpecification {
  const radius = CITY_RADIUS[rank]
  const radiusAt = (value: number): ExpressionSpecification => [
    'case',
    ['boolean', ['feature-state', 'hover'], false],
    value + MAP_THEME.symbols.hoverRadiusDelta,
    value,
  ]

  return [
    'interpolate', ['linear'], ['zoom'],
    ZOOM_LEVELS.WORLD, radiusAt(radius),
    ZOOM_LEVELS.LOCAL, radiusAt(radius + 0.8),
    ZOOM_LEVELS.DETAIL, radiusAt(radius + 1.2),
  ]
}

export function cityLabelSizeExpression(rank: CityRank): ExpressionSpecification {
  const size = MAP_THEME.typography.sizes[rank]
  return [
    'interpolate', ['linear'], ['zoom'],
    ZOOM_LEVELS.WORLD, size - 1,
    ZOOM_LEVELS.CITY, size,
    ZOOM_LEVELS.STREET, size + 1,
    ZOOM_LEVELS.DETAIL, size + 1.5,
  ]
}
