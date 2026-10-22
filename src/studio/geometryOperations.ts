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

function getBoxParam(x: number, y: number, bx0: number, by0: number, bx1: number, by1: number): number {
  const eps = 1e-4
  if (Math.abs(y - by1) < eps) return (x - bx0) / (bx1 - bx0) // Top edge: 0..1
  if (Math.abs(x - bx1) < eps) return 1 + (by1 - y) / (by1 - by0) // Right edge: 1..2
  if (Math.abs(y - by0) < eps) return 2 + (bx1 - x) / (bx1 - bx0) // Bottom edge: 2..3
  if (Math.abs(x - bx0) < eps) return 3 + (y - by0) / (by1 - by0) // Left edge: 3..4
  return 0
}

function getPointFromParam(t: number, bx0: number, by0: number, bx1: number, by1: number): [number, number] {
  const norm = ((t % 4) + 4) % 4
  if (norm < 1) return [bx0 + norm * (bx1 - bx0), by1]
  if (norm < 2) return [bx1, by1 - (norm - 1) * (by1 - by0)]
  if (norm < 3) return [bx1 - (norm - 2) * (bx1 - bx0), by0]
  return [bx0, by0 + (norm - 3) * (by1 - by0)]
}

function rayIntersectBox(
  origX: number,
  origY: number,
  dirX: number,
  dirY: number,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number,
): [number, number] | null {
  let bestDist = Infinity
  let bestPt: [number, number] | null = null

  // Intersect with Top edge (y = by1)
  if (dirY > 0) {
    const t = (by1 - origY) / dirY
    const x = origX + dirX * t
    if (x >= bx0 - 1e-4 && x <= bx1 + 1e-4 && t < bestDist && t > 0) {
      bestDist = t
      bestPt = [Math.max(bx0, Math.min(bx1, x)), by1]
    }
  }
  // Intersect with Bottom edge (y = by0)
  if (dirY < 0) {
    const t = (by0 - origY) / dirY
    const x = origX + dirX * t
    if (x >= bx0 - 1e-4 && x <= bx1 + 1e-4 && t < bestDist && t > 0) {
      bestDist = t
      bestPt = [Math.max(bx0, Math.min(bx1, x)), by0]
    }
  }
  // Intersect with Right edge (x = bx1)
  if (dirX > 0) {
    const t = (bx1 - origX) / dirX
    const y = origY + dirY * t
    if (y >= by0 - 1e-4 && y <= by1 + 1e-4 && t < bestDist && t > 0) {
      bestDist = t
      bestPt = [bx1, Math.max(by0, Math.min(by1, y))]
    }
  }
  // Intersect with Left edge (x = bx0)
  if (dirX < 0) {
    const t = (bx0 - origX) / dirX
    const y = origY + dirY * t
    if (y >= by0 - 1e-4 && y <= by1 + 1e-4 && t < bestDist && t > 0) {
      bestDist = t
      bestPt = [bx0, Math.max(by0, Math.min(by1, y))]
    }
  }

  return bestPt
}

/**
 * Pixelates a continuous hand-drawn line into an 8-connected raster staircase (orthogonal + 45° diagonal steps),
 * matching the authentic raster-contour style of the native country and region boundaries.
 * Collinear consecutive steps are simplified to retain only corner vertices.
 */
export function pixelateLine(points: [number, number][], gridStep: number = 1.0): [number, number][] {
  if (points.length < 2) return points

  // Snap all points to grid
  const snapped = points.map(
    ([x, y]) => [Math.round(x / gridStep) * gridStep, Math.round(y / gridStep) * gridStep] as [number, number],
  )

  const rasterPoints: [number, number][] = []

  for (let i = 0; i < snapped.length - 1; i++) {
    const [x0, y0] = snapped[i]
    const [x1, y1] = snapped[i + 1]

    let ix0 = Math.round(x0 / gridStep)
    let iy0 = Math.round(y0 / gridStep)
    const ix1 = Math.round(x1 / gridStep)
    const iy1 = Math.round(y1 / gridStep)

    const dx = Math.abs(ix1 - ix0)
    const dy = Math.abs(iy1 - iy0)
    const sx = ix0 < ix1 ? 1 : -1
    const sy = iy0 < iy1 ? 1 : -1
    let err = dx - dy

    if (rasterPoints.length === 0) {
      rasterPoints.push([ix0 * gridStep, iy0 * gridStep])
    }

    while (ix0 !== ix1 || iy0 !== iy1) {
      const e2 = 2 * err
      if (e2 > -dy) {
        err -= dy
        ix0 += sx
      }
      if (e2 < dx) {
        err += dx
        iy0 += sy
      }
      rasterPoints.push([ix0 * gridStep, iy0 * gridStep])
    }
  }

  // Deduplicate consecutive identical points
  const deduped: [number, number][] = []
  for (let i = 0; i < rasterPoints.length; i++) {
    const pt = rasterPoints[i]
    if (i === 0 || pt[0] !== deduped[deduped.length - 1][0] || pt[1] !== deduped[deduped.length - 1][1]) {
      deduped.push(pt)
    }
  }

  if (deduped.length <= 2) return deduped

  // Collinear simplification: merge consecutive segments with the same direction vector
  const simplified: [number, number][] = [deduped[0]]
  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = simplified[simplified.length - 1]
    const curr = deduped[i]
    const next = deduped[i + 1]

    const dx1 = curr[0] - prev[0]
    const dy1 = curr[1] - prev[1]
    const dx2 = next[0] - curr[0]
    const dy2 = next[1] - curr[1]

    const cross = dx1 * dy2 - dy1 * dx2
    const dot = dx1 * dx2 + dy1 * dy2
    if (cross === 0 && dot > 0) {
      continue
    }
    simplified.push(curr)
  }
  simplified.push(deduped[deduped.length - 1])

  return simplified
}

/**
 * Splits a Polygon or MultiPolygon using a user-drawn cutting line or closed lasso.
 * Employs a non-self-intersecting perimeter-walking bounding box projection.
 */
export function splitPolygonGeometry(
  geometry: Polygon | MultiPolygon,
  linePoints: [number, number][],
): SplitResult | null {
  if (linePoints.length < 2) return null

  const targetFeature = turf.feature(geometry)
  const [minX, minY, maxX, maxY] = turf.bbox(targetFeature)
  const pad = Math.max(maxX - minX, maxY - minY, 50) * 1.5
  const bx0 = minX - pad
  const by0 = minY - pad
  const bx1 = maxX + pad
  const by1 = maxY + pad

  const first = linePoints[0]
  const last = linePoints[linePoints.length - 1]
  const loopDist = Math.hypot(first[0] - last[0], first[1] - last[1])

  // Check if closed lasso loop
  if (loopDist < 35 && linePoints.length >= 3) {
    try {
      const loop = turf.polygon([[...linePoints, first]])
      const p1 = turf.difference(turf.featureCollection([targetFeature, loop]))
      const p2 = turf.intersect(turf.featureCollection([targetFeature, loop]))

      if (p1 && p2 && turf.area(p1) > 0.01 && turf.area(p2) > 0.01) {
        return {
          part1: p1.geometry as Polygon | MultiPolygon,
          part2: p2.geometry as Polygon | MultiPolygon,
        }
      }
    } catch {
      // Fall through to open line
    }
  }

  // Open cutting line: project rays outward to outer bounding box
  const kStart = Math.min(4, linePoints.length - 1)
  const dirStartX = linePoints[0][0] - linePoints[kStart][0]
  const dirStartY = linePoints[0][1] - linePoints[kStart][1]
  const lenStart = Math.hypot(dirStartX, dirStartY) || 1
  const startPtOnBox =
    rayIntersectBox(
      linePoints[0][0],
      linePoints[0][1],
      dirStartX / lenStart,
      dirStartY / lenStart,
      bx0,
      by0,
      bx1,
      by1,
    ) || [bx0, by1]

  const n = linePoints.length - 1
  const kEnd = Math.max(0, n - 4)
  const dirEndX = linePoints[n][0] - linePoints[kEnd][0]
  const dirEndY = linePoints[n][1] - linePoints[kEnd][1]
  const lenEnd = Math.hypot(dirEndX, dirEndY) || 1
  const endPtOnBox =
    rayIntersectBox(
      linePoints[n][0],
      linePoints[n][1],
      dirEndX / lenEnd,
      dirEndY / lenEnd,
      bx0,
      by0,
      bx1,
      by1,
    ) || [bx1, by0]

  const tStart = getBoxParam(startPtOnBox[0], startPtOnBox[1], bx0, by0, bx1, by1)
  const tEnd = getBoxParam(endPtOnBox[0], endPtOnBox[1], bx0, by0, bx1, by1)

  // Walk perimeter clockwise from tEnd to tStart
  const corners: [number, number][] = []
  let curr = Math.floor(tEnd) + 1
  let target = tStart
  if (target <= tEnd) {
    target += 4
  }
  while (curr < target) {
    corners.push(getPointFromParam(curr, bx0, by0, bx1, by1))
    curr++
  }

  const ring: [number, number][] = [startPtOnBox, ...linePoints, endPtOnBox, ...corners, startPtOnBox]

  try {
    const halfPlane = turf.polygon([ring])
    const p1 = turf.intersect(turf.featureCollection([targetFeature, halfPlane]))
    const p2 = turf.difference(turf.featureCollection([targetFeature, halfPlane]))

    if (p1 && p2 && turf.area(p1) > 0.01 && turf.area(p2) > 0.01) {
      return {
        part1: p1.geometry as Polygon | MultiPolygon,
        part2: p2.geometry as Polygon | MultiPolygon,
      }
    }
  } catch (err) {
    console.warn('splitPolygonGeometry error:', err)
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

function safeUnionPolygons(
  featA: Feature<Polygon | MultiPolygon>,
  featB: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> {
  try {
    const u = turf.union(turf.featureCollection([featA, featB]))
    if (u) return u as Feature<Polygon | MultiPolygon>
  } catch {
    // Fallback for disjoint components: combine into MultiPolygon
  }
  const coordsA =
    featA.geometry.type === 'Polygon' ? [featA.geometry.coordinates] : featA.geometry.coordinates
  const coordsB =
    featB.geometry.type === 'Polygon' ? [featB.geometry.coordinates] : featB.geometry.coordinates
  return turf.multiPolygon([...coordsA, ...coordsB]) as Feature<Polygon | MultiPolygon>
}

  if (targetType === 'country') {
    const targetCountry = countriesFC.features.find((f) => f.properties?.id === targetId)
    if (!targetCountry) return null

    const newTarget = safeUnionPolygons(targetCountry, islandPolygon)

    const updatedCountries = countriesFC.features.map((feature) => {
      if (feature.properties?.id === targetId) {
        return { ...feature, geometry: newTarget.geometry as Polygon | MultiPolygon }
      }
      const inter = turf.intersect(turf.featureCollection([feature, islandPolygon!]))
      if (inter && turf.area(inter) > 0.001) {
        const diff = turf.difference(turf.featureCollection([feature, islandPolygon!]))
        if (diff && turf.area(diff) > 0.001) {
          return { ...feature, geometry: diff.geometry as Polygon | MultiPolygon }
        }
      }
      return feature
    })

    // Also update regions:
    // 1. Remove/trim any foreign region that covered this island
    let updatedRegions = regionsFC.features
      .map((reg) => {
        const inter = turf.intersect(turf.featureCollection([reg, islandPolygon!]))
        if (inter && turf.area(inter) > 0.001) {
          const diff = turf.difference(turf.featureCollection([reg, islandPolygon!]))
          if (diff && turf.area(diff) > 0.001) {
            return { ...reg, geometry: diff.geometry as Polygon | MultiPolygon }
          }
          return null
        }
        return reg
      })
      .filter((r): r is Feature<Polygon | MultiPolygon> => r !== null)

    // 2. If target country has regions, attach the island to its nearest region
    const targetCountryRegions = updatedRegions.filter((r) => r.properties?.countryId === targetId)
    if (targetCountryRegions.length > 0) {
      let bestRegion = targetCountryRegions[0]
      let minDistance = Infinity
      const clickPtFeature = turf.point(clickPt)
      for (const reg of targetCountryRegions) {
        const d = turf.distance(clickPtFeature, turf.pointOnFeature(reg))
        if (d < minDistance) {
          minDistance = d
          bestRegion = reg
        }
      }
      const newRegionGeom = safeUnionPolygons(bestRegion, islandPolygon)
      updatedRegions = updatedRegions.map((reg) => {
        if (reg.properties?.id === bestRegion.properties?.id) {
          return { ...reg, geometry: newRegionGeom.geometry as Polygon | MultiPolygon }
        }
        return reg
      })
    }

    return {
      countries: { ...countriesFC, features: updatedCountries },
      regions: { ...regionsFC, features: updatedRegions },
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
      const newCountry = safeUnionPolygons(targetCountry, islandPolygon)
      updatedCountries = {
        ...countriesFC,
        features: countriesFC.features.map((f) => {
          if (f.properties?.id === countryId) {
            return { ...f, geometry: newCountry.geometry as Polygon | MultiPolygon }
          }
          const inter = turf.intersect(turf.featureCollection([f, islandPolygon!]))
          if (inter && turf.area(inter) > 0.001) {
            const diff = turf.difference(turf.featureCollection([f, islandPolygon!]))
            if (diff && turf.area(diff) > 0.001) return { ...f, geometry: diff.geometry as Polygon | MultiPolygon }
          }
          return f
        }),
      }
    }

    const newRegion = safeUnionPolygons(targetRegion, islandPolygon)

    const updatedRegions = regionsFC.features
      .map((f) => {
        if (f.properties?.id === targetId) {
          return { ...f, geometry: newRegion.geometry as Polygon | MultiPolygon }
        }
        const inter = turf.intersect(turf.featureCollection([f, islandPolygon!]))
        if (inter && turf.area(inter) > 0.001) {
          const diff = turf.difference(turf.featureCollection([f, islandPolygon!]))
          if (diff && turf.area(diff) > 0.001) return { ...f, geometry: diff.geometry as Polygon | MultiPolygon }
          return null
        }
        return f
      })
      .filter((r): r is Feature<Polygon | MultiPolygon> => r !== null)

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
