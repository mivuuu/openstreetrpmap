import type { StyleSpecification } from 'maplibre-gl'
import { MAP_COLOR_PALETTES, type MapColorScheme } from './mapColorScheme'

export function createBaseMapStyle(scheme: MapColorScheme): StyleSpecification {
  return {
    version: 8,
    name: `Fictional world ${scheme} map`,
    sources: {},
    layers: [
      {
        id: 'ocean-background',
        type: 'background',
        paint: { 'background-color': MAP_COLOR_PALETTES[scheme].ocean },
      },
    ],
  }
}
