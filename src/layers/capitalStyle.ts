import type { ExpressionSpecification } from 'maplibre-gl'
import { MAP_THEME } from '../map/mapTheme'
import { ZOOM_LEVELS } from '../map/zoomLevels'

export const CAPITAL_FILTER: ExpressionSpecification = [
  'any',
  ['==', ['get', 'isCapital'], true],
  ['==', ['get', 'capital'], true],
  ['==', ['get', 'rank'], 'capital'],
]

export const CAPITAL_POINT_RADIUS: ExpressionSpecification = [
  'case',
  ['boolean', ['feature-state', 'hover'], false], 4,
  3.2,
]

export const CAPITAL_LABEL_SIZE: ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  ZOOM_LEVELS.WORLD, 12,
  ZOOM_LEVELS.LOCAL, 14.5,
  ZOOM_LEVELS.DETAIL, 15,
]

export const CAPITAL_LABEL_FONT = ['Segoe UI Semibold', 'Arial Bold', 'sans-serif'] as const

export const CAPITAL_STYLE = Object.freeze({
  pointColor: '#263638',
  pointStrokeColor: '#fffdf6',
  pointStrokeWidth: 1.25,
  textColor: '#263638',
  textHaloColor: MAP_THEME.colors.labels.halo,
  textHaloWidth: 1.3,
})
