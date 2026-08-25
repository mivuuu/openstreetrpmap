import { useEffect, useId, useRef, useState } from 'react'
import {
  BASE_MAP_MODE_LABELS,
  BASE_MAP_MODES,
  type BaseMapMode,
} from '../map/baseMapMode'
import { LayersIcon } from './UiIcons'
import { usePresence } from './usePresence'

type BaseMapModeControlProps = {
  mode: BaseMapMode
  extractionDebug: boolean
  onModeChange: (mode: BaseMapMode) => void
  onExtractionDebugChange: (enabled: boolean) => void
  countryIds: boolean
  onCountryIdsChange: (enabled: boolean) => void
  countryLabelPoints: boolean
  onCountryLabelPointsChange: (enabled: boolean) => void
  development?: boolean
}

export function BaseMapModeControl({
  mode,
  extractionDebug,
  onModeChange,
  onExtractionDebugChange,
  countryIds,
  onCountryIdsChange,
  countryLabelPoints,
  onCountryLabelPointsChange,
  development = false,
}: BaseMapModeControlProps) {
  const [isOpen, setIsOpen] = useState(false)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const menuPresence = usePresence(isOpen, 180)
  const visibleModes = development
    ? BASE_MAP_MODES
    : BASE_MAP_MODES.filter((option) => option !== 'land' && option !== 'landOverlay')

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      buttonRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={controlRef} className="layers-control">
      <button
        ref={buttonRef}
        type="button"
        className={`layers-control__button${isOpen ? ' layers-control__button--active' : ''}`}
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <LayersIcon className="ui-icon" />
        <span>Слои</span>
      </button>

      {menuPresence.isMounted && (
        <aside
          id={menuId}
          className="layers-menu"
          aria-label="Слои карты"
          aria-hidden={!isOpen}
          data-state={menuPresence.state}
          inert={!isOpen}
        >
          <header className="layers-menu__header">
            <span className="ui-eyebrow">Отображение</span>
            <h2>Слои карты</h2>
            <p>Выберите основу и служебные обозначения.</p>
          </header>
          <span className="layers-menu__section-title">Вид карты</span>
          <div className="layers-menu__options">
            {visibleModes.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="base-map-mode"
                  value={option}
                  checked={mode === option}
                  onChange={() => onModeChange(option)}
                />
                <span>{BASE_MAP_MODE_LABELS[option]}</span>
              </label>
            ))}
          </div>
          <div className="layers-menu__technical">
            <span className="layers-menu__section-title">Служебные данные</span>
            <label>
              <input
                type="checkbox"
                checked={extractionDebug}
                onChange={(event) => onExtractionDebugChange(event.target.checked)}
              />
              <span>Маска выравнивания</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={countryIds}
                onChange={(event) => onCountryIdsChange(event.target.checked)}
              />
              <span>ID стран</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={countryLabelPoints}
                onChange={(event) => onCountryLabelPointsChange(event.target.checked)}
              />
              <span>Точки названий стран</span>
            </label>
          </div>
        </aside>
      )}
    </div>
  )
}
