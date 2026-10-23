import { useEffect, useRef, useState } from 'react'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import * as turf from '@turf/turf'
import {
  detectBorderGridPoints,
  extractRegionsFromImage,
  type ExtractedRegion,
} from './regionImageExtractor'
import type { StudioMapOverlay } from './types'

type Props = {
  isOpen: boolean
  onClose: () => void
  countries: Feature<Polygon | MultiPolygon>[]
  initialCountryId: string | null
  onApplyRegions: (
    countryId: string,
    regions: Feature<Polygon | MultiPolygon>[],
    mapOverlay: StudioMapOverlay | null,
  ) => void
  onSetMapOverlay?: (
    overlay: StudioMapOverlay,
  ) => void
}

const HISOLIA_PRESET_NAMES = [
  'Центральный Урих',
  'Биг Йорд',
  'Северный Урих',
  'Юго-Западный Асмаин',
  'Норд',
  'Южный Урих',
  'Хавгрэнс',
  'Белла',
  'Нью Вей',
  'Нижний Норд',
  'Странд',
]

export function StudioRegionPhotoModal({
  isOpen,
  onClose,
  countries,
  initialCountryId,
  onApplyRegions,
  onSetMapOverlay,
}: Props) {
  const [selectedCountryId, setSelectedCountryId] = useState<string>(
    initialCountryId || (countries[0]?.properties?.id ?? 'country-007'),
  )

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string>('')

  // Alignment controls
  const [scaleX, setScaleX] = useState<number>(1.0)
  const [scaleY, setScaleY] = useState<number>(1.0)
  const [lockAspect, setLockAspect] = useState<boolean>(false)
  const [offsetX, setOffsetX] = useState<number>(0)
  const [offsetY, setOffsetY] = useState<number>(0)
  const [opacity, setOpacity] = useState<number>(0.7)

  // Recognition controls
  const [threshold, setThreshold] = useState<number>(75)
  const [excludeRivers, setExcludeRivers] = useState<boolean>(true)
  const [minRegionArea, setMinRegionArea] = useState<number>(20)
  const [showDetectedLines, setShowDetectedLines] = useState<boolean>(true)
  const [bridgeToolActive, setBridgeToolActive] = useState<boolean>(false)
  const [manualBridges, setManualBridges] = useState<[number, number][][]>([])
  const [isDrawingBridge, setIsDrawingBridge] = useState<boolean>(false)
  const [activeBridgeStroke, setActiveBridgeStroke] = useState<[number, number][]>([])
  const [borderCanvas, setBorderCanvas] = useState<HTMLCanvasElement | null>(null)
  const [detectedPointsCount, setDetectedPointsCount] = useState<number>(0)
  const cachedImageDataRef = useRef<ImageData | null>(null)
  const cachedCountryMaskRef = useRef<{
    countryId: string
    mask: Uint8Array
    gridW: number
    gridH: number
  } | null>(null)

  // Overlay option
  const [keepOverlayOnMap, setKeepOverlayOnMap] = useState<boolean>(true)

  // Extraction results
  const [extractedRegions, setExtractedRegions] = useState<ExtractedRegion[]>([])
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<'preview' | 'regions'>('preview')
  const [pasteModalOpen, setPasteModalOpen] = useState<boolean>(false)
  const [pasteText, setPasteText] = useState<string>('')

  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Sync initial country
  useEffect(() => {
    if (initialCountryId) {
      setSelectedCountryId(initialCountryId)
      cachedCountryMaskRef.current = null
    }
  }, [initialCountryId])

  // Load image file into HTMLImageElement
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    loadImageFromFile(file)
  }

  const loadImageFromFile = (file: File) => {
    setImageFile(file)
    cachedImageDataRef.current = null
    const reader = new FileReader()
    reader.onload = (event) => {
      const url = event.target?.result as string
      setImageDataUrl(url)
      const img = new Image()
      img.onload = () => {
        cachedImageDataRef.current = null
        setImageElement(img)
      }
      img.src = url
    }
    reader.readAsDataURL(file)
  }

  // Handle Drag & Drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) {
      loadImageFromFile(file)
    }
  }

  const currentCountry = countries.find((c) => c.properties?.id === selectedCountryId)

  // Live boundary points detection with debouncing and instant raster mask
  useEffect(() => {
    if (!isOpen || !currentCountry || !imageElement) {
      setBorderCanvas(null)
      setDetectedPointsCount(0)
      return
    }

    const timer = setTimeout(() => {
      try {
        const maskObj =
          cachedCountryMaskRef.current?.countryId === currentCountry.properties?.id
            ? cachedCountryMaskRef.current
            : null

        const result = detectBorderGridPoints({
          countryFeature: currentCountry,
          imageElement,
          scaleX,
          scaleY,
          offsetX,
          offsetY,
          threshold,
          excludeRivers,
          cachedImageData: cachedImageDataRef.current,
          cachedCountryMask: maskObj ? maskObj.mask : null,
          manualBridges,
        })

        if (result.imageData && !cachedImageDataRef.current) {
          cachedImageDataRef.current = result.imageData
        }

        if (result.countryMask && (!maskObj || maskObj.countryId !== currentCountry.properties?.id)) {
          const [minX, minY, maxX, maxY] = turf.bbox(currentCountry)
          cachedCountryMaskRef.current = {
            countryId: currentCountry.properties?.id || '',
            mask: result.countryMask,
            gridW: Math.max(10, Math.ceil(maxX - minX)),
            gridH: Math.max(10, Math.ceil(maxY - minY)),
          }
        }

        setBorderCanvas(result.borderCanvas)
        setDetectedPointsCount(result.detectedCount)
      } catch (err) {
        console.warn('Border detection preview error:', err)
      }
    }, 16)

    return () => clearTimeout(timer)
  }, [
    isOpen,
    currentCountry,
    imageElement,
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    threshold,
    excludeRivers,
    manualBridges,
  ])

  // Canvas mouse handlers for manual bridges
  const getCanvasWorldCoords = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] | null => {
    const canvas = canvasRef.current
    if (!canvas || !currentCountry) return null
    const rect = canvas.getBoundingClientRect()
    const clientX = e.clientX - rect.left
    const clientY = e.clientY - rect.top

    const [minX, minY, maxX, maxY] = turf.bbox(currentCountry)
    const cW = Math.max(1, maxX - minX)
    const cH = Math.max(1, maxY - minY)
    const pad = 20
    const scaleFactor = Math.min((canvas.width - pad * 2) / cW, (canvas.height - pad * 2) / cH)

    const cssScaleX = canvas.width / rect.width
    const cssScaleY = canvas.height / rect.height

    const canvasX = clientX * cssScaleX
    const canvasY = clientY * cssScaleY

    const wx = minX + (canvasX - pad) / scaleFactor
    const wy = minY + (canvasY - pad) / scaleFactor

    return [wx, wy]
  }

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!bridgeToolActive) return
    const pt = getCanvasWorldCoords(e)
    if (!pt) return
    setIsDrawingBridge(true)
    setActiveBridgeStroke([pt])
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!bridgeToolActive || !isDrawingBridge) return
    const pt = getCanvasWorldCoords(e)
    if (!pt) return
    setActiveBridgeStroke((prev) => [...prev, pt])
  }

  const handleCanvasMouseUp = () => {
    if (!bridgeToolActive || !isDrawingBridge) return
    setIsDrawingBridge(false)
    if (activeBridgeStroke.length >= 2) {
      setManualBridges((prev) => [...prev, activeBridgeStroke])
    }
    setActiveBridgeStroke([])
  }

  // Render composite preview onto Canvas
  useEffect(() => {
    if (!isOpen || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (!currentCountry) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (imageElement) {
        const scale = Math.min(
          (canvas.width - 40) / imageElement.width,
          (canvas.height - 40) / imageElement.height,
        )
        const dw = imageElement.width * scale
        const dh = imageElement.height * scale
        const dx = (canvas.width - dw) / 2
        const dy = (canvas.height - dh) / 2
        ctx.globalAlpha = opacity
        ctx.drawImage(imageElement, dx, dy, dw, dh)
        ctx.globalAlpha = 1.0
      }
      return
    }

    const [minX, minY, maxX, maxY] = turf.bbox(currentCountry)
    const cW = Math.max(1, maxX - minX)
    const cH = Math.max(1, maxY - minY)

    // Canvas size with padding
    const pad = 20
    const viewW = canvas.width
    const viewH = canvas.height
    ctx.clearRect(0, 0, viewW, viewH)

    // Background ocean / dark canvas
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, viewW, viewH)

    // Transform from world to canvas
    const scaleFactor = Math.min((viewW - pad * 2) / cW, (viewH - pad * 2) / cH)
    const toCanvasX = (wx: number) => pad + (wx - minX) * scaleFactor
    const toCanvasY = (wy: number) => pad + (wy - minY) * scaleFactor

    // 1. Draw aligned photo if available
    if (imageElement) {
      ctx.save()
      ctx.globalAlpha = opacity

      // Image dest rect
      const imgDestX = toCanvasX(minX + offsetX)
      const imgDestY = toCanvasY(minY + offsetY)
      const imgDestW = cW * scaleFactor * scaleX
      const imgDestH = cH * scaleFactor * scaleY

      ctx.drawImage(imageElement, imgDestX, imgDestY, imgDestW, imgDestH)
      ctx.restore()
    }

    // 1.5 Draw live detected boundary lines in neon cyan
    if (showDetectedLines && borderCanvas) {
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(
        borderCanvas,
        toCanvasX(minX),
        toCanvasY(minY),
        cW * scaleFactor,
        cH * scaleFactor,
      )
      ctx.restore()
    }

    // 1.6 Draw manual user bridge strokes in rose-red
    if (manualBridges.length > 0) {
      ctx.strokeStyle = '#f43f5e'
      ctx.lineWidth = 3.0
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const stroke of manualBridges) {
        ctx.beginPath()
        stroke.forEach(([wx, wy], idx) => {
          const cx = toCanvasX(wx)
          const cy = toCanvasY(wy)
          if (idx === 0) ctx.moveTo(cx, cy)
          else ctx.lineTo(cx, cy)
        })
        ctx.stroke()
      }
    }

    // 1.7 Draw active bridge stroke being drawn in gold
    if (activeBridgeStroke.length > 1) {
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 3.0
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      activeBridgeStroke.forEach(([wx, wy], idx) => {
        const cx = toCanvasX(wx)
        const cy = toCanvasY(wy)
        if (idx === 0) ctx.moveTo(cx, cy)
        else ctx.lineTo(cx, cy)
      })
      ctx.stroke()
    }

    // 2. Draw extracted regions if any
    if (extractedRegions.length > 0) {
      const colors = ['#38bdf8', '#fbbf24', '#34d399', '#f87171', '#a78bfa', '#fb923c']
      extractedRegions.forEach((reg, idx) => {
        ctx.fillStyle = colors[idx % colors.length] + '44' // semi-transparent
        ctx.strokeStyle = colors[idx % colors.length]
        ctx.lineWidth = 1.8

        const geom = reg.geometry
        const rings =
          geom.type === 'Polygon'
            ? geom.coordinates
            : geom.coordinates.flatMap((p) => p)

        rings.forEach((ring) => {
          ctx.beginPath()
          ring.forEach(([wx, wy], rIdx) => {
            const cx = toCanvasX(wx)
            const cy = toCanvasY(wy)
            if (rIdx === 0) ctx.moveTo(cx, cy)
            else ctx.lineTo(cx, cy)
          })
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
        })
      })
    }

    // 3. Draw outer country border for clear alignment
    ctx.strokeStyle = '#f8fafc'
    ctx.lineWidth = 2.0
    ctx.shadowColor = '#000000'
    ctx.shadowBlur = 4

    const countryGeom = currentCountry.geometry
    const countryRings =
      countryGeom.type === 'Polygon'
        ? countryGeom.coordinates
        : countryGeom.coordinates.flatMap((p) => p)

    countryRings.forEach((ring) => {
      ctx.beginPath()
      ring.forEach(([wx, wy], rIdx) => {
        const cx = toCanvasX(wx)
        const cy = toCanvasY(wy)
        if (rIdx === 0) ctx.moveTo(cx, cy)
        else ctx.lineTo(cx, cy)
      })
      ctx.closePath()
      ctx.stroke()
    })
  }, [
    isOpen,
    currentCountry,
    imageElement,
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    opacity,
    extractedRegions,
    showDetectedLines,
    borderCanvas,
    manualBridges,
    activeBridgeStroke,
  ])

  // Run automatic extraction
  const handleRunExtraction = () => {
    if (!currentCountry || !imageElement) return
    setIsProcessing(true)

    // Small timeout to allow spinner to display
    setTimeout(() => {
      try {
        const result = extractRegionsFromImage({
          countryFeature: currentCountry,
          countryId: selectedCountryId,
          imageElement,
          scaleX,
          scaleY,
          offsetX,
          offsetY,
          threshold,
          excludeRivers,
          minRegionArea,
          manualBridges,
        })

        if (result.regions.length > 0) {
          // If this is Hisolia, populate known preset names automatically!
          let finalRegions = result.regions
          if (selectedCountryId === 'country-007') {
            finalRegions = result.regions.map((r, i) => ({
              ...r,
              name: HISOLIA_PRESET_NAMES[i] || r.name,
              isCapital: i === 2 || i === 4, // Buitten and Hull city
            }))
          }
          setExtractedRegions(finalRegions)
          setActiveTab('regions')
        }
      } finally {
        setIsProcessing(false)
      }
    }, 50)
  }

  // Apply regions to map
  const handleApply = () => {
    if (!currentCountry || extractedRegions.length === 0) return

    const newFeatures: Feature<Polygon | MultiPolygon>[] = extractedRegions.map((reg) => ({
      type: 'Feature',
      id: reg.id,
      geometry: reg.geometry,
      properties: {
        id: reg.id,
        number: reg.number,
        name: reg.name,
        type: 'region',
        countryId: selectedCountryId,
        isCapital: reg.isCapital,
        labelRank: reg.isCapital ? 2 : 1,
        styleIndex: reg.colorIndex,
        areaWorld: reg.areaPx,
      },
    }))

    let overlayData: StudioMapOverlay | null = null
    if (keepOverlayOnMap && imageDataUrl && currentCountry) {
      const [minX, minY, maxX, maxY] = turf.bbox(currentCountry)
      const cW = maxX - minX
      const cH = maxY - minY
      const bMinX = minX + offsetX
      const bMinY = minY + offsetY
      const bMaxX = bMinX + cW * scaleX
      const bMaxY = bMinY + cH * scaleY
      overlayData = {
        imageUrl: imageDataUrl,
        bounds: [Math.round(bMinX), Math.round(bMinY), Math.round(bMaxX), Math.round(bMaxY)],
        opacity,
        locked: true,
      }
    }

    onApplyRegions(selectedCountryId, newFeatures, overlayData)
    onClose()
  }

  // Apply map overlay only without modifying existing regions
  const handleApplyOverlayOnly = () => {
    if (!imageDataUrl) return
    let bMinX: number, bMinY: number, bMaxX: number, bMaxY: number
    if (currentCountry) {
      const [minX, minY, maxX, maxY] = turf.bbox(currentCountry)
      const cW = maxX - minX
      const cH = maxY - minY
      bMinX = minX + offsetX
      bMinY = minY + offsetY
      bMaxX = bMinX + cW * scaleX
      bMaxY = bMinY + cH * scaleY
    } else {
      // Default to center of world
      bMinX = 700
      bMinY = 350
      bMaxX = 1200
      bMaxY = 750
    }
    const overlayData: StudioMapOverlay = {
      imageUrl: imageDataUrl,
      bounds: [Math.round(bMinX), Math.round(bMinY), Math.round(bMaxX), Math.round(bMaxY)],
      opacity,
      locked: false, // Start unlocked so user can freely position and scale it
    }
    onSetMapOverlay?.(overlayData)
    onClose()
  }

  // Bulk paste region names
  const handleApplyPastedNames = () => {
    const lines = pasteText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    if (lines.length > 0) {
      setExtractedRegions((prev) =>
        prev.map((reg, idx) => ({
          ...reg,
          name: lines[idx] || reg.name,
        })),
      )
    }
    setPasteModalOpen(false)
  }

  if (!isOpen) return null

  return (
    <div className="studio-modal-backdrop" role="dialog" aria-modal="true">
      <div className="studio-modal studio-modal--photo-import">
        <header className="studio-modal__header">
          <div className="studio-modal__title-group">
            <h3>📷 Импорт регионов из фотографии</h3>
            <span className="studio-modal__subtitle">
              Автоматическое распознавание границ и нарезка карты по изображению
            </span>
          </div>
          <button type="button" className="studio-modal__close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="studio-photo-modal-body">
          {/* Left panel: Controls */}
          <div className="studio-photo-controls">
            {/* 1. Country Selection */}
            <div className="studio-field">
              <label htmlFor="import-country-select">
                <strong>1. Государство для импорта:</strong>
              </label>
              <select
                id="import-country-select"
                value={selectedCountryId}
                onChange={(e) => {
                  setSelectedCountryId(e.target.value)
                  setExtractedRegions([])
                }}
                className="studio-input"
              >
                <option value="__free__">
                  🗺️ Свободная подложка (любое место на карте)
                </option>
                {countries.map((c) => (
                  <option key={c.properties?.id} value={c.properties?.id}>
                    {c.properties?.name || c.properties?.id} ({c.properties?.id})
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Photo Upload */}
            <div className="studio-field">
              <label>
                <strong>2. Фотография карты регионов:</strong>
              </label>
              <div
                className="studio-dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  id="photo-upload-input"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <label htmlFor="photo-upload-input" className="studio-dropzone__label">
                  <span className="studio-dropzone__icon">📁</span>
                  <span>{imageFile ? imageFile.name : 'Перетащите фото сюда или выберите файл'}</span>
                  <span className="studio-dropzone__hint">Поддерживаются JPG, PNG, WebP</span>
                </label>
              </div>
            </div>

            {/* Free Overlay instructions when no country selected */}
            {imageElement && !currentCountry && (
              <div
                className="studio-control-group"
                style={{
                  padding: '12px',
                  background: 'rgba(56, 189, 248, 0.06)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: '8px',
                }}
              >
                <p style={{ margin: 0, fontSize: '12px', color: '#cbd5e1', lineHeight: 1.5 }}>
                  🗺️ <strong>Свободный режим подложки:</strong>
                  <br />
                  Фотография будет добавлена прямо на карту мира. Вы сможете перемещать её мышкой в любую точку планеты, масштабировать за углы и закрепить кнопкой <strong>📌 Закрепить</strong>.
                </p>
                <button
                  type="button"
                  className="studio-btn"
                  onClick={handleApplyOverlayOnly}
                  style={{
                    width: '100%',
                    marginTop: '12px',
                    background: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
                    borderColor: '#38bdf8',
                    color: '#ffffff',
                    fontWeight: 600,
                  }}
                >
                  🖼️ Разместить на карте мира
                </button>
              </div>
            )}

            {/* 3. Alignment controls when country is selected */}
            {imageElement && currentCountry && (
              <div className="studio-control-group">
                <div className="studio-group-title">
                  <span>🎯 Совмещение с контуром страны</span>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <button
                      type="button"
                      className={`studio-btn-tiny ${lockAspect ? 'studio-btn-tiny--accent' : ''}`}
                      onClick={() => setLockAspect(!lockAspect)}
                      title={lockAspect ? 'Пропорции X и Y связаны' : 'Раздельное растяжение по X и Y'}
                    >
                      {lockAspect ? '🔗 Связано' : '🔓 Раздельно'}
                    </button>
                    <button
                      type="button"
                      className="studio-btn-tiny"
                      onClick={() => {
                        setScaleX(1.0)
                        setScaleY(1.0)
                        setOffsetX(0)
                        setOffsetY(0)
                        setOpacity(0.7)
                      }}
                    >
                      Сбросить
                    </button>
                  </div>
                </div>

                {/* Stretch X */}
                <div className="studio-slider-row">
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Растяжение X (ширина): <strong>{Math.round(scaleX * 100)}%</strong></span>
                    <span style={{ display: 'flex', gap: '3px' }}>
                      <button
                        type="button"
                        className="studio-btn-tiny"
                        style={{ padding: '0 4px', height: '17px', lineHeight: '17px', fontSize: '10px' }}
                        onClick={() => {
                          const val = Math.max(0.2, Number((scaleX - 0.02).toFixed(2)))
                          setScaleX(val)
                          if (lockAspect) setScaleY(val)
                        }}
                      >
                        -2%
                      </button>
                      <button
                        type="button"
                        className="studio-btn-tiny"
                        style={{ padding: '0 4px', height: '17px', lineHeight: '17px', fontSize: '10px' }}
                        onClick={() => {
                          const val = Math.min(3.5, Number((scaleX + 0.02).toFixed(2)))
                          setScaleX(val)
                          if (lockAspect) setScaleY(val)
                        }}
                      >
                        +2%
                      </button>
                    </span>
                  </label>
                  <input
                    type="range"
                    min="0.3"
                    max="3.5"
                    step="0.01"
                    value={scaleX}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setScaleX(val)
                      if (lockAspect) setScaleY(val)
                    }}
                  />
                </div>

                {/* Stretch Y */}
                <div className="studio-slider-row">
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Растяжение Y (высота): <strong>{Math.round(scaleY * 100)}%</strong></span>
                    <span style={{ display: 'flex', gap: '3px' }}>
                      <button
                        type="button"
                        className="studio-btn-tiny"
                        style={{ padding: '0 4px', height: '17px', lineHeight: '17px', fontSize: '10px' }}
                        onClick={() => {
                          const val = Math.max(0.2, Number((scaleY - 0.02).toFixed(2)))
                          setScaleY(val)
                          if (lockAspect) setScaleX(val)
                        }}
                      >
                        -2%
                      </button>
                      <button
                        type="button"
                        className="studio-btn-tiny"
                        style={{ padding: '0 4px', height: '17px', lineHeight: '17px', fontSize: '10px' }}
                        onClick={() => {
                          const val = Math.min(3.5, Number((scaleY + 0.02).toFixed(2)))
                          setScaleY(val)
                          if (lockAspect) setScaleX(val)
                        }}
                      >
                        +2%
                      </button>
                    </span>
                  </label>
                  <input
                    type="range"
                    min="0.3"
                    max="3.5"
                    step="0.01"
                    value={scaleY}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value)
                      setScaleY(val)
                      if (lockAspect) setScaleX(val)
                    }}
                  />
                </div>

                {/* Offset X */}
                <div className="studio-slider-row">
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Смещение X: <strong>{offsetX}px</strong></span>
                    <span style={{ display: 'flex', gap: '3px' }}>
                      <button
                        type="button"
                        className="studio-btn-tiny"
                        style={{ padding: '0 4px', height: '17px', lineHeight: '17px', fontSize: '10px' }}
                        onClick={() => setOffsetX((v) => v - 1)}
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        className="studio-btn-tiny"
                        style={{ padding: '0 4px', height: '17px', lineHeight: '17px', fontSize: '10px' }}
                        onClick={() => setOffsetX((v) => v + 1)}
                      >
                        +1
                      </button>
                    </span>
                  </label>
                  <input
                    type="range"
                    min="-300"
                    max="300"
                    step="1"
                    value={offsetX}
                    onChange={(e) => setOffsetX(parseInt(e.target.value, 10))}
                  />
                </div>

                {/* Offset Y */}
                <div className="studio-slider-row">
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Смещение Y: <strong>{offsetY}px</strong></span>
                    <span style={{ display: 'flex', gap: '3px' }}>
                      <button
                        type="button"
                        className="studio-btn-tiny"
                        style={{ padding: '0 4px', height: '17px', lineHeight: '17px', fontSize: '10px' }}
                        onClick={() => setOffsetY((v) => v - 1)}
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        className="studio-btn-tiny"
                        style={{ padding: '0 4px', height: '17px', lineHeight: '17px', fontSize: '10px' }}
                        onClick={() => setOffsetY((v) => v + 1)}
                      >
                        +1
                      </button>
                    </span>
                  </label>
                  <input
                    type="range"
                    min="-300"
                    max="300"
                    step="1"
                    value={offsetY}
                    onChange={(e) => setOffsetY(parseInt(e.target.value, 10))}
                  />
                </div>

                {/* Opacity */}
                <div className="studio-slider-row">
                  <label>Прозрачность: {Math.round(opacity * 100)}%</label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={opacity}
                    onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  />
                </div>
              </div>
            )}

            {/* 4. Extraction settings */}
            {imageElement && (
              <div className="studio-control-group">
                <div className="studio-group-title">
                  <span>⚙️ Параметры распознавания</span>
                </div>

                <div className="studio-slider-row">
                  <label>Чувствительность линий: {threshold}</label>
                  <input
                    type="range"
                    min="25"
                    max="135"
                    step="2"
                    value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
                  />
                </div>

                <label className="studio-checkbox-label" style={{ marginTop: '4px' }}>
                  <input
                    type="checkbox"
                    checked={showDetectedLines}
                    onChange={(e) => setShowDetectedLines(e.target.checked)}
                  />
                  <span>⚡ Подсвечивать найденные границы (неон)</span>
                </label>

                <label className="studio-checkbox-label" style={{ marginTop: '4px' }}>
                  <input
                    type="checkbox"
                    checked={excludeRivers}
                    onChange={(e) => setExcludeRivers(e.target.checked)}
                  />
                  <span>Игнорировать голубые реки</span>
                </label>

                <div className="studio-slider-row" style={{ marginTop: '6px' }}>
                  <label>Мин. размер региона: {minRegionArea}px</label>
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={minRegionArea}
                    onChange={(e) => setMinRegionArea(parseInt(e.target.value, 10))}
                  />
                </div>

                {/* Manual bridge tool */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                  <button
                    type="button"
                    className={`studio-btn-tiny ${bridgeToolActive ? 'studio-btn-tiny--accent' : ''}`}
                    style={{ flex: 1, padding: '4px 6px' }}
                    onClick={() => setBridgeToolActive(!bridgeToolActive)}
                    title="Зажмите мышь на предпросмотре и проведите линию, чтобы соединить разорванную границу"
                  >
                    {bridgeToolActive ? '✏️ Перемычка (активна)' : '✏️ Провести перемычку'}
                  </button>
                  {manualBridges.length > 0 && (
                    <button
                      type="button"
                      className="studio-btn-tiny"
                      onClick={() => setManualBridges([])}
                      title="Удалить все нарисованные вручную перемычки"
                    >
                      🧹 Сбросить ({manualBridges.length})
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  className="studio-btn studio-btn--primary"
                  style={{ width: '100%', marginTop: '12px' }}
                  onClick={handleRunExtraction}
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Распознавание...' : '⚡ Распознать и нарезать регионы'}
                </button>
              </div>
            )}

            {/* Option to keep photo as map overlay */}
            {imageElement && (
              <label className="studio-checkbox-label" style={{ marginTop: '8px' }}>
                <input
                  type="checkbox"
                  checked={keepOverlayOnMap}
                  onChange={(e) => setKeepOverlayOnMap(e.target.checked)}
                />
                <span>Оставить полупрозрачную подложку на карте</span>
              </label>
            )}
          </div>

          {/* Right panel: Live Preview & Region Table */}
          <div className="studio-photo-preview-pane">
            <div className="studio-tabs">
              <button
                type="button"
                className={`studio-tab-btn ${activeTab === 'preview' ? 'studio-tab-btn--active' : ''}`}
                onClick={() => setActiveTab('preview')}
              >
                🗺️ Предпросмотр совмещения
              </button>
              <button
                type="button"
                className={`studio-tab-btn ${activeTab === 'regions' ? 'studio-tab-btn--active' : ''}`}
                onClick={() => setActiveTab('regions')}
                disabled={extractedRegions.length === 0}
              >
                📋 Список регионов ({extractedRegions.length})
              </button>
            </div>

            {/* Tab 1: Canvas Preview */}
            {activeTab === 'preview' && (
              <div className="studio-canvas-container">
                <canvas
                  ref={canvasRef}
                  width={560}
                  height={440}
                  className="studio-photo-preview-canvas"
                  style={{ cursor: bridgeToolActive ? 'crosshair' : 'default' }}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                />
                <div className="studio-canvas-legend">
                  <span className="legend-item">
                    <span className="legend-dot legend-dot--white" /> Белый — граница страны
                  </span>
                  {showDetectedLines && (
                    <span className="legend-item">
                      <span className="legend-dot legend-dot--cyan" /> Неон — найденные границы ({detectedPointsCount})
                    </span>
                  )}
                  {manualBridges.length > 0 && (
                    <span className="legend-item">
                      <span className="legend-dot" style={{ background: '#f43f5e' }} /> Красный — перемычки
                    </span>
                  )}
                  {extractedRegions.length > 0 && (
                    <span className="legend-item">
                      <span className="legend-dot" style={{ background: '#fbbf24' }} /> Цвета — регионы
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Tab 2: Region Table */}
            {activeTab === 'regions' && (
              <div className="studio-region-table-container">
                <div className="studio-table-actions">
                  {selectedCountryId === 'country-007' && (
                    <button
                      type="button"
                      className="studio-btn-tiny studio-btn-tiny--accent"
                      onClick={() => {
                        setExtractedRegions((prev) =>
                          prev.map((r, i) => ({
                            ...r,
                            name: HISOLIA_PRESET_NAMES[i] || r.name,
                            isCapital: i === 2 || i === 4,
                          })),
                        )
                      }}
                    >
                      ⚡ Заполнить названия Хисолии
                    </button>
                  )}
                  <button
                    type="button"
                    className="studio-btn-tiny"
                    onClick={() => setPasteModalOpen(true)}
                  >
                    📋 Вставить список названий
                  </button>
                </div>

                <div className="studio-region-list-scroll">
                  <table className="studio-region-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        <th>Название региона</th>
                        <th style={{ width: '80px', textAlign: 'center' }}>Столица</th>
                        <th style={{ width: '80px', textAlign: 'right' }}>Площадь</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extractedRegions.map((reg, idx) => (
                        <tr key={reg.id}>
                          <td>
                            <span
                              className="studio-reg-color-dot"
                              style={{
                                backgroundColor: [
                                  '#38bdf8',
                                  '#fbbf24',
                                  '#34d399',
                                  '#f87171',
                                  '#a78bfa',
                                  '#fb923c',
                                ][idx % 6],
                              }}
                            />
                            {reg.number}
                          </td>
                          <td>
                            <input
                              type="text"
                              className="studio-input studio-input--sm"
                              value={reg.name}
                              onChange={(e) => {
                                const newName = e.target.value
                                setExtractedRegions((prev) =>
                                  prev.map((r) => (r.id === reg.id ? { ...r, name: newName } : r)),
                                )
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={reg.isCapital}
                              onChange={(e) => {
                                const isCap = e.target.checked
                                setExtractedRegions((prev) =>
                                  prev.map((r) =>
                                    r.id === reg.id ? { ...r, isCapital: isCap } : r,
                                  ),
                                )
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right', fontSize: '11px', color: 'var(--ui-muted)' }}>
                            {Math.round(reg.areaPx / 1000)}k
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal footer */}
        <footer className="studio-modal__footer">
          <button type="button" className="studio-btn studio-btn--secondary" onClick={onClose}>
            Отмена
          </button>
          {imageElement && (
            <button
              type="button"
              className="studio-btn"
              onClick={handleApplyOverlayOnly}
              title="Разместить фотографию на карте с возможностью свободного перемещения мышкой и фиксации"
              style={{
                background: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
                borderColor: '#38bdf8',
                color: '#ffffff',
                fontWeight: 600,
              }}
            >
              🖼️ Разместить на карте (свободное перемещение)
            </button>
          )}
          <button
            type="button"
            className="studio-btn studio-btn--primary"
            onClick={handleApply}
            disabled={extractedRegions.length === 0}
          >
            💾 Применить на карту ({extractedRegions.length} регионов)
          </button>
        </footer>

        {/* Quick paste modal */}
        {pasteModalOpen && (
          <div className="studio-paste-modal-backdrop">
            <div className="studio-paste-modal">
              <h4>Вставить список названий (по строкам)</h4>
              <p>Каждая новая строка станет названием следующего региона по порядку:</p>
              <textarea
                className="studio-textarea"
                rows={8}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'Биг Йорд\nСеверный Урих\nЮго-Западный Асмаин\n...'}
              />
              <div className="studio-paste-modal__actions">
                <button
                  type="button"
                  className="studio-btn studio-btn--secondary"
                  onClick={() => setPasteModalOpen(false)}
                >
                  Отмена
                </button>
                <button
                  type="button"
                  className="studio-btn studio-btn--primary"
                  onClick={handleApplyPastedNames}
                >
                  Применить названия
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
