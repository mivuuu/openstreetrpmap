import type { CityRank } from '../types/mapFeatures'

/** Semantic zoom levels shared by every map layer. */
export const ZOOM_LEVELS = Object.freeze({
  WORLD: 0,
  COUNTRY: 2.25,
  REGION: 4,
  CITY: 6.5,
  LOCAL: 9,
  STREET: 12,
  DETAIL: 15,
  MAX: 18,
})

export const CITY_MIN_ZOOM: Readonly<Record<CityRank, number>> = {
  capital: ZOOM_LEVELS.WORLD,
  major: ZOOM_LEVELS.COUNTRY,
  city: ZOOM_LEVELS.REGION,
  town: ZOOM_LEVELS.CITY,
  village: ZOOM_LEVELS.LOCAL,
}

export const REGION_MIN_ZOOM = 2.6
export const REGION_LABEL_MIN_ZOOM = 3.4
