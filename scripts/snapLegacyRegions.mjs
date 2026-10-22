import fs from 'node:fs'
import path from 'node:path'
import * as turf from '@turf/turf'

const ROOT = process.cwd()
const countriesPath = path.join(ROOT, 'public/data/countries-display.geojson')
const regionsPath = path.join(ROOT, 'public/data/regions.geojson')
const regionBordersPath = path.join(ROOT, 'public/data/region-borders.geojson')
const regionLabelsPath = path.join(ROOT, 'public/data/region-label-points.geojson')

const countries = JSON.parse(fs.readFileSync(countriesPath, 'utf8'))
const regions = JSON.parse(fs.readFileSync(regionsPath, 'utf8'))
let existingRegionLabels
try {
  existingRegionLabels = JSON.parse(fs.readFileSync(regionLabelsPath, 'utf8'))
} catch {
  existingRegionLabels = { type: 'FeatureCollection', features: [] }
}

function getAllPoints(geom) {
  const pts = []
  turf.coordEach(geom, (c) => pts.push(c))
  return pts
}

function dist2(p1, p2) {
  const dx = p1[0] - p2[0]
  const dy = p1[1] - p2[1]
  return dx * dx + dy * dy
}

function safeUnion(featA, featB) {
  try {
    const u = turf.union(turf.featureCollection([featA, featB]))
    if (u) return u
  } catch {
    // Disjoint union fallback
  }
  const coordsA = featA.geometry.type === 'Polygon' ? [featA.geometry.coordinates] : featA.geometry.coordinates
  const coordsB = featB.geometry.type === 'Polygon' ? [featB.geometry.coordinates] : featB.geometry.coordinates
  return turf.multiPolygon([...coordsA, ...coordsB])
}

function snapCountryRegions(countryId, isFullCountry = false) {
  console.log(`\n=== Processing ${countryId} ===`)
  const countryFeature = countries.features.find((f) => f.properties?.id === countryId)
  if (!countryFeature) {
    console.error(`Country ${countryId} not found!`)
    return []
  }

  const countryRegions = regions.features.filter((f) => f.properties?.countryId === countryId)
  if (countryRegions.length === 0) return []

  const cParts = turf.flatten(countryFeature).features

  let targetTerritory
  if (isFullCountry) {
    targetTerritory = countryFeature
  } else {
    // Only components intersecting with the regions
    const matching = cParts.filter((cp) => {
      for (const r of countryRegions) {
        try {
          const inter = turf.intersect(turf.featureCollection([r, cp]))
          if (inter && turf.area(inter) > 0.001) return true
        } catch {}
      }
      return false
    })
    console.log(`${countryId}: matching territory components = ${matching.length}`)
    let u = matching[0]
    for (let i = 1; i < matching.length; i++) {
      u = safeUnion(u, matching[i])
    }
    targetTerritory = u
  }

  // 1. Clip each region to targetTerritory
  let clipped = countryRegions.map((r) => {
    try {
      const inter = turf.intersect(turf.featureCollection([r, targetTerritory]))
      if (inter) return { ...r, geometry: inter.geometry }
    } catch {}
    return r
  })

  // 2. Union of clipped
  let unionRegs = clipped[0]
  for (let i = 1; i < clipped.length; i++) {
    unionRegs = safeUnion(unionRegs, clipped[i])
  }

  // 3. Difference (gaps)
  const gap = turf.difference(turf.featureCollection([targetTerritory, unionRegs]))
  if (!gap) {
    console.log(`${countryId}: No gaps between regions and country boundary!`)
    return clipped
  }

  const gapParts = turf.flatten(gap).features
  console.log(`${countryId}: Found ${gapParts.length} gap parts to absorb into adjacent regions`)

  let regPts = clipped.map((r) => getAllPoints(r.geometry))

  gapParts.forEach((gp) => {
    // Skip infinitesimal floating point noise
    if (turf.area(gp) < 0.0001) return

    const pts = getAllPoints(gp.geometry)
    let bestR = 0
    let minDist = Infinity
    for (const pt of pts) {
      for (let rIdx = 0; rIdx < clipped.length; rIdx++) {
        for (const rpt of regPts[rIdx]) {
          const d = dist2(pt, rpt)
          if (d < minDist) {
            minDist = d
            bestR = rIdx
          }
        }
      }
    }

    const u = safeUnion(clipped[bestR], gp)
    clipped[bestR] = { ...clipped[bestR], geometry: u.geometry }
    regPts[bestR] = getAllPoints(u.geometry)
  })

  console.log(`${countryId}: All gaps absorbed successfully.`)
  return clipped
}

console.log('Snapping legacy regions for Yarlandia, Negetsiya, and Lumenaria...')

const ySnapped = snapCountryRegions('country-006', true) // Yarlandia (all components)
const nSnapped = snapCountryRegions('country-008', false) // Negetsiya (mainland-southwest components)
const lSnapped = snapCountryRegions('country-019', false) // Lumenaria (main components)

// Retain regions for other countries (e.g. Hisolia country-007)
const otherRegions = regions.features.filter(
  (r) => !['country-006', 'country-008', 'country-019'].includes(r.properties?.countryId),
)

const allSnappedRegions = [...ySnapped, ...nSnapped, ...lSnapped, ...otherRegions]

// Recalculate areaWorld and properties
allSnappedRegions.forEach((reg) => {
  const parts = turf.flatten(reg).features
  parts.sort((a, b) => turf.area(b) - turf.area(a))
  const largest = parts[0]
  if (reg.properties) {
    reg.properties.areaWorld = Math.round(turf.area(largest))
  }
})

// Build updated regions FeatureCollection
const updatedRegionsFC = {
  type: 'FeatureCollection',
  features: allSnappedRegions,
}

// Recalculate borders
console.log('Recalculating region borders...')
const regionBorderLines = []
allSnappedRegions.forEach((feature, index) => {
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
  } catch {}
})

const updatedRegionBordersFC = {
  type: 'FeatureCollection',
  features: regionBorderLines,
}

// Recalculate label points
console.log('Recalculating region label points...')
const regionLabels = []
allSnappedRegions.forEach((feature) => {
  if (!feature.geometry || turf.area(feature) <= 0.001) return
  const parts = turf.flatten(feature).features
  if (!parts.length) return
  parts.sort((a, b) => turf.area(b) - turf.area(a))
  const largest = parts[0]

  const existing = existingRegionLabels.features.find((l) => l.properties?.id === feature.properties?.id)
  let ptGeom
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

const updatedRegionLabelsFC = {
  type: 'FeatureCollection',
  features: regionLabels,
}

// Write files
console.log('Writing updated GeoJSON datasets to public/data/ ...')
fs.writeFileSync(regionsPath, JSON.stringify(updatedRegionsFC, null, 2))
fs.writeFileSync(regionBordersPath, JSON.stringify(updatedRegionBordersFC, null, 2))
fs.writeFileSync(regionLabelsPath, JSON.stringify(updatedRegionLabelsFC, null, 2))

console.log('Done! All regions, borders, and labels snapped and updated cleanly.')
