import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function loadWorldFeatureCollection(
  url: string,
  signal: AbortSignal,
): Promise<FeatureCollection<Geometry, GeoJsonProperties>> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Не удалось загрузить ${url}: HTTP ${response.status}`)

  const value: unknown = await response.json()
  if (!isRecord(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new Error(`Некорректный GeoJSON: ${url}`)
  }
  return value as unknown as FeatureCollection<Geometry, GeoJsonProperties>
}
