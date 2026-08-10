export type GeometryDebugVisibility = {
  countryFills: boolean
  countryBorders: boolean
  borderCasing: boolean
  coastline: boolean
  vertices: boolean
  rawGeometry: boolean
  cleanGeometry: boolean
  unassignedLand: boolean
  originalCountries: boolean
  regionFills: boolean
  regionBorders: boolean
  regionLabels: boolean
  regionDebug: boolean
  regionNumbers: boolean
}

export const DEFAULT_GEOMETRY_DEBUG: GeometryDebugVisibility = Object.freeze({
  countryFills: true,
  countryBorders: true,
  borderCasing: true,
  coastline: true,
  vertices: false,
  rawGeometry: false,
  cleanGeometry: false,
  unassignedLand: false,
  originalCountries: false,
  regionFills: true,
  regionBorders: true,
  regionLabels: true,
  regionDebug: false,
  regionNumbers: false,
})

export const GEOMETRY_DEBUG_LABELS: Readonly<Record<keyof GeometryDebugVisibility, string>> = {
  countryFills: 'Заливка стран',
  countryBorders: 'Границы стран',
  borderCasing: 'Обводка границ',
  coastline: 'Береговая линия',
  vertices: 'Вершины',
  rawGeometry: 'Исходная геометрия',
  cleanGeometry: 'Очищенная геометрия',
  unassignedLand: 'Незанятая суша',
  originalCountries: 'Исходные страны',
  regionFills: 'Заливка регионов',
  regionBorders: 'Границы регионов',
  regionLabels: 'Названия регионов',
  regionDebug: 'Выравнивание регионов',
  regionNumbers: 'Номера регионов',
}
