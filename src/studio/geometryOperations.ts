import * as turf from '@turf/turf'
import type {
  Feature,
  FeatureCollection,
  Geometry,
  LineString,
  MultiLineString,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from 'geojson'

export type SplitResult = {
  part1: Polygon | MultiPolygon
  part2: Polygon | MultiPolygon
}

/**
 * Splits a Polygon or MultiPolygon using a user-drawn cutting line or closed lasso.
 */
export function splitPolygonGeometry(
  geometry: Polygon | MultiPolygon,
  linePoints: [number, number][],
): SplitResult | null {
  if (linePoints.length < 2) return null

  const targetFeature = turf.feature(geometry)
  const [minX, minY, maxX, maxY] = turf.bbox(targetFeature)
  const pad = Math.max(maxX - minX, maxY - minY, 50) * 3

  const first = linePoints[0]
  const last = linePoints[linePoints.length - 1]
  const dist = Math.hypot(first[0] - last[0], first[1] - last[1])

  // Check if closed lasso loop
  if (dist < 15 && linePoints.length >= 3) {
    const loop = turf.polygon([[...linePoints, first]])
    const p1 = turf.intersect(turf.featureCollection([targetFeature, loop]))
    const p2 = turf.difference(turf.featureCollection([targetFeature, loop]))

    if (p1 && p2 && turf.area(p1) > 0.01 && turf.area(p2) > 0.01) {
      return {
        part1: p1.geometry as Polygon | MultiPolygon,
        part2: p2.geometry as Polygon | MultiPolygon,
      }
    }
  }

  // Open line: extend endpoints far beyond bounding box
  const dx0 = linePoints[0][0] - linePoints[1][0]
  const dy0 = linePoints[0][1] - linePoints[1][1]
  const len0 = Math.hypot(dx0, dy0) || 1
  const extStart: [number, number] = [
    linePoints[0][0] + (dx0 / len0) * pad,
    linePoints[0][1] + (dy0 / len0) * pad,
  ]

  const n = linePoints.length - 1
  const dxN = linePoints[n][0] - linePoints[n - 1][0]
  const dyN = linePoints[n][1] - linePoints[n - 1][1]
  const lenN = Math.hypot(dxN, dyN) || 1
  const extEnd: [number, number] = [
    linePoints[n][0] + (dxN / lenN) * pad,
    linePoints[n][1] + (dyN / lenN) * pad,
  ]

  const fullLine = [extStart, ...linePoints, extEnd]

  // Construct a wide half-plane polygon on one side of the cutting line
  const halfPlane = turf.polygon([[
    ...fullLine,
    [maxX + pad * 2, extEnd[1]],
    [maxX + pad * 2, maxY + pad * 2],
    [minX - pad * 2, maxY + pad * 2],
    [minX - pad * 2, extStart[1]],
    extStart,
  ]])

  const part1 = turf.intersect(turf.featureCollection([targetFeature, halfPlane]))
  const part2 = turf.difference(turf.featureCollection([targetFeature, halfPlane]))

  if (part1 && part2 && turf.area(part1) > 0.01 && turf.area(part2) > 0.01) {
    return {
      part1: part1.geometry as Polygon | MultiPolygon,
      part2: part2.geometry as Polygon | MultiPolygon,
    }
  }

  return null
}

/**
 * Expands a country by adding a brush polygon, clipping to land,
 * and subtracting the overlap from any neighboring countries.
 */
export function expandCountryGeometry(
  targetCountryId: string,
  brushPolygon: Polygon,
  countriesFC: FeatureCollection<Polygon | MultiPolygon>,
  landFC: FeatureCollection<Polygon | MultiPolygon>,
): FeatureCollection<Polygon | MultiPolygon> {
  // 1. Constrain brush to land
  const landFeature = landFC.features[0]
  if (!landFeature) return countriesFC

  const landBrush = turf.intersect(turf.featureCollection([landFeature, turf.feature(brushPolygon)]))
  if (!landBrush || turf.area(landBrush) <= 0.001) return countriesFC

  const targetFeature = countriesFC.features.find((f) => f.properties?.id === targetCountryId)
  if (!targetFeature) return countriesFC

  // 2. Union target country with landBrush
  const newTarget = turf.union(turf.featureCollection([targetFeature, landBrush]))
  if (!newTarget) return countriesFC

  // 3. Subtract landBrush from all other countries
  const updatedFeatures = countriesFC.features.map((feature) => {
    if (feature.properties?.id === targetCountryId) {
      return {
        ...feature,
        geometry: newTarget.geometry as Polygon | MultiPolygon,
      }
    }

    const doesIntersect = turf.intersect(turf.featureCollection([feature, landBrush]))
    if (doesIntersect && turf.area(doesIntersect) > 0.001) {
      const diff = turf.difference(turf.featureCollection([feature, landBrush]))
      if (diff && turf.area(diff) > 0.001) {
        return {
          ...feature,
          geometry: diff.geometry as Polygon | MultiPolygon,
        }
      }
    }

    return feature
  })

  return {
    ...countriesFC,
    features: updatedFeatures,
  }
}

/**
 * Expands a region inside its parent country and subtracts from adjacent regions of that country.
 */
export function expandRegionGeometry(
  targetRegionId: string,
  brushPolygon: Polygon,
  regionsFC: FeatureCollection<Polygon | MultiPolygon>,
  parentCountryFeature: Feature<Polygon | MultiPolygon>,
): FeatureCollection<Polygon | MultiPolygon> {
  // Constrain brush to parent country
  const validBrush = turf.intersect(turf.featureCollection([parentCountryFeature, turf.feature(brushPolygon)]))
  if (!validBrush || turf.area(validBrush) <= 0.001) return regionsFC

  const targetRegion = regionsFC.features.find((f) => f.properties?.id === targetRegionId)
  if (!targetRegion) return regionsFC

  const parentCountryId = targetRegion.properties?.countryId

  // Union target region with validBrush
  const newTarget = turf.union(turf.featureCollection([targetRegion, validBrush]))
  if (!newTarget) return regionsFC

  // Subtract from other regions belonging to the SAME country
  const updatedFeatures = regionsFC.features.map((feature) => {
    if (feature.properties?.id === targetRegionId) {
      return {
        ...feature,
        geometry: newTarget.geometry as Polygon | MultiPolygon,
      }
    }

    if (feature.properties?.countryId === parentCountryId) {
      const doesIntersect = turf.intersect(turf.featureCollection([feature, validBrush]))
      if (doesIntersect && turf.area(doesIntersect) > 0.001) {
        const diff = turf.difference(turf.featureCollection([feature, validBrush]))
        if (diff && turf.area(diff) > 0.001) {
          return {
            ...feature,
            geometry: diff.geometry as Polygon | MultiPolygon,
          }
        }
      }
    }

    return feature
  })

  return {
    ...regionsFC,
    features: updatedFeatures,
  }
}

/**
 * Finds the island (component polygon of land) at the clicked point
 * and claims it for the target country or region.
 */
export function claimIslandGeometry(
  clickPt: [number, number],
  targetId: string,
  targetType: 'country' | 'region',
  landFC: FeatureCollection<Polygon | MultiPolygon>,
  countriesFC: FeatureCollection<Polygon | MultiPolygon>,
  regionsFC: FeatureCollection<Polygon | MultiPolygon>,
): {
  countries: FeatureCollection<Polygon | MultiPolygon>
  regions: FeatureCollection<Polygon | MultiPolygon>
} | null {
  const landFeature = landFC.features[0]
  if (!landFeature) return null

  // Find which polygon part of land contains clickPt
  let islandPolygon: Feature<Polygon> | null = null
  const coords = landFeature.geometry.coordinates

  if (landFeature.geometry.type === 'MultiPolygon') {
    for (let i = 0; i < coords.length; i++) {
      const poly = turf.polygon(coords[i] as Position[][])
      if (turf.booleanPointInPolygon(clickPt, poly)) {
        islandPolygon = poly
        break
      }
    }
  } else {
    const poly = turf.polygon(coords as Position[][])
    if (turf.booleanPointInPolygon(clickPt, poly)) {
      islandPolygon = poly
    }
  }

  if (!islandPolygon) return null

  if (targetType === 'country') {
    const targetCountry = countriesFC.features.find((f) => f.properties?.id === targetId)
    if (!targetCountry) return null

    const newTarget = turf.union(turf.featureCollection([targetCountry, islandPolygon]))
    if (!newTarget) return null

    const updatedCountries = countriesFC.features.map((feature) => {
      if (feature.properties?.id === targetId) {
        return { ...feature, geometry: newTarget.geometry as Polygon | MultiPolygon }
      }
      const inter = turf.intersect(turf.featureCollection([feature, islandPolygon!]))
      if (inter && turf.area(inter) > 0.001) {
        const diff = turf.difference(turf.featureCollection([feature, islandPolygon!]))
        if (diff) {
          return { ...feature, geometry: diff.geometry as Polygon | MultiPolygon }
        }
      }
      return feature
    })

    return {
      countries: { ...countriesFC, features: updatedCountries },
      regions: regionsFC,
    }
  }

  if (targetType === 'region') {
    const targetRegion = regionsFC.features.find((f) => f.properties?.id === targetId)
    if (!targetRegion) return null
    const countryId = targetRegion.properties?.countryId

    // Also claim island for the parent country
    const targetCountry = countriesFC.features.find((f) => f.properties?.id === countryId)
    let updatedCountries = countriesFC
    if (targetCountry) {
      const newCountry = turf.union(turf.featureCollection([targetCountry, islandPolygon]))
      if (newCountry) {
        updatedCountries = {
          ...countriesFC,
          features: countriesFC.features.map((f) => {
            if (f.properties?.id === countryId) {
              return { ...f, geometry: newCountry.geometry as Polygon | MultiPolygon }
            }
            const inter = turf.intersect(turf.featureCollection([f, islandPolygon!]))
            if (inter && turf.area(inter) > 0.001) {
              const diff = turf.difference(turf.featureCollection([f, islandPolygon!]))
              if (diff) return { ...f, geometry: diff.geometry as Polygon | MultiPolygon }
            }
            return f
          }),
        }
      }
    }

    const newRegion = turf.union(turf.featureCollection([targetRegion, islandPolygon]))
    if (!newRegion) return null

    const updatedRegions = regionsFC.features.map((f) => {
      if (f.properties?.id === targetId) {
        return { ...f, geometry: newRegion.geometry as Polygon | MultiPolygon }
      }
      if (f.properties?.countryId === countryId) {
        const inter = turf.intersect(turf.featureCollection([f, islandPolygon!]))
        if (inter && turf.area(inter) > 0.001) {
          const diff = turf.difference(turf.featureCollection([f, islandPolygon!]))
          if (diff) return { ...f, geometry: diff.geometry as Polygon | MultiPolygon }
        }
      }
      return f
    })

    return {
      countries: updatedCountries,
      regions: { ...regionsFC, features: updatedRegions },
    }
  }

  return null
}

/**
 * Automatically recalculates international borders, internal region borders,
 * country label points, and region label points from the authoritative polygons.
 */
export function recalculateBordersAndLabels(
  countriesFC: FeatureCollection<Polygon | MultiPolygon>,
  regionsFC: FeatureCollection<Polygon | MultiPolygon>,
  existingCountryLabels?: FeatureCollection<Point>,
  existingRegionLabels?: FeatureCollection<Point>,
): {
  countryBorders: FeatureCollection<LineString | MultiLineString>
  regionBorders: FeatureCollection<LineString | MultiLineString>
  countryLabels: FeatureCollection<Point>
  regionLabels: FeatureCollection<Point>
} {
  // 1. Country label points
  const countryLabels: Feature<Point>[] = []
  countriesFC.features.forEach((feature) => {
    if (!feature.geometry || turf.area(feature) <= 0.001) return
    const parts = turf.flatten(feature).features
    if (!parts.length) return

    parts.sort((a, b) => turf.area(b) - turf.area(a))
    const largest = parts[0]

    // Check if an existing label position is already set and still inside this country
    const existing = existingCountryLabels?.features.find(
      (l) => l.properties?.countryId === feature.properties?.id,
    )
    let ptGeom: Point

    if (existing?.geometry && turf.booleanPointInPolygon(existing.geometry.coordinates, feature)) {
      ptGeom = existing.geometry
    } else {
      ptGeom = turf.pointOnFeature(largest).geometry
    }

    countryLabels.push({
      type: 'Feature',
      id: `${feature.properties?.id}-production-label`,
      geometry: ptGeom,
      properties: {
        id: `${feature.properties?.id}-production-label`,
        countryId: feature.properties?.id,
        name: feature.properties?.name || 'Безымянное государство',
        type: 'country-label',
        labelRank: feature.properties?.labelRank ?? 2,
        areaWorld: Math.round(turf.area(largest)),
      },
    })
  })

  // 2. Region label points
  const regionLabels: Feature<Point>[] = []
  regionsFC.features.forEach((feature) => {
    if (!feature.geometry || turf.area(feature) <= 0.001) return
    const parts = turf.flatten(feature).features
    if (!parts.length) return

    parts.sort((a, b) => turf.area(b) - turf.area(a))
    const largest = parts[0]

    // Check if an existing label position is already set and still inside this region
    const existing = existingRegionLabels?.features.find(
      (l) => l.properties?.id === feature.properties?.id,
    )
    let ptGeom: Point

    if (existing?.geometry && turf.booleanPointInPolygon(existing.geometry.coordinates, feature)) {
      ptGeom = existing.geometry
    } else {
      ptGeom = turf.pointOnFeature(largest).geometry
    }

    regionLabels.push({
      type: 'Feature',
      id: feature.properties?.id,
      geometry: ptGeom,
      properties: {
        id: feature.properties?.id,
        number: feature.properties?.number ?? 1,
        name: feature.properties?.name || 'Новый регион',
        type: 'region',
        countryId: feature.properties?.countryId,
        isCapital: Boolean(feature.properties?.isCapital),
        labelRank: feature.properties?.labelRank ?? 1,
        styleIndex: feature.properties?.styleIndex ?? 0,
        areaWorld: Math.round(turf.area(largest)),
      },
    })
  })

  // 3. Country borders (exterior rings converted to lines)
  const countryBorderLines: Feature<LineString | MultiLineString>[] = []
  countriesFC.features.forEach((feature, index) => {
    try {
      const line = turf.polygonToLine(feature)
      if (line) {
        if (line.type === 'FeatureCollection') {
          line.features.forEach((f, subIdx) => {
            countryBorderLines.push({
              type: 'Feature',
              id: `country-border-${index}-${subIdx}`,
              geometry: f.geometry,
              properties: { type: 'international', countryId: feature.properties?.id },
            })
          })
        } else {
          countryBorderLines.push({
            type: 'Feature',
            id: `country-border-${index}`,
            geometry: line.geometry,
            properties: { type: 'international', countryId: feature.properties?.id },
          })
        }
      }
    } catch {
      // Ignore degenerate geometry
    }
  })

  // 4. Region borders (exterior rings converted to lines)
  const regionBorderLines: Feature<LineString | MultiLineString>[] = []
  regionsFC.features.forEach((feature, index) => {
    try {
      const line = turf.polygonToLine(feature)
      if (line) {
        if (line.type === 'FeatureCollection') {
          line.features.forEach((f, subIdx) => {
            regionBorderLines.push({
              type: 'Feature',
              id: `region-border-${index}-${subIdx}`,
              geometry: f.geometry,
              properties: {
                type: 'region-border',
                countryId: feature.properties?.countryId,
                regionId: feature.properties?.id,
              },
            })
          })
        } else {
          regionBorderLines.push({
            type: 'Feature',
            id: `region-border-${index}`,
            geometry: line.geometry,
            properties: {
              type: 'region-border',
              countryId: feature.properties?.countryId,
              regionId: feature.properties?.id,
            },
          })
        }
      }
    } catch {
      // Ignore degenerate geometry
    }
  })

  return {
    countryBorders: { type: 'FeatureCollection', features: countryBorderLines },
    regionBorders: { type: 'FeatureCollection', features: regionBorderLines },
    countryLabels: { type: 'FeatureCollection', features: countryLabels },
    regionLabels: { type: 'FeatureCollection', features: regionLabels },
  }
}
