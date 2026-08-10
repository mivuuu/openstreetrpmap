import type { Map } from 'maplibre-gl'
import { loadWorldFeatureCollection } from '../utils/loadWorldGeoJson'
import { addCountryMaskReferenceLayer } from './countryMaskReferenceLayer'
import {
  addCountriesBorderLayers,
  addCountriesDebugLayers,
  addCountriesFillLayer,
} from './countriesLayer'
import {
  addCoastlineLayer,
  addLandDebugLayer,
  addLandLayer,
  addUnclaimedLandLayer,
  addUnassignedLandDebugLayer,
} from './landLayer'
import { addOriginalReferenceLayer } from './originalReferenceLayer'
import { addTerrainLayer } from './terrainLayer'
import {
  addRegionAreaLayers,
  addRegionDebugLayers,
  addRegionLabelLayer,
} from './regionsLayer'

type BaseMapLayerOptions = { debugGeometry?: boolean }

export async function addBaseMapLayers(
  map: Map,
  signal: AbortSignal,
  options: BaseMapLayerOptions = {},
) {
  const [
    land,
    countries,
    borders,
    coastline,
    rawCountries,
    vertices,
    unassignedLand,
    originalCountries,
    originalBorders,
    unclaimed,
    regions,
    regionBorders,
    regionLabels,
    rawRegions,
  ] = await Promise.all([
    loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/land.geojson`, signal),
    loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/countries-display.geojson`, signal),
    loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/country-borders-display.geojson`, signal),
    loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/coastline.geojson`, signal),
    options.debugGeometry
      ? loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/countries-raw.geojson`, signal)
      : Promise.resolve(undefined),
    options.debugGeometry
      ? loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/country-vertices.geojson`, signal)
      : Promise.resolve(undefined),
    options.debugGeometry
      ? loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/unassigned-land.geojson`, signal)
      : Promise.resolve(undefined),
    options.debugGeometry
      ? loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/countries-original-display.geojson`, signal)
      : Promise.resolve(undefined),
    options.debugGeometry
      ? loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/country-borders-original-display.geojson`, signal)
      : Promise.resolve(undefined),
    loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/unclaimed.geojson`, signal),
    loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/regions.geojson`, signal),
    loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/region-borders.geojson`, signal),
    loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/region-label-points.geojson`, signal),
    options.debugGeometry
      ? loadWorldFeatureCollection(`${import.meta.env.BASE_URL}data/regions-raw-world.geojson`, signal)
      : Promise.resolve(undefined),
  ])
  if (signal.aborted) return

  // Production order: ocean → land → raster → political fills → linework.
  addLandLayer(map, land)
  addOriginalReferenceLayer(map)
  addTerrainLayer(map)
  addUnclaimedLandLayer(map, unclaimed)
  addCountriesFillLayer(map, countries)
  addRegionAreaLayers(map, regions, regionBorders)
  addCountriesBorderLayers(map, borders)
  addCoastlineLayer(map, coastline)
  addRegionLabelLayer(map, regionLabels)
  addCountryMaskReferenceLayer(map)
  addLandDebugLayer(map)
  addUnassignedLandDebugLayer(map, unassignedLand)
  addCountriesDebugLayers(map, rawCountries, vertices, originalCountries, originalBorders)
  addRegionDebugLayers(map, rawRegions)
}
