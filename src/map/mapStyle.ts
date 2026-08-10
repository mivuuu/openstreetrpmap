import type { StyleSpecification } from 'maplibre-gl'
import { MAP_THEME } from './mapTheme'

export const BASE_MAP_STYLE: StyleSpecification = {
  version: 8,
  name: 'Fictional world base map',
  sources: {},
  layers: [
    {
      id: 'ocean-background',
      type: 'background',
      paint: { 'background-color': MAP_THEME.colors.ocean },
    },
  ],
}
