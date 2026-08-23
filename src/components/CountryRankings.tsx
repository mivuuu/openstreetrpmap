import { useEffect, useId, useRef, useState } from 'react'
import { COUNTRY_RANKINGS } from '../data/countryRankings'

export function CountryRankings() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeRankingId, setActiveRankingId] = useState(COUNTRY_RANKINGS[0].id)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const activeRanking = COUNTRY_RANKINGS.find(({ id }) => id === activeRankingId)
    ?? COUNTRY_RANKINGS[0]

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
    <div ref={controlRef} className="rankings-control">
      {isOpen && (
        <aside id={panelId} className="rankings-panel" aria-label="Рейтинги стран">
          <header className="rankings-panel__header">
            <div>
              <span className="rankings-panel__eyebrow">Мировая статистика</span>
              <h2>Рейтинги стран</h2>
            </div>
            <button
              type="button"
              className="rankings-panel__close"
              aria-label="Закрыть рейтинги"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
          </header>

          <label className="rankings-panel__selector">
            <span>Показатель</span>
            <select
              value={activeRanking.id}
              onChange={(event) => setActiveRankingId(event.target.value)}
            >
              {COUNTRY_RANKINGS.map((ranking) => (
                <option key={ranking.id} value={ranking.id}>{ranking.label}</option>
              ))}
            </select>
          </label>

          <div className="rankings-panel__list-wrap">
            <ol className="rankings-list" aria-label={activeRanking.label}>
              {activeRanking.entries.map((entry, index) => (
                <li key={`${activeRanking.id}-${entry.rank}-${entry.country}-${index}`}>
                  <span className="rankings-list__rank" aria-label={`${entry.rank} место`}>
                    {entry.rank}
                  </span>
                  <span className="rankings-list__country">{entry.country}</span>
                  {entry.value && <span className="rankings-list__value">{entry.value}</span>}
                </li>
              ))}
            </ol>
          </div>
        </aside>
      )}

      <button
        ref={buttonRef}
        type="button"
        className={`rankings-control__button${isOpen ? ' rankings-control__button--active' : ''}`}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="rankings-control__icon" aria-hidden="true">★</span>
        <span>Рейтинги</span>
      </button>
    </div>
  )
}
