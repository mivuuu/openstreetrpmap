import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'
import type { WorldPoint } from './world'

export type { WorldPoint } from './world'

export const CITY_RANKS = [
  'capital',
  'major',
  'city',
  'town',
  'village',
] as const

export type CityRank = (typeof CITY_RANKS)[number]

export type CityProperties = {
  id: string
  name: string
  type: 'city'
  rank: CityRank
  population: number
  isCapital?: boolean
}

export type CityFeature = Feature<Point, CityProperties>
export type CityFeatureCollection = FeatureCollection<Point, CityProperties>

export type SelectedCity = Readonly<{
  properties: CityProperties
  worldCoordinates: WorldPoint
}>

export type SelectedMapFeature = Readonly<{
  properties: Readonly<{
    id: string
    number: number
    name: string
    type: 'region'
    featureKind: 'city'
    isCity: true
    isCapital: true
  }>
  worldCoordinates: WorldPoint
}>

export type RegionProperties = {
  id: string
  name: string
  type: 'region'
  countryId: string
  rgb: [number, number, number]
  styleIndex: number
  source: string
}

export type RegionFeature = Feature<Polygon | MultiPolygon, RegionProperties>
export type RegionFeatureCollection = FeatureCollection<Polygon | MultiPolygon, RegionProperties>
