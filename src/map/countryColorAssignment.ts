import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'
import { MAP_THEME } from './mapTheme'

// Deterministic greedy coloring of the current country adjacency graph.
// Eight palette slots cover all 40 neighboring pairs with zero color conflicts.
const COUNTRY_COLOR_INDEX: Readonly<Record<string, number>> = {
  'country-001': 0,
  'country-002': 5,
  'country-003': 2,
  'country-004': 7,
  'country-005': 4,
  'country-006': 1,
  'country-007': 6,
  'country-008': 3,
  'country-009': 0,
  'country-010': 5,
  'country-011': 2,
  'country-012': 7,
  'country-013': 5,
  'country-014': 1,
  'country-015': 6,
  'country-016': 4,
  'country-017': 0,
  'country-018': 5,
  'country-019': 2,
  'country-020': 7,
  'country-021': 4,
  'country-022': 1,
  'country-023': 6,
}

function fallbackColorIndex(id: string) {
  let hash = 0
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash % MAP_THEME.colors.countryPalette.length
}

export function assignCountryThemeColors(
  countries: FeatureCollection<Geometry, GeoJsonProperties>,
): FeatureCollection<Geometry, GeoJsonProperties> {
  return {
    ...countries,
    features: countries.features.map((feature) => {
      const id = typeof feature.properties?.id === 'string' ? feature.properties.id : ''
      return {
        ...feature,
        properties: {
          ...feature.properties,
          themeColorIndex: COUNTRY_COLOR_INDEX[id] ?? fallbackColorIndex(id),
        },
      }
    }),
  }
}
