import type { FeatureCollection, MultiPolygon, Polygon, LineString, MultiLineString, Point } from 'geojson'

export type StudioTool =
  | 'select'
  | 'slice-region'
  | 'redraw-border'
  | 'bucket-fill'
  | 'move-label'
  | 'erase-region'
  | 'create-country'
  | 'create-region'

export type StudioMode = 'countries' | 'regions'

export type GeoJsonDataState = {
  countries: FeatureCollection<Polygon | MultiPolygon>
  countryBorders: FeatureCollection<LineString | MultiLineString>
  regions: FeatureCollection<Polygon | MultiPolygon>
  regionBorders: FeatureCollection<LineString | MultiLineString>
  countryLabels: FeatureCollection<Point>
  regionLabels: FeatureCollection<Point>
  land: FeatureCollection<Polygon | MultiPolygon>
  countryNames: Record<string, { name: string }>
}

export type SelectedElement =
  | { type: 'country'; id: string }
  | { type: 'region'; id: string; countryId: string }
  | null

export type StudioToast = {
  id: string
  type: 'info' | 'success' | 'error' | 'warning'
  message: string
}

export type StudioMapOverlay = {
  imageUrl: string
  bounds: [number, number, number, number] // [minX, minY, maxX, maxY]
  opacity: number
  locked: boolean
}
