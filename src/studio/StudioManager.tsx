import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map, MapMouseEvent } from 'maplibre-gl'
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson'
import * as turf from '@turf/turf'
import { assignCountryThemeColors } from '../map/countryColorAssignment'
import { worldFeatureCollectionToMap } from '../map/geojsonCoordinates'
import { mapToWorld, worldToMap } from '../map/worldCoordinates'
import {
  claimIslandGeometry,
  createCountryFromTerritory,
  findTerritoryComponentAt,
  findTerritoryFromLasso,
  pixelateLine,
  recalculateBordersAndLabels,
  splitPolygonGeometry,
} from './geometryOperations'
import { StudioCreateCountryModal } from './StudioCreateCountryModal'
import { StudioDrawingCanvas } from './StudioDrawingCanvas'
import { StudioPublishModal } from './StudioPublishModal'
import { StudioRegionPhotoModal } from './StudioRegionPhotoModal'
import { StudioSidebar } from './StudioSidebar'
import { StudioToolbar } from './StudioToolbar'
import type { GeoJsonDataState, StudioMode, StudioToast, StudioTool } from './types'

type Props = {
  map: Map | null
  onExit: () => void
}

export function StudioManager({ map, onExit }: Props) {
  const [data, setData] = useState<GeoJsonDataState | null>(null)
  const [mode, setMode] = useState<StudioMode>('countries')
  const [activeTool, setActiveTool] = useState<StudioTool>('select')
  const [selectedCountryId, setSelectedCountryId] = useState<string | null>(null)
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [fillCountryId, setFillCountryId] = useState<string | null>('country-006')
  const [fillRegionId, setFillRegionId] = useState<string | null>(null)
  const [unsavedCount, setUnsavedCount] = useState<number>(0)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [isPublishOpen, setIsPublishOpen] = useState<boolean>(false)
  const [isRegionPhotoModalOpen, setIsRegionPhotoModalOpen] = useState<boolean>(false)
  const [mapOverlay, setMapOverlay] = useState<{
    imageUrl: string
    bounds: [number, number, number, number]
    opacity: number
  } | null>(null)
  const [toasts, setToasts] = useState<StudioToast[]>([])
  const [history, setHistory] = useState<GeoJsonDataState[]>([])
  const [future, setFuture] = useState<GeoJsonDataState[]>([])
  const [createCountryModalState, setCreateCountryModalState] = useState<{
    isOpen: boolean
    territory: Feature<Polygon | MultiPolygon> | null
    sourceCountryName: string | null
    suggestedId: string
    suggestedColorIndex: number
  }>({
    isOpen: false,
    territory: null,
    sourceCountryName: null,
    suggestedId: '',
    suggestedColorIndex: 0,
  })

  const dataRef = useRef<GeoJsonDataState | null>(null)
  dataRef.current = data

  const addToast = (message: string, type: StudioToast['type'] = 'info') => {
    const id = String(Date.now() + Math.random())
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 4500)
  }

  // Load all map datasets
  useEffect(() => {
    const loadData = async () => {
      try {
        const base = import.meta.env.BASE_URL
        const [
          rawCountries,
          countryBorders,
          regions,
          regionBorders,
          countryLabels,
          regionLabels,
          land,
          countryNames,
        ] = await Promise.all([
          fetch(`${base}data/countries-display.geojson`).then((r) => r.json()),
          fetch(`${base}data/country-borders-display.geojson`).then((r) => r.json()),
          fetch(`${base}data/regions.geojson`).then((r) => r.json()),
          fetch(`${base}data/region-borders.geojson`).then((r) => r.json()),
          fetch(`${base}data/country-label-points.geojson`).then((r) => r.json()),
          fetch(`${base}data/region-label-points.geojson`).then((r) => r.json()),
          fetch(`${base}data/land.geojson`).then((r) => r.json()),
          fetch(`${base}data/country-debug-label-report.json`)
            .then((r) => r.json())
            .catch(() => ({})),
        ])

        // Ensure countries ALWAYS have their themeColorIndex preserved
        const countries = assignCountryThemeColors(rawCountries) as FeatureCollection<Polygon | MultiPolygon>

        setData({
          countries,
          countryBorders,
          regions,
          regionBorders,
          countryLabels,
          regionLabels,
          land,
          countryNames,
        })

        if (countries.features.length > 0) {
          const firstId = countries.features[0].properties?.id || 'country-006'
          setFillCountryId(firstId)
        }

        addToast('Данные карты загружены в Студию', 'info')
      } catch (err) {
        console.error(err)
        addToast('Не удалось загрузить данные карты для редактирования', 'error')
      }
    }

    loadData()
  }, [])

  // Push in-memory data updates into MapLibre GL sources with colors preserved!
  const syncMapSources = useCallback(
    (nextData: GeoJsonDataState) => {
      if (!map) return
      try {
        const coloredCountries = assignCountryThemeColors(nextData.countries)

        const cSource = map.getSource('countries') as any
        cSource?.setData(worldFeatureCollectionToMap(coloredCountries))

        const cbSource = map.getSource('country-borders') as any
        cbSource?.setData(worldFeatureCollectionToMap(nextData.countryBorders))

        const rSource = map.getSource('regions') as any
        rSource?.setData(worldFeatureCollectionToMap(nextData.regions))

        const rbSource = map.getSource('region-borders') as any
        rbSource?.setData(worldFeatureCollectionToMap(nextData.regionBorders))

        const clSource = map.getSource('country-label-points') as any
        clSource?.setData(worldFeatureCollectionToMap(nextData.countryLabels))

        const rlSource = map.getSource('region-label-points') as any
        rlSource?.setData(worldFeatureCollectionToMap(nextData.regionLabels))
      } catch (err) {
        console.warn('Map source sync error:', err)
      }
    },
    [map],
  )

  // Commit a geometry change
  const applyDataUpdate = useCallback(
    (
      updater: (prev: GeoJsonDataState) => {
        countries?: FeatureCollection<Polygon | MultiPolygon>
        regions?: FeatureCollection<Polygon | MultiPolygon>
        countryLabels?: FeatureCollection<Point>
        regionLabels?: FeatureCollection<Point>
        countryNames?: Record<string, { name: string }>
      },
    ) => {
      setData((prev) => {
        if (!prev) return prev
        const updates = updater(prev)
        const countries = updates.countries ?? prev.countries
        const regions = updates.regions ?? prev.regions
        const countryNames = updates.countryNames ?? prev.countryNames

        const currentCountryLabels = updates.countryLabels ?? prev.countryLabels
        const currentRegionLabels = updates.regionLabels ?? prev.regionLabels

        const coloredCountries = assignCountryThemeColors(countries) as FeatureCollection<Polygon | MultiPolygon>

        const { countryBorders, regionBorders, countryLabels, regionLabels } = recalculateBordersAndLabels(
          coloredCountries,
          regions,
          currentCountryLabels,
          currentRegionLabels,
        )

        const nextState: GeoJsonDataState = {
          ...prev,
          countries: coloredCountries,
          regions,
          countryBorders,
          regionBorders,
          countryLabels: updates.countryLabels ?? countryLabels,
          regionLabels: updates.regionLabels ?? regionLabels,
          countryNames,
        }

        // Record undo history (preserve up to 30 past steps)
        setHistory((h) => [...h.slice(-29), prev])
        // Clear redo stack on new operation
        setFuture([])

        syncMapSources(nextState)
        setUnsavedCount((c) => c + 1)
        return nextState
      })
    },
    [syncMapSources],
  )

  // Undo: Step back 1 action
  const handleUndo = useCallback(() => {
    setHistory((prevHistory) => {
      if (prevHistory.length === 0) return prevHistory
      const lastState = prevHistory[prevHistory.length - 1]
      const newHistory = prevHistory.slice(0, -1)
      const currentData = dataRef.current

      if (currentData) {
        setFuture((prevFuture) => [...prevFuture.slice(-29), currentData])
      }

      setData(lastState)
      syncMapSources(lastState)
      addToast('↩️ Отмена действия (шаг назад)', 'info')
      return newHistory
    })
  }, [syncMapSources])

  // Redo: Step forward 1 action
  const handleRedo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture
      const nextState = prevFuture[prevFuture.length - 1]
      const newFuture = prevFuture.slice(0, -1)
      const currentData = dataRef.current

      if (currentData) {
        setHistory((prevHistory) => [...prevHistory.slice(-29), currentData])
      }

      setData(nextState)
      syncMapSources(nextState)
      addToast('↪️ Повтор действия (шаг вперёд)', 'info')
      return newFuture
    })
  }, [syncMapSources])

  // Zoom map to feature bbox
  const zoomToFeature = useCallback(
    (feature: Feature<Polygon | MultiPolygon>) => {
      if (!map) return
      const [minX, minY, maxX, maxY] = turf.bbox(feature)
      const sw = worldToMap({ x: minX, y: maxY })
      const ne = worldToMap({ x: maxX, y: minY })
      map.fitBounds([sw, ne], { padding: 90, duration: 600 })
    },
    [map],
  )

  // Select country
  const handleSelectCountry = useCallback(
    (countryId: string | null) => {
      setSelectedCountryId(countryId)
      if (countryId) {
        setFillCountryId(countryId)
        const country = data?.countries.features.find((c) => c.properties?.id === countryId)
        if (country) {
          zoomToFeature(country)
        }
      }
    },
    [data, zoomToFeature],
  )

  // Select region
  const handleSelectRegion = useCallback(
    (regionId: string | null) => {
      setSelectedRegionId(regionId)
      if (regionId) {
        setFillRegionId(regionId)
        const region = data?.regions.features.find((r) => r.properties?.id === regionId)
        if (region) {
          zoomToFeature(region)
          if (region.properties?.countryId) {
            setSelectedCountryId(region.properties.countryId)
            setFillCountryId(region.properties.countryId)
          }
        }
      }
    },
    [data, zoomToFeature],
  )

  // Move label position within polygon boundaries
  const handleMoveLabel = useCallback(
    (labelId: string, newWorldPt: [number, number], type: 'country' | 'region') => {
      applyDataUpdate((prev) => {
        if (type === 'country') {
          const updatedLabels = prev.countryLabels.features.map((l) => {
            if (l.properties?.id === labelId) {
              return {
                ...l,
                geometry: {
                  type: 'Point' as const,
                  coordinates: newWorldPt,
                },
              }
            }
            return l
          })
          return {
            countryLabels: { ...prev.countryLabels, features: updatedLabels },
          }
        } else {
          const updatedLabels = prev.regionLabels.features.map((l) => {
            if (l.properties?.id === labelId) {
              return {
                ...l,
                geometry: {
                  type: 'Point' as const,
                  coordinates: newWorldPt,
                },
              }
            }
            return l
          })
          return {
            regionLabels: { ...prev.regionLabels, features: updatedLabels },
          }
        }
      })
    },
    [applyDataUpdate],
  )

  // Map clicks for selection
  useEffect(() => {
    if (!map || activeTool !== 'select') return

    const handleMapClick = (e: MapMouseEvent) => {
      const world = mapToWorld(e.lngLat.lng, e.lngLat.lat)
      const pt: [number, number] = [world.x, world.y]

      if (mode === 'regions') {
        const clickedRegion = dataRef.current?.regions.features.find((r) =>
          turf.booleanPointInPolygon(pt, r),
        )
        if (clickedRegion) {
          setSelectedRegionId(clickedRegion.properties!.id)
          setFillRegionId(clickedRegion.properties!.id)
          if (clickedRegion.properties?.countryId) {
            setSelectedCountryId(clickedRegion.properties.countryId)
            setFillCountryId(clickedRegion.properties.countryId)
          }
          return
        }
      }

      const clickedCountry = dataRef.current?.countries.features.find((c) =>
        turf.booleanPointInPolygon(pt, c),
      )
      if (clickedCountry) {
        setSelectedCountryId(clickedCountry.properties!.id)
        setFillCountryId(clickedCountry.properties!.id)
      }
    }

    map.on('click', handleMapClick)
    return () => {
      map.off('click', handleMapClick)
    }
  }, [map, activeTool, mode])

  // 1. Slicing regions with thin line
  const handleSliceLine = useCallback(
    (linePoints: [number, number][]) => {
      if (!data) return

      // Convert hand-drawn continuous points into stepped 8-connected raster coordinates matching native masks
      const pixelatedLine = pixelateLine(linePoints, 1.0)
      if (pixelatedLine.length < 2) return

      let splitResult: { part1: Polygon | MultiPolygon; part2: Polygon | MultiPolygon } | null = null
      let targetRegion: Feature<Polygon | MultiPolygon> | null = null
      let targetCountryId = selectedCountryId || fillCountryId

      const countryRegions = targetCountryId
        ? data.regions.features.filter((r) => r.properties?.countryId === targetCountryId)
        : data.regions.features

      // Determine which region the user ACTUALLY drew inside by scoring interior stroke points!
      if (countryRegions.length > 0) {
        const interiorStrokePoints: [number, number][] = []
        if (pixelatedLine.length <= 2) {
          interiorStrokePoints.push([
            (pixelatedLine[0][0] + pixelatedLine[1][0]) / 2,
            (pixelatedLine[0][1] + pixelatedLine[1][1]) / 2,
          ])
        } else {
          const step = Math.max(1, Math.floor(pixelatedLine.length / 25))
          for (let i = 1; i < pixelatedLine.length - 1; i += step) {
            interiorStrokePoints.push(pixelatedLine[i])
          }
          const midIdx = Math.floor(pixelatedLine.length / 2)
          interiorStrokePoints.push(pixelatedLine[midIdx])
        }

        // Score all regions: count how many interior points of the drawn stroke fall inside each region
        const scoredRegions = countryRegions
          .map((reg) => {
            let score = 0
            for (const pt of interiorStrokePoints) {
              if (turf.booleanPointInPolygon(turf.point(pt), reg)) {
                score++
              }
            }
            // If user explicitly selected this region, give a slight boost if it also contains points
            if (reg.properties?.id === selectedRegionId && score > 0) {
              score += 2
            }
            return { reg, score }
          })
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score)

        // Attempt split strictly in order of stroke containment (highest score first)
        for (const { reg } of scoredRegions) {
          const res = splitPolygonGeometry(reg.geometry, pixelatedLine)
          if (res) {
            splitResult = res
            targetRegion = reg
            targetCountryId = reg.properties?.countryId || targetCountryId
            break
          }
        }
      }

      // If country has no regions yet (or stroke is on unpartitioned country land):
      if (!splitResult && targetCountryId) {
        const country = data.countries.features.find((c) => c.properties?.id === targetCountryId)
        if (country) {
          splitResult = splitPolygonGeometry(country.geometry, pixelatedLine)
        }
      }

      if (!splitResult || !targetCountryId) {
        addToast('Проведите линию через территорию региона или замкните петлю (лассо)', 'warning')
        return
      }

      const existingInCountry = data.regions.features.filter((r) => r.properties?.countryId === targetCountryId)
      const targetRegionNumber = existingInCountry.length + 1

      const newRegionId = `${targetCountryId}-region-${String(targetRegionNumber).padStart(2, '0')}`
      const newRegionName = `Регион ${targetRegionNumber}`

      // Determine which part keeps existing region identity (preserving capital and label position)
      let partToKeep = splitResult.part1
      let partNewRegion = splitResult.part2

      if (targetRegion) {
        const existingLabel = data.regionLabels.features.find(
          (l) => l.properties?.id === targetRegion?.properties?.id,
        )
        if (existingLabel) {
          const pt = existingLabel.geometry.coordinates as [number, number]
          const inPart1 = turf.booleanPointInPolygon(pt, turf.feature(splitResult.part1))
          const inPart2 = turf.booleanPointInPolygon(pt, turf.feature(splitResult.part2))

          if (inPart2 && !inPart1) {
            partToKeep = splitResult.part2
            partNewRegion = splitResult.part1
          }
        } else {
          // Larger part stays with existing region
          if (turf.area(turf.feature(splitResult.part2)) > turf.area(turf.feature(splitResult.part1))) {
            partToKeep = splitResult.part2
            partNewRegion = splitResult.part1
          }
        }
      }

      const newFeature: Feature<Polygon | MultiPolygon> = {
        type: 'Feature',
        id: newRegionId,
        geometry: partNewRegion,
        properties: {
          id: newRegionId,
          number: targetRegionNumber,
          name: newRegionName,
          type: 'region',
          countryId: targetCountryId,
          isCapital: false,
          labelRank: 1,
          styleIndex: targetRegionNumber % 5,
        },
      }

      applyDataUpdate((prev) => {
        let updatedRegions: Feature<Polygon | MultiPolygon>[]

        if (targetRegion) {
          updatedRegions = prev.regions.features.map((r) => {
            if (r.properties?.id === targetRegion?.properties?.id) {
              return { ...r, geometry: partToKeep }
            }
            return r
          })
          updatedRegions.push(newFeature)
        } else {
          const r1Id = `${targetCountryId}-region-01`
          const r1Name = `Регион 1`
          const r1Feature: Feature<Polygon | MultiPolygon> = {
            type: 'Feature',
            id: r1Id,
            geometry: splitResult.part1,
            properties: {
              id: r1Id,
              number: 1,
              name: r1Name,
              type: 'region',
              countryId: targetCountryId,
              isCapital: true,
              labelRank: 1,
              styleIndex: 0,
            },
          }
          const r2Feature: Feature<Polygon | MultiPolygon> = {
            ...newFeature,
            id: `${targetCountryId}-region-02`,
            geometry: splitResult.part2,
            properties: {
              ...newFeature.properties,
              id: `${targetCountryId}-region-02`,
              number: 2,
              name: 'Регион 2',
            },
          }
          updatedRegions = [...prev.regions.features, r1Feature, r2Feature]
        }

        return {
          regions: {
            ...prev.regions,
            features: updatedRegions,
          },
        }
      })

      addToast(`Создан новый регион: «${newRegionName}»!`, 'success')
      // Do not lock to new region, allowing continuous uninterrupted slicing!
      setSelectedRegionId(null)
    },
    [data, selectedCountryId, fillCountryId, selectedRegionId, applyDataUpdate],
  )

  // 2. Lasso territory transfer (former redraw border)
  const handleRedrawBorderLine = useCallback(
    (linePoints: [number, number][]) => {
      if (!data) return
      if (linePoints.length < 3) {
        addToast('Обведите петлей лассо территорию для передачи', 'warning')
        return
      }

      // Convert hand-drawn continuous points into stepped 8-connected raster coordinates matching native masks
      const pixelatedLine = pixelateLine(linePoints, 1.0)
      if (pixelatedLine.length < 3) return

      const closedPoints = [...pixelatedLine, pixelatedLine[0]]
      let drawnPoly: Feature<Polygon | MultiPolygon>
      try {
        const poly = turf.polygon([closedPoints])
        const unkinked = turf.unkinkPolygon(poly)
        if (unkinked.features.length > 1) {
          let merged: Feature<Polygon | MultiPolygon> = unkinked.features[0]
          for (let i = 1; i < unkinked.features.length; i++) {
            const u = turf.union(turf.featureCollection([merged, unkinked.features[i]]))
            if (u) merged = u as Feature<Polygon | MultiPolygon>
          }
          drawnPoly = merged
        } else {
          drawnPoly = poly
        }
      } catch {
        addToast('Не удалось сформировать замкнутый контур. Попробуйте обвести территорию еще раз!', 'warning')
        return
      }

      if (mode === 'countries') {
        const countryId = selectedCountryId || fillCountryId
        if (!countryId) {
          addToast('Выберите страну в панели для передачи территории!', 'warning')
          return
        }

        const landFeature = data.land.features[0]
        if (!landFeature) return
        const landPart = turf.intersect(turf.featureCollection([landFeature, drawnPoly]))
        if (!landPart || turf.area(landPart) <= 0.01) {
          addToast('Обведённая область лассо не попадает на сушу', 'warning')
          return
        }

        const targetCountryName =
          data.countries.features.find((c) => c.properties?.id === countryId)?.properties?.name || 'стране'

        applyDataUpdate((prev) => {
          const targetCountry = prev.countries.features.find((c) => c.properties?.id === countryId)
          if (!targetCountry) return {}

          const newTarget = turf.union(turf.featureCollection([targetCountry, landPart]))
          if (!newTarget) return {}

          // Trim other countries
          const updatedCountries = prev.countries.features.map((feature) => {
            if (feature.properties?.id === countryId) {
              return { ...feature, geometry: newTarget.geometry as Polygon | MultiPolygon }
            }
            const inter = turf.intersect(turf.featureCollection([feature, landPart]))
            if (inter && turf.area(inter) > 0.01) {
              const diff = turf.difference(turf.featureCollection([feature, landPart]))
              if (diff && turf.area(diff) > 0.01) {
                return { ...feature, geometry: diff.geometry as Polygon | MultiPolygon }
              }
            }
            return feature
          })

          // Also trim regions belonging to other countries that lost territory
          const updatedRegions = prev.regions.features
            .map((reg) => {
              if (reg.properties?.countryId === countryId) {
                return reg
              }
              const inter = turf.intersect(turf.featureCollection([reg, landPart]))
              if (inter && turf.area(inter) > 0.01) {
                const diff = turf.difference(turf.featureCollection([reg, landPart]))
                if (diff && turf.area(diff) > 0.01) {
                  return { ...reg, geometry: diff.geometry as Polygon | MultiPolygon }
                }
                return null
              }
              return reg
            })
            .filter((r): r is Feature<Polygon | MultiPolygon> => r !== null)

          return {
            countries: { ...prev.countries, features: updatedCountries },
            regions: { ...prev.regions, features: updatedRegions },
          }
        })

        addToast(`Территория успешно передана государству «${targetCountryName}»!`, 'success')
      } else if (mode === 'regions') {
        const targetRegionId = selectedRegionId || fillRegionId
        if (!targetRegionId) {
          addToast('Выберите регион в панели для передачи территории!', 'warning')
          return
        }

        const targetReg = data.regions.features.find((r) => r.properties?.id === targetRegionId)
        if (!targetReg) return
        const parentCountry = data.countries.features.find((c) => c.properties?.id === targetReg.properties?.countryId)
        if (!parentCountry) return

        const validPart = turf.intersect(turf.featureCollection([parentCountry, drawnPoly]))
        if (!validPart || turf.area(validPart) <= 0.01) {
          addToast('Область лассо должна находиться внутри границ родительской страны', 'warning')
          return
        }

        const targetRegionName = targetReg.properties?.name || 'региону'

        applyDataUpdate((prev) => {
          const newTarget = turf.union(turf.featureCollection([targetReg, validPart]))
          if (!newTarget) return {}

          const parentId = targetReg.properties?.countryId
          const updatedRegions = prev.regions.features.map((feature) => {
            if (feature.properties?.id === targetRegionId) {
              return { ...feature, geometry: newTarget.geometry as Polygon | MultiPolygon }
            }
            if (feature.properties?.countryId === parentId) {
              const inter = turf.intersect(turf.featureCollection([feature, validPart]))
              if (inter && turf.area(inter) > 0.01) {
                const diff = turf.difference(turf.featureCollection([feature, validPart]))
                if (diff && turf.area(diff) > 0.01) {
                  return { ...feature, geometry: diff.geometry as Polygon | MultiPolygon }
                }
              }
            }
            return feature
          })

          return { regions: { ...prev.regions, features: updatedRegions } }
        })

        addToast(`Территория успешно передана региону «${targetRegionName}»!`, 'success')
      }
    },
    [data, mode, selectedCountryId, fillCountryId, selectedRegionId, fillRegionId, applyDataUpdate],
  )

  // 3. Bucket fill with explicitly selected country / region
  const handleBucketClick = useCallback(
    (clickWorldPt: [number, number]) => {
      if (!data) return
      const targetCId = fillCountryId || selectedCountryId
      if (!targetCId) {
        addToast('Выберите в выпадающем списке страну, которой хотите залить остров!', 'warning')
        return
      }

      const targetType = mode === 'regions' && fillRegionId ? 'region' : 'country'
      const targetId = targetType === 'region' ? fillRegionId! : targetCId

      const result = claimIslandGeometry(
        clickWorldPt,
        targetId,
        targetType,
        data.land,
        data.countries,
        data.regions,
      )

      if (result) {
        applyDataUpdate(() => result)
        const countryName =
          data.countries.features.find((c) => c.properties?.id === targetCId)?.properties?.name || targetCId
        addToast(`Остров успешно залит для государства «${countryName}»!`, 'success')
      } else {
        addToast('В этой точке нет острова или участка суши.', 'warning')
      }
    },
    [data, mode, fillCountryId, selectedCountryId, fillRegionId, applyDataUpdate],
  )

  // Helper to calculate next country ID and non-conflicting color
  const getNextCountryIdAndColor = useCallback(
    (territory: Feature<Polygon | MultiPolygon>) => {
      if (!dataRef.current) return { nextId: 'country-026', colorIndex: 0 }
      const existingIds = dataRef.current.countries.features.map((f) => {
        const m = f.properties?.id?.match(/country-(\d+)/)
        return m ? parseInt(m[1], 10) : 0
      })
      const nextNum = Math.max(...existingIds, 0) + 1
      const nextId = `country-${String(nextNum).padStart(3, '0')}`

      const territoryCenter = turf.pointOnFeature(territory)
      const neighborColors = new Set<number>()
      for (const country of dataRef.current.countries.features) {
        if (!country.geometry) continue
        try {
          const inter = turf.intersect(turf.featureCollection([country, territory]))
          const dist = turf.distance(territoryCenter, turf.pointOnFeature(country))
          if ((inter && turf.area(inter) > 0.01) || dist < 2500) {
            if (typeof country.properties?.themeColorIndex === 'number') {
              neighborColors.add(country.properties.themeColorIndex)
            }
          }
        } catch {
          // Ignore
        }
      }

      let colorIndex = 0
      for (let c = 0; c < 8; c++) {
        if (!neighborColors.has(c)) {
          colorIndex = c
          break
        }
      }

      return { nextId, colorIndex }
    },
    [],
  )

  // 4. Create country handlers (click or lasso)
  const handleCreateCountryClick = useCallback(
    (clickWorldPt: [number, number]) => {
      if (!data) return
      const found = findTerritoryComponentAt(clickWorldPt, data.countries, data.land)
      if (!found) {
        addToast('Кликните по острову или участку суши для создания государства', 'warning')
        return
      }

      const { nextId, colorIndex } = getNextCountryIdAndColor(found.territory)
      setCreateCountryModalState({
        isOpen: true,
        territory: found.territory,
        sourceCountryName: found.sourceCountryName,
        suggestedId: nextId,
        suggestedColorIndex: colorIndex,
      })
    },
    [data, getNextCountryIdAndColor],
  )

  const handleCreateCountryLasso = useCallback(
    (linePoints: [number, number][]) => {
      if (!data) return
      const found = findTerritoryFromLasso(linePoints, data.countries, data.land)
      if (!found) {
        addToast('Обведите замкнутой петлёй участок суши для отделения в государство', 'warning')
        return
      }

      const { nextId, colorIndex } = getNextCountryIdAndColor(found.territory)
      setCreateCountryModalState({
        isOpen: true,
        territory: found.territory,
        sourceCountryName: found.sourceCountryName,
        suggestedId: nextId,
        suggestedColorIndex: colorIndex,
      })
    },
    [data, getNextCountryIdAndColor],
  )

  const handleConfirmCreateCountry = useCallback(
    ({
      countryName,
      themeColorIndex,
      createCapitalRegion,
    }: {
      countryName: string
      themeColorIndex: number
      createCapitalRegion: boolean
    }) => {
      if (!data || !createCountryModalState.territory) return

      const result = createCountryFromTerritory({
        territory: createCountryModalState.territory,
        countryName,
        themeColorIndex,
        createCapitalRegion,
        countriesFC: data.countries,
        regionsFC: data.regions,
        countryNames: data.countryNames,
      })

      applyDataUpdate(() => ({
        countries: result.countries,
        regions: result.regions,
        countryNames: result.countryNames,
      }))

      setCreateCountryModalState({
        isOpen: false,
        territory: null,
        sourceCountryName: null,
        suggestedId: '',
        suggestedColorIndex: 0,
      })

      setSelectedCountryId(result.newCountryId)
      setFillCountryId(result.newCountryId)
      setActiveTool('select')

      addToast(`🎉 Государство «${countryName}» (${result.newCountryId}) успешно создано!`, 'success')
    },
    [data, createCountryModalState.territory, applyDataUpdate],
  )

  // 4. Renaming countries
  const handleCountryNameChange = useCallback(
    (countryId: string, newName: string) => {
      applyDataUpdate((prev) => {
        const updated = prev.countries.features.map((c) => {
          if (c.properties?.id === countryId) {
            return {
              ...c,
              properties: { ...c.properties, name: newName },
            }
          }
          return c
        })

        const updatedNames = {
          ...prev.countryNames,
          [countryId]: { name: newName },
        }

        return { countries: { ...prev.countries, features: updated }, countryNames: updatedNames }
      })
    },
    [applyDataUpdate],
  )

  // 5. Renaming regions
  const handleRegionNameChange = useCallback(
    (regionId: string, newName: string) => {
      applyDataUpdate((prev) => ({
        regions: {
          ...prev.regions,
          features: prev.regions.features.map((r) => {
            if (r.properties?.id === regionId) {
              return {
                ...r,
                properties: { ...r.properties, name: newName },
              }
            }
            return r
          }),
        },
      }))
    },
    [applyDataUpdate],
  )

  // Capital toggle for regions
  const handleRegionCapitalToggle = useCallback(
    (regionId: string, isCapital: boolean) => {
      applyDataUpdate((prev) => ({
        regions: {
          ...prev.regions,
          features: prev.regions.features.map((r) => {
            if (r.properties?.id === regionId) {
              return {
                ...r,
                properties: { ...r.properties, isCapital },
              }
            }
            return r
          }),
        },
      }))
    },
    [applyDataUpdate],
  )

  // Delete region
  const handleDeleteRegion = useCallback(
    (regionId: string) => {
      applyDataUpdate((prev) => ({
        regions: {
          ...prev.regions,
          features: prev.regions.features.filter((r) => r.properties?.id !== regionId),
        },
      }))
      setSelectedRegionId(null)
      setFillRegionId(null)
      addToast('Регион удален!', 'info')
    },
    [applyDataUpdate],
  )

  // Save locally
  const handleSave = useCallback(async () => {
    if (!dataRef.current) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/studio/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataRef.current),
      })
      const result = await res.json()
      if (result.success) {
        setUnsavedCount(0)
        addToast('Все файлы карты успешно сохранены локально!', 'success')
      } else {
        addToast(`Ошибка сохранения: ${result.error}`, 'error')
      }
    } catch (err: unknown) {
      addToast(`Ошибка сети: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [])

  // Apply regions extracted from photo
  const handleApplyImportedRegions = useCallback(
    (
      countryId: string,
      newRegions: Feature<Polygon | MultiPolygon>[],
      overlay: { imageUrl: string; bounds: [number, number, number, number]; opacity: number } | null,
    ) => {
      applyDataUpdate((prev) => {
        const otherRegions = prev.regions.features.filter((r) => r.properties?.countryId !== countryId)
        const mergedRegions = [...otherRegions, ...newRegions]
        return {
          regions: {
            type: 'FeatureCollection',
            features: mergedRegions,
          },
        }
      })

      if (overlay) {
        setMapOverlay(overlay)
      }

      setMode('regions')
      setSelectedCountryId(countryId)
      setFillCountryId(countryId)
      if (newRegions.length > 0) {
        setSelectedRegionId(newRegions[0].properties?.id ?? null)
      }
      addToast(`Импортировано регионов: ${newRegions.length} для выбранного государства!`, 'success')
    },
    [applyDataUpdate],
  )

  // Publish to GitHub
  const handlePublish = useCallback(
    async (message: string, deployGhPages: boolean) => {
      if (dataRef.current) {
        await fetch('/api/studio/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dataRef.current),
        })
      }

      const res = await fetch('/api/studio/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, deployGhPages }),
      })
      const result = await res.json()
      if (result.success) {
        setUnsavedCount(0)
      }
      return result
    },
    [],
  )

  // Hotkeys (Ctrl+S to save, Ctrl+Z to undo, Ctrl+Y / Ctrl+Shift+Z to redo, Esc to select)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isInput =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!isInput) {
          e.preventDefault()
          if (e.shiftKey) {
            handleRedo()
          } else {
            handleUndo()
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (!isInput) {
          e.preventDefault()
          handleRedo()
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      } else if (e.key === 'Escape') {
        setActiveTool('select')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSave, handleUndo, handleRedo])

  return (
    <div className="studio-root">
      {/* Top toolbar */}
      {data && (
        <StudioToolbar
          mode={mode}
          onModeChange={(m) => {
            setMode(m)
            setActiveTool('select')
          }}
          activeTool={activeTool}
          onToolChange={setActiveTool}
          countries={data.countries.features}
          regions={data.regions.features}
          fillCountryId={fillCountryId}
          onFillCountryChange={(cid) => {
            setFillCountryId(cid)
            setSelectedCountryId(cid)
          }}
          fillRegionId={fillRegionId}
          onFillRegionChange={setFillRegionId}
          unsavedCount={unsavedCount}
          isSaving={isSaving}
          onSave={handleSave}
          onPublishClick={() => setIsPublishOpen(true)}
          onExit={onExit}
          canUndo={history.length > 0}
          canRedo={future.length > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onOpenRegionPhotoModal={() => setIsRegionPhotoModalOpen(true)}
          hasMapOverlay={!!mapOverlay}
          onClearOverlay={() => setMapOverlay(null)}
        />
      )}

      {/* Side property panel */}
      {data && (
        <StudioSidebar
          mode={mode}
          activeTool={activeTool}
          countries={data.countries.features}
          regions={data.regions.features}
          selectedCountryId={selectedCountryId}
          selectedRegionId={selectedRegionId}
          fillCountryId={fillCountryId}
          onFillCountryChange={(cid) => {
            setFillCountryId(cid)
            setSelectedCountryId(cid)
          }}
          onSelectCountry={handleSelectCountry}
          onSelectRegion={handleSelectRegion}
          onCountryNameChange={handleCountryNameChange}
          onRegionNameChange={handleRegionNameChange}
          onRegionCapitalToggle={handleRegionCapitalToggle}
          onDeleteRegion={handleDeleteRegion}
          onStartSlice={() => {
            setMode('regions')
            setActiveTool('slice-region')
            addToast('Проведите тонкую линию через страну/регион, чтобы разрезать!', 'info')
          }}
          onStartRedrawBorder={() => {
            setActiveTool('redraw-border')
            addToast('Обведите тонкой линией территорию для присоединения!', 'info')
          }}
          onStartMoveLabel={() => {
            setActiveTool('move-label')
            addToast('Зажмите метку любого названия на карте и перемещайте её в нужное место!', 'info')
          }}
          onStartCreateCountry={() => {
            setMode('countries')
            setActiveTool('create-country')
            addToast('Кликните по острову или обведите территорию лассо для отделения в новую страну!', 'info')
          }}
        />
      )}

      {/* Drawing / Interaction overlay with wheel zoom, label dragging, and thin lines */}
      {data && (
        <StudioDrawingCanvas
          map={map}
          activeTool={activeTool}
          mode={mode}
          countryLabels={data.countryLabels}
          regionLabels={data.regionLabels}
          countries={data.countries}
          regions={data.regions}
          onSliceLine={handleSliceLine}
          onRedrawBorderLine={handleRedrawBorderLine}
          onBucketClick={handleBucketClick}
          onMoveLabel={handleMoveLabel}
          onCreateCountryClick={handleCreateCountryClick}
          onCreateCountryLasso={handleCreateCountryLasso}
          pendingTerritory={createCountryModalState.territory}
          mapOverlay={mapOverlay}
        />
      )}

      {/* Create Country Modal */}
      <StudioCreateCountryModal
        isOpen={createCountryModalState.isOpen}
        onClose={() =>
          setCreateCountryModalState((prev) => ({ ...prev, isOpen: false, territory: null }))
        }
        territory={createCountryModalState.territory}
        sourceCountryName={createCountryModalState.sourceCountryName}
        suggestedId={createCountryModalState.suggestedId}
        suggestedColorIndex={createCountryModalState.suggestedColorIndex}
        onConfirm={handleConfirmCreateCountry}
      />

      {/* Photo import modal for automatic region tracing */}
      {data && (
        <StudioRegionPhotoModal
          isOpen={isRegionPhotoModalOpen}
          onClose={() => setIsRegionPhotoModalOpen(false)}
          countries={data.countries.features}
          initialCountryId={selectedCountryId || fillCountryId}
          onApplyRegions={handleApplyImportedRegions}
        />
      )}

      {/* Publish modal */}
      <StudioPublishModal
        isOpen={isPublishOpen}
        onClose={() => setIsPublishOpen(false)}
        onPublish={handlePublish}
      />

      {/* Toast notifications */}
      <div className="studio-toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`studio-toast studio-toast--${toast.type}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  )
}
