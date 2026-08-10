import type { Map } from 'maplibre-gl'
import { MAP_ASSETS } from '../map/mapAssets'
import { IMAGE_CORNERS } from '../map/worldCoordinates'
import { LAYER_IDS } from './layerIds'

export const COUNTRY_MASK_SOURCE_ID = 'countries-mask-reference'

export function addCountryMaskReferenceLayer(map: Map) {
  map.addSource(COUNTRY_MASK_SOURCE_ID, {
    type: 'image',
    url: MAP_ASSETS.countriesMaskReference,
    coordinates: IMAGE_CORNERS,
  })
  map.addLayer({
    id: LAYER_IDS.countryMaskReference,
    type: 'raster',
    source: COUNTRY_MASK_SOURCE_ID,
    paint: {
      'raster-opacity': 0,
      'raster-fade-duration': 0,
      'raster-resampling': 'nearest',
    },
  })
}
