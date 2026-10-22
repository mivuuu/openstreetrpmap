import { useEffect, useState } from 'react'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { getPlanarArea } from './geometryOperations'
import { MAP_THEME } from '../map/mapTheme'

type Props = {
  isOpen: boolean
  onClose: () => void
  territory: Feature<Polygon | MultiPolygon> | null
  sourceCountryName: string | null
  suggestedId: string
  suggestedColorIndex: number
  onConfirm: (options: {
    countryName: string
    themeColorIndex: number
    createCapitalRegion: boolean
  }) => void
}

export function StudioCreateCountryModal({
  isOpen,
  onClose,
  territory,
  sourceCountryName,
  suggestedId,
  suggestedColorIndex,
  onConfirm,
}: Props) {
  const [countryName, setCountryName] = useState('')
  const [selectedColorIndex, setSelectedColorIndex] = useState(suggestedColorIndex)
  const [createCapitalRegion, setCreateCapitalRegion] = useState(true)

  useEffect(() => {
    if (isOpen) {
      setCountryName('')
      setSelectedColorIndex(suggestedColorIndex)
      setCreateCapitalRegion(true)
    }
  }, [isOpen, suggestedColorIndex])

  if (!isOpen || !territory) return null

  const areaApprox = Math.round(getPlanarArea(territory.geometry))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const name = countryName.trim() || 'Новое государство'
    onConfirm({
      countryName: name,
      themeColorIndex: selectedColorIndex,
      createCapitalRegion,
    })
  }

  return (
    <div className="studio-modal-backdrop" onClick={onClose}>
      <div
        className="studio-modal"
        style={{ maxWidth: '520px' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-country-title"
      >
        <div className="studio-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>✨</span>
            <h3 id="create-country-title">Создание нового государства</h3>
          </div>
          <button
            type="button"
            className="studio-modal__close"
            onClick={onClose}
            title="Закрыть окно (Esc)"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="studio-modal__body">
            <p>
              Выделенная территория будет отделена в самостоятельное суверенное государство со
              своими границами, кодом и названием.
            </p>

            <div className="studio-stats" style={{ background: 'rgba(0, 0, 0, 0.35)', padding: '12px' }}>
              <div className="studio-stat-item">
                <span className="studio-stat-item__label">Исходная принадлежность:</span>
                <span className="studio-stat-item__val" style={{ color: sourceCountryName ? '#93c5fd' : '#9ca3af' }}>
                  {sourceCountryName ? `🏛️ ${sourceCountryName}` : '🌊 Ничейная территория'}
                </span>
              </div>
              <div className="studio-stat-item">
                <span className="studio-stat-item__label">Новый ID в системе:</span>
                <span className="studio-code-badge">{suggestedId}</span>
              </div>
              <div className="studio-stat-item">
                <span className="studio-stat-item__label">Площадь территории:</span>
                <span className="studio-stat-item__val">{areaApprox.toLocaleString('ru-RU')} px²</span>
              </div>
            </div>

            <div className="studio-field">
              <label htmlFor="new-country-name-input">
                <strong>Название государства:</strong>
              </label>
              <input
                id="new-country-name-input"
                type="text"
                className="studio-input studio-input--bold"
                placeholder="Например: Урих, Нью-Вэйбелла, Нордландия..."
                value={countryName}
                onChange={(e) => setCountryName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="studio-field">
              <label>
                <strong>Цвет заливки на карте мира:</strong>
              </label>
              <div
                className="studio-palette-picker"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(8, 1fr)',
                  gap: '8px',
                  marginTop: '6px',
                }}
              >
                {MAP_THEME.colors.countryPalette.map((hex, idx) => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setSelectedColorIndex(idx)}
                    title={`Цвет ${idx + 1} (${hex})`}
                    style={{
                      backgroundColor: hex,
                      height: '32px',
                      borderRadius: '6px',
                      border: selectedColorIndex === idx ? '3px solid #38bdf8' : '1px solid rgba(255,255,255,0.2)',
                      boxShadow: selectedColorIndex === idx ? '0 0 10px rgba(56, 189, 248, 0.7)' : 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#000',
                      fontWeight: 'bold',
                      fontSize: '12px',
                    }}
                  >
                    {selectedColorIndex === idx ? '✓' : ''}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: '11px', color: 'var(--ui-muted)', marginTop: '4px' }}>
                По умолчанию подобран цвет, не конфликтующий с соседними странами.
              </span>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                marginTop: '4px',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={createCapitalRegion}
                onChange={(e) => setCreateCapitalRegion(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#38bdf8' }}
              />
              <span>Создать первый регион (столицу) для этого государства</span>
            </label>
          </div>

          <div className="studio-modal__footer">
            <button
              type="button"
              className="studio-btn studio-btn--secondary"
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              type="submit"
              className="studio-btn studio-btn--primary"
              style={{ background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', borderColor: '#34d399' }}
            >
              ✨ Отделить и создать страну
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
