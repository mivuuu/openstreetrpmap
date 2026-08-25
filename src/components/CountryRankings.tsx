import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { COUNTRY_RANKINGS } from '../data/countryRankings'
import { CloseIcon, RankingsIcon } from './UiIcons'
import { usePresence } from './usePresence'

export function CountryRankings() {
  const [isOpen, setIsOpen] = useState(false)
  const [activeRankingId, setActiveRankingId] = useState(COUNTRY_RANKINGS[0].id)
  const controlRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const panelPresence = usePresence(isOpen, 180)
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
      {panelPresence.isMounted && (
        <aside
          id={panelId}
          className="rankings-panel"
          aria-label="Рейтинги стран"
          aria-hidden={!isOpen}
          data-state={panelPresence.state}
          inert={!isOpen}
        >
          <header className="rankings-panel__header">
            <div>
              <span className="ui-eyebrow">Мировая статистика</span>
              <h2>Рейтинги стран</h2>
              <p>Сравнение государств по ключевым показателям.</p>
            </div>
            <button
              type="button"
              className="rankings-panel__close"
              aria-label="Закрыть рейтинги"
              onClick={() => {
                setIsOpen(false)
                buttonRef.current?.focus()
              }}
            >
              <CloseIcon className="ui-icon" />
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
                <li
                  key={`${activeRanking.id}-${entry.rank}-${entry.country}-${index}`}
                  className={index < 10 ? 'rankings-list__item--animated' : undefined}
                  style={index < 10
                    ? { '--item-delay': `${index * 18}ms` } as CSSProperties
                    : undefined}
                >
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
        <span className="rankings-control__icon" aria-hidden="true">
          <RankingsIcon className="ui-icon" />
        </span>
        <span>Рейтинги</span>
      </button>
    </div>
  )
}
