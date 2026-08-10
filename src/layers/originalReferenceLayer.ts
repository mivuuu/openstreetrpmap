import type { Map } from 'maplibre-gl'
import { MAP_ASSETS } from '../map/mapAssets'
import { IMAGE_CORNERS } from '../map/worldCoordinates'
import { LAYER_IDS } from './layerIds'

export const ORIGINAL_REFERENCE_SOURCE_ID = 'world-original-reference'

export function addOriginalReferenceLayer(map: Map) {
  map.addSource(ORIGINAL_REFERENCE_SOURCE_ID, {
    type: 'image',
    url: MAP_ASSETS.originalReference,
    coordinates: IMAGE_CORNERS,
  })
  map.addLayer({
    id: LAYER_IDS.originalReference,
    type: 'raster',
    source: ORIGINAL_REFERENCE_SOURCE_ID,
    paint: {
      'raster-opacity': 0,
      'raster-fade-duration': 0,
      'raster-resampling': 'linear',
    },
  })
}
