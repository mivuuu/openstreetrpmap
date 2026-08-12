export type CityPlaceDetails = Readonly<{
  population: number
  status: string
  description: string
  founded: string
  area: string
}>

export const KLEROPOL_PLACE_DETAILS: CityPlaceDetails = Object.freeze({
  population: 7890000,
  status: 'Столица',
  description:
    'Клерополь — столица и главный административный, политический центр страны.',
  founded: '742 год',
  area: '2435 км²',
})
