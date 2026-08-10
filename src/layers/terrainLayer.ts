import type { Map } from 'maplibre-gl'
import { MAP_ASSETS } from '../map/mapAssets'
import { IMAGE_CORNERS } from '../map/worldCoordinates'
import { LAYER_IDS } from './layerIds'

export const TERRAIN_SOURCE_ID = 'world-terrain-prototype'

export function addTerrainLayer(map: Map) {
  map.addSource(TERRAIN_SOURCE_ID, {
    type: 'image',
    url: MAP_ASSETS.terrainPrototype,
    coordinates: IMAGE_CORNERS,
  })
  map.addLayer({
    id: LAYER_IDS.terrain,
    type: 'raster',
    source: TERRAIN_SOURCE_ID,
    paint: {
      'raster-opacity': 0,
      'raster-fade-duration': 0,
      'raster-resampling': 'linear',
    },
  })
}
