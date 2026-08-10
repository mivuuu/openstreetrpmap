import type {
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  GeometryCollection,
  Position,
} from 'geojson'
import { worldToMap } from './worldCoordinates'

function worldPositionToMap(position: Position): Position {
  const [longitude, latitude] = worldToMap({ x: position[0], y: position[1] })
  return [longitude, latitude, ...position.slice(2)]
}

/** Converts GeoJSON coordinates through the one canonical world adapter. */
export function worldGeometryToMap(geometry: Geometry): Geometry {
  switch (geometry.type) {
    case 'Point':
      return { ...geometry, coordinates: worldPositionToMap(geometry.coordinates) }
    case 'MultiPoint':
    case 'LineString':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map(worldPositionToMap),
      }
    case 'MultiLineString':
    case 'Polygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((line) => line.map(worldPositionToMap)),
      }
    case 'MultiPolygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map((ring) => ring.map(worldPositionToMap)),
        ),
      }
    case 'GeometryCollection':
      return {
        ...geometry,
        geometries: geometry.geometries.map(worldGeometryToMap),
      } satisfies GeometryCollection
  }
}

export function worldFeatureCollectionToMap<Properties extends GeoJsonProperties>(
  collection: FeatureCollection<Geometry, Properties>,
): FeatureCollection<Geometry, Properties> {
  return {
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      id: feature.id ?? feature.properties?.id,
      geometry: worldGeometryToMap(feature.geometry),
    })),
  }
}
