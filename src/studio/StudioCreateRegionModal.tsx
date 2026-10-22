import { useEffect, useState } from 'react'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import { getPlanarArea } from './geometryOperations'
import { transliterateToSlug } from './transliterate'

type Props = {
  isOpen: boolean
  onClose: () => void
  territory: Feature<Polygon | MultiPolygon> | null
  countryId: string
  countryName: string
  existingRegionIds: string[]
  onConfirm: (options: { name: string; id: string; isCapital: boolean }) => void
}

export function StudioCreateRegionModal({
  isOpen,
  onClose,
  territory,
  countryId,
  countryName,
  existingRegionIds,
  onConfirm,
}: Props) {
  const [regionName, setRegionName] = useState('')
  const [slug, setSlug] = useState('')
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false)
  const [isCapital, setIsCapital] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setRegionName('')
      setSlug('')
      setIsSlugManuallyEdited(false)
      setIsCapital(false)

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose()
        }
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen || !territory) return null

  const areaApprox = Math.round(getPlanarArea(territory.geometry))

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setRegionName(newName)
    if (!isSlugManuallyEdited) {
      setSlug(transliterateToSlug(newName))
    }
  }

  const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsSlugManuallyEdited(true)
    setSlug(transliterateToSlug(e.target.value))
  }

  const fullId = slug.trim() ? `${countryId}-${slug.trim()}` : ''
  const isDuplicateId = Boolean(fullId && existingRegionIds.includes(fullId))
  const canSubmit = Boolean(regionName.trim() && slug.trim() && !isDuplicateId)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    onConfirm({
      name: regionName.trim(),
      id: fullId,
      isCapital,
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
        aria-labelledby="create-region-title"
      >
        <div className="studio-modal__header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🗺️</span>
            <h3 id="create-region-title">Создание нового региона</h3>
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
              Новый регион займёт выделенную вами территорию внутри государства. Вся остальная часть страны
              останется нетронутой.
            </p>

            <div className="studio-stats" style={{ background: 'rgba(0, 0, 0, 0.35)', padding: '12px' }}>
              <div className="studio-stat-item">
                <span className="studio-stat-item__label">Государство:</span>
                <span className="studio-stat-item__val" style={{ color: '#93c5fd' }}>
                  🏛️ {countryName} ({countryId})
                </span>
              </div>
              <div className="studio-stat-item">
                <span className="studio-stat-item__label">Площадь контура:</span>
                <span className="studio-stat-item__val">{areaApprox.toLocaleString('ru-RU')} px²</span>
              </div>
            </div>

            <div className="studio-field">
              <label htmlFor="new-region-name-input">
                <strong>Название региона:</strong>
              </label>
              <input
                id="new-region-name-input"
                type="text"
                className="studio-input studio-input--bold"
                placeholder="Например: Иудейская Автономия, Северный Норд..."
                value={regionName}
                onChange={handleNameChange}
                autoFocus
                required
              />
            </div>

            <div className="studio-field">
              <label htmlFor="new-region-slug-input">
                <strong>Идентификатор (ID региона):</strong>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  className="studio-code-badge"
                  style={{
                    padding: '8px 12px',
                    fontSize: '13px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderColor: 'rgba(255, 255, 255, 0.2)',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                  title="Префикс родительской страны фиксирован"
                >
                  {countryId}-
                </span>
                <input
                  id="new-region-slug-input"
                  type="text"
                  className="studio-input"
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    borderColor: isDuplicateId ? '#ef4444' : undefined,
                  }}
                  placeholder="slug-region"
                  value={slug}
                  onChange={handleSlugChange}
                  required
                />
              </div>

              {isDuplicateId ? (
                <span style={{ fontSize: '11px', color: '#f87171', marginTop: '4px' }}>
                  ⚠️ ID «{fullId}» уже занят другим регионом! Пожалуйста, измените его.
                </span>
              ) : (
                <span style={{ fontSize: '11px', color: 'var(--ui-muted)', marginTop: '4px' }}>
                  Формируется автоматически из названия методом транслитерации. Вы можете изменить его вручную.
                </span>
              )}
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
                checked={isCapital}
                onChange={(e) => setIsCapital(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#38bdf8' }}
              />
              <span>⭐ Сделать этот регион столицей страны</span>
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
              disabled={!canSubmit}
              style={{
                background: canSubmit ? 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)' : undefined,
                borderColor: '#38bdf8',
                opacity: canSubmit ? 1 : 0.5,
              }}
            >
              ✨ Создать регион
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
