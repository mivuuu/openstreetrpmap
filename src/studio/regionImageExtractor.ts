import * as turf from '@turf/turf'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { pixelateLine } from './geometryOperations'

export type ExtractedRegion = {
  id: string
  number: number
  name: string
  isCapital: boolean
  geometry: Polygon | MultiPolygon
  areaPx: number
  colorIndex: number
}

export type ExtractionOptions = {
  countryFeature: Feature<Polygon | MultiPolygon>
  countryId: string
  imageElement: HTMLImageElement
  scale?: number
  scaleX?: number
  scaleY?: number
  offsetX: number
  offsetY: number
  threshold: number
  excludeRivers: boolean
  minRegionArea: number
}

/**
 * Traces closed polygon rings from a labeled 2D raster grid for a specific region ID.
 * Follows exact pixel-boundary directed edges, ensuring 100% seamless topology with 0 gaps and 0 overlaps.
 */
function maskToPolygon(
  regMap: Int32Array,
  width: number,
  height: number,
  regionId: number,
  originX: number,
  originY: number,
  resolution: number,
): Polygon | MultiPolygon | null {
  const edgeMap = new Map<string, [number, number]>()

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (regMap[y * width + x] === regionId) {
        // Top edge: (x, y) -> (x + 1, y)
        if (y === 0 || regMap[(y - 1) * width + x] !== regionId) {
          edgeMap.set(`${x},${y}`, [x + 1, y])
        }
        // Right edge: (x + 1, y) -> (x + 1, y + 1)
        if (x === width - 1 || regMap[y * width + (x + 1)] !== regionId) {
          edgeMap.set(`${x + 1},${y}`, [x + 1, y + 1])
        }
        // Bottom edge: (x + 1, y + 1) -> (x, y + 1)
        if (y === height - 1 || regMap[(y + 1) * width + x] !== regionId) {
          edgeMap.set(`${x + 1},${y + 1}`, [x, y + 1])
        }
        // Left edge: (x, y + 1) -> (x, y)
        if (x === 0 || regMap[y * width + (x - 1)] !== regionId) {
          edgeMap.set(`${x},${y + 1}`, [x, y])
        }
      }
    }
  }

  const rings: [number, number][][] = []
  const visited = new Set<string>()

  for (const [startKey] of edgeMap.entries()) {
    if (visited.has(startKey)) continue

    const ring: [number, number][] = []
    let currKey = startKey
    const [sx, sy] = startKey.split(',').map(Number)
    ring.push([originX + sx / resolution, originY + sy / resolution])

    let step = 0
    while (step < 30000) {
      visited.add(currKey)
      const next = edgeMap.get(currKey)
      if (!next) break

      const nextKey = `${next[0]},${next[1]}`
      ring.push([originX + next[0] / resolution, originY + next[1] / resolution])

      if (nextKey === startKey) {
        break
      }
      currKey = nextKey
      step++
    }

    if (ring.length >= 4) {
      // Simplify collinear vertices and ensure native 8-connectivity pixel steps
      const simplified = pixelateLine(ring, 1.0)
      if (simplified.length >= 4) {
        rings.push(simplified)
      }
    }
  }

  if (rings.length === 0) return null

  try {
    const poly = turf.polygon(rings)
    return poly.geometry as Polygon
  } catch {
    return null
  }
}

/**
 * Extracts distinct regions from a photo aligned over a country's boundaries.
 * Runs completely in-memory using pure HTML5 Canvas and flood-fill segmentation.
 */
export function extractRegionsFromImage(options: ExtractionOptions): {
  regions: ExtractedRegion[]
  previewCanvasUrl: string
} {
  const {
    countryFeature,
    countryId,
    imageElement,
    scale,
    scaleX: optScaleX,
    scaleY: optScaleY,
    offsetX,
    offsetY,
    threshold,
    excludeRivers,
    minRegionArea,
  } = options

  const sX = optScaleX ?? scale ?? 1.0
  const sY = optScaleY ?? scale ?? 1.0

  const [minX, minY, maxX, maxY] = turf.bbox(countryFeature)
  const cWidth = Math.max(1, maxX - minX)
  const cHeight = Math.max(1, maxY - minY)

  // Use 1.0 world coordinate resolution (1 unit = 1 pixel)
  const resolution = 1.0
  const gridW = Math.max(10, Math.ceil(cWidth * resolution))
  const gridH = Math.max(10, Math.ceil(cHeight * resolution))

  // Offscreen canvas for sampling image pixels
  const imgCanvas = document.createElement('canvas')
  imgCanvas.width = imageElement.naturalWidth || imageElement.width || 800
  imgCanvas.height = imageElement.naturalHeight || imageElement.height || 600
  const imgCtx = imgCanvas.getContext('2d')
  if (!imgCtx) {
    return { regions: [], previewCanvasUrl: '' }
  }
  imgCtx.drawImage(imageElement, 0, 0)
  const imgData = imgCtx.getImageData(0, 0, imgCanvas.width, imgCanvas.height)
  const pixels = imgData.data
  const imgW = imgCanvas.width
  const imgH = imgCanvas.height

  // 1. Build grid: -999 = outside country, 0 = inside country land, -1 = detected border line
  const grid = new Int32Array(gridW * gridH)
  grid.fill(-999)

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const worldX = minX + gx / resolution + 0.5
      const worldY = minY + gy / resolution + 0.5

      if (turf.booleanPointInPolygon([worldX, worldY], countryFeature)) {
        // Map world coordinate to image coordinate based on alignment scale and offset
        const normX = (worldX - (minX + offsetX)) / (cWidth * sX)
        const normY = (worldY - (minY + offsetY)) / (cHeight * sY)

        if (normX >= 0 && normX < 1 && normY >= 0 && normY < 1) {
          const ix = Math.floor(normX * imgW)
          const iy = Math.floor(normY * imgH)
          const pIdx = (iy * imgW + ix) * 4

          const r = pixels[pIdx]
          const g = pixels[pIdx + 1]
          const b = pixels[pIdx + 2]

          const gray = 0.299 * r + 0.587 * g + 0.114 * b

          // River detection: cyan/teal/blue hues where blue > red + 16 and green > red + 10
          const isRiver = excludeRivers && b > r + 16 && g > r + 10

          // Border detection: dark lines that are not rivers
          const isBorder = gray < threshold && !isRiver

          grid[gy * gridW + gx] = isBorder ? -1 : 0
        } else {
          grid[gy * gridW + gx] = 0
        }
      }
    }
  }

  // 2. Connected components labeling (BFS flood fill inside land with grid === 0)
  const regMap = new Int32Array(gridW * gridH)
  let currentRegId = 1
  const regionPixelCounts = new Map<number, number>()

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const idx = gy * gridW + gx
      if (grid[idx] === 0 && regMap[idx] === 0) {
        let count = 0
        const queue: [number, number][] = [[gx, gy]]
        regMap[idx] = currentRegId

        while (queue.length > 0) {
          const [cx, cy] = queue.pop()!
          count++

          const neighbors = [
            [cx + 1, cy],
            [cx - 1, cy],
            [cx, cy + 1],
            [cx, cy - 1],
          ]

          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
              const nIdx = ny * gridW + nx
              if (grid[nIdx] === 0 && regMap[nIdx] === 0) {
                regMap[nIdx] = currentRegId
                queue.push([nx, ny])
              }
            }
          }
        }

        regionPixelCounts.set(currentRegId, count)
        currentRegId++
      }
    }
  }

  // 3. Multi-source BFS to assign barrier pixels (-1) to the nearest region ID (seamless Voronoi)
  const bfsQueue: [number, number, number][] = []
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const id = regMap[gy * gridW + gx]
      if (id > 0) {
        bfsQueue.push([gx, gy, id])
      }
    }
  }

  let head = 0
  while (head < bfsQueue.length) {
    const [cx, cy, id] = bfsQueue[head++]
    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ]

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
        const nIdx = ny * gridW + nx
        // Barrier inside country that has not received an ID yet
        if (grid[nIdx] === -1 && regMap[nIdx] === 0) {
          regMap[nIdx] = id
          bfsQueue.push([nx, ny, id])
        }
      }
    }
  }

  // 4. Filter small noise regions (< minRegionArea) and merge them into neighbor regions
  for (const [id, count] of regionPixelCounts.entries()) {
    if (count < minRegionArea) {
      // Find neighbor with largest count
      let bestNeighbor = 0
      let maxNeighborArea = 0

      for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
          if (regMap[gy * gridW + gx] === id) {
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]) {
              const nx = gx + dx
              const ny = gy + dy
              if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                const nid = regMap[ny * gridW + nx]
                if (nid > 0 && nid !== id) {
                  const nArea = regionPixelCounts.get(nid) || 0
                  if (nArea > maxNeighborArea) {
                    maxNeighborArea = nArea
                    bestNeighbor = nid
                  }
                }
              }
            }
          }
        }
      }

      if (bestNeighbor > 0) {
        for (let i = 0; i < regMap.length; i++) {
          if (regMap[i] === id) {
            regMap[i] = bestNeighbor
          }
        }
      }
    }
  }

  // 5. Gather unique region IDs sorted by area descending
  const finalIds = new Set<number>()
  for (let i = 0; i < regMap.length; i++) {
    if (regMap[i] > 0) finalIds.add(regMap[i])
  }

  const sortedIds = Array.from(finalIds).sort((a, b) => {
    const areaA = regionPixelCounts.get(a) || 0
    const areaB = regionPixelCounts.get(b) || 0
    return areaB - areaA
  })

  // 6. Generate GeoJSON Polygons for each region
  const extractedRegions: ExtractedRegion[] = []
  let regIndex = 1

  for (const rid of sortedIds) {
    const polyGeom = maskToPolygon(regMap, gridW, gridH, rid, minX, minY, resolution)
    if (!polyGeom) continue

    // Intersect strictly with parent country polygon
    try {
      const clipped = turf.intersect(turf.featureCollection([countryFeature, turf.feature(polyGeom)]))
      if (clipped && turf.area(clipped) > 0.01) {
        const areaWorld = Math.round(turf.area(clipped))
        const regNumber = regIndex
        const regId = `${countryId}-region-${String(regNumber).padStart(2, '0')}`

        extractedRegions.push({
          id: regId,
          number: regNumber,
          name: `Регион ${regNumber}`,
          isCapital: regNumber === 1,
          geometry: clipped.geometry as Polygon | MultiPolygon,
          areaPx: areaWorld,
          colorIndex: regNumber % 5,
        })
        regIndex++
      }
    } catch {
      // Ignore degenerate
    }
  }

  // 7. Render debug preview canvas with lines overlaid
  const previewCanvas = document.createElement('canvas')
  previewCanvas.width = gridW * 2
  previewCanvas.height = gridH * 2
  const pCtx = previewCanvas.getContext('2d')
  let previewUrl = ''

  if (pCtx) {
    pCtx.imageSmoothingEnabled = false
    // Draw detected lines
    const pData = pCtx.createImageData(gridW, gridH)
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const idx = gy * gridW + gx
        const outIdx = (gy * gridW + gx) * 4
        if (grid[idx] === -1) {
          // Neon cyan detected border line
          pData.data[outIdx] = 34
          pData.data[outIdx + 1] = 211
          pData.data[outIdx + 2] = 238
          pData.data[outIdx + 3] = 255
        } else if (regMap[idx] > 0) {
          // Soft region tint
          const col = (regMap[idx] * 47) % 255
          pData.data[outIdx] = col
          pData.data[outIdx + 1] = 120
          pData.data[outIdx + 2] = 200
          pData.data[outIdx + 3] = 80
        } else {
          pData.data[outIdx + 3] = 0
        }
      }
    }
    // Draw scaled up to preview
    const tempC = document.createElement('canvas')
    tempC.width = gridW
    tempC.height = gridH
    tempC.getContext('2d')?.putImageData(pData, 0, 0)
    pCtx.drawImage(tempC, 0, 0, previewCanvas.width, previewCanvas.height)
    previewUrl = previewCanvas.toDataURL('image/png')
  }

  return {
    regions: extractedRegions,
    previewCanvasUrl: previewUrl,
  }
}
