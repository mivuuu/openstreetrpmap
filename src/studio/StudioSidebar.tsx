import { useState } from 'react'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { StudioMode, StudioTool } from './types'

type Props = {
  mode: StudioMode
  activeTool: StudioTool
  countries: Feature<Polygon | MultiPolygon>[]
  regions: Feature<Polygon | MultiPolygon>[]
  selectedCountryId: string | null
  selectedRegionId: string | null
  fillCountryId: string | null
  onFillCountryChange: (countryId: string) => void
  onSelectCountry: (countryId: string | null) => void
  onSelectRegion: (regionId: string | null) => void
  onCountryNameChange: (countryId: string, newName: string) => void
  onRegionNameChange: (regionId: string, newName: string) => void
  onRegionCapitalToggle: (regionId: string, isCapital: boolean) => void
  onDeleteRegion: (regionId: string) => void
  onStartSlice: () => void
  onStartRedrawBorder: () => void
  onStartMoveLabel: () => void
  onStartCreateCountry?: () => void
}

export function StudioSidebar({
  mode,
  activeTool,
  countries,
  regions,
  selectedCountryId,
  selectedRegionId,
  fillCountryId,
  onFillCountryChange,
  onSelectCountry,
  onSelectRegion,
  onCountryNameChange,
  onRegionNameChange,
  onRegionCapitalToggle,
  onDeleteRegion,
  onStartSlice,
  onStartRedrawBorder,
  onStartMoveLabel,
  onStartCreateCountry,
}: Props) {
  const [search, setSearch] = useState('')

  const activeCountry = countries.find((c) => c.properties?.id === selectedCountryId)
  const activeRegion = regions.find((r) => r.properties?.id === selectedRegionId)
  const countryRegions = regions.filter((r) => r.properties?.countryId === selectedCountryId)

  return (
    <aside className="studio-sidebar" aria-label="Свойства объектов карты">
      {/* Create Country Helper Banner */}
      {activeTool === 'create-country' && (
        <div
          className="studio-sidebar__banner"
          style={{
            borderColor: 'rgba(52, 211, 153, 0.4)',
            background: 'linear-gradient(135deg, rgba(6, 78, 59, 0.3) 0%, rgba(6, 95, 70, 0.15) 100%)',
          }}
        >
          <span className="studio-banner-icon">✨</span>
          <div>
            <strong style={{ color: '#6ee7b7' }}>Создание нового государства</strong>
            <p>
              Кликните по острову или участку суши, либо обведите петлёй лассо территорию на карте, чтобы отделить её в независимое государство.
            </p>
          </div>
        </div>
      )}

      {/* Move Label Helper Banner */}
      {activeTool === 'move-label' && (
        <div className="studio-sidebar__banner studio-sidebar__banner--label">
          <span className="studio-banner-icon">🏷️</span>
          <div>
            <strong>Свободное перемещение названий</strong>
            <p>
              Зажмите круглую синюю метку любого названия на карте и перемещайте её мышкой. Название свободно двигается в пределах границ страны или региона.
            </p>
          </div>
        </div>
      )}

      {/* Lasso Territory Helper Banner */}
      {activeTool === 'redraw-border' && (
        <div className="studio-sidebar__banner studio-sidebar__banner--lasso">
          <span className="studio-banner-icon">🪢</span>
          <div>
            <strong>Лассо территорий</strong>
            <p>
              {mode === 'countries'
                ? 'Обведите петлей лассо любую территорию суши, чтобы передать её выбранному государству.'
                : 'Обведите петлей лассо территорию, чтобы передать её выбранному региону.'}
            </p>
          </div>
        </div>
      )}

      {/* Bucket Fill Helper Banner */}
      {activeTool === 'bucket-fill' && (
        <div className="studio-sidebar__banner studio-sidebar__banner--fill">
          <span className="studio-banner-icon">🪣</span>
          <div>
            <strong>Режим заливки островов</strong>
            <p>Выберите государство ниже и кликайте по островам в океане для их присоединения.</p>
          </div>
          <div className="studio-field" style={{ marginTop: '8px' }}>
            <label htmlFor="sidebar-fill-select">Страна для заливки:</label>
            <select
              id="sidebar-fill-select"
              value={fillCountryId || ''}
              onChange={(e) => onFillCountryChange(e.target.value)}
              className="studio-input"
            >
              {countries.map((c) => (
                <option key={c.properties?.id} value={c.properties?.id}>
                  {c.properties?.name || c.properties?.id}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* 1. COUNTRY EDITING */}
      {mode === 'countries' && activeTool !== 'bucket-fill' && activeTool !== 'move-label' && (
        <div className="studio-panel-content">
          {activeCountry ? (
            <div className="studio-card">
              <div className="studio-nav-header">
                <button
                  type="button"
                  className="studio-back-btn"
                  onClick={() => onSelectCountry(null)}
                  title="Вернуться к полному списку всех стран с поиском"
                >
                  ← Все страны (Поиск)
                </button>
                <span className="studio-code-badge">{activeCountry.properties?.id}</span>
              </div>

              {/* Quick switch to another country directly from dropdown */}
              <div className="studio-field">
                <label htmlFor="country-quick-switch">Переключить страну:</label>
                <select
                  id="country-quick-switch"
                  className="studio-input"
                  value={activeCountry.properties?.id}
                  onChange={(e) => onSelectCountry(e.target.value)}
                >
                  {countries.map((c) => (
                    <option key={c.properties?.id} value={c.properties?.id}>
                      {c.properties?.name || c.properties?.id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="studio-field">
                <label htmlFor="country-name-input">Название государства</label>
                <input
                  id="country-name-input"
                  type="text"
                  className="studio-input studio-input--bold"
                  value={activeCountry.properties?.name || ''}
                  onChange={(e) => onCountryNameChange(activeCountry.properties!.id, e.target.value)}
                  placeholder="Введите название государства..."
                />
              </div>

              <div className="studio-stats">
                <div className="studio-stat-item">
                  <span className="studio-stat-item__label">Количество регионов:</span>
                  <span className="studio-stat-item__val">{countryRegions.length}</span>
                </div>
              </div>

              <div className="studio-card__actions">
                <button
                  type="button"
                  className="studio-btn studio-btn--primary"
                  onClick={onStartRedrawBorder}
                >
                  ✏️ Перерисовать границу
                </button>
                <button
                  type="button"
                  className="studio-btn studio-btn--secondary"
                  onClick={onStartMoveLabel}
                >
                  🏷️ Переместить название
                </button>
                <button
                  type="button"
                  className="studio-btn studio-btn--secondary"
                  onClick={onStartSlice}
                >
                  ✂️ Нарезать регионы страны
                </button>
              </div>

              {countryRegions.length > 0 && (
                <div className="studio-sublist">
                  <h4>Регионы страны ({countryRegions.length}):</h4>
                  <ul className="studio-mini-list">
                    {countryRegions.map((reg) => (
                      <li
                        key={reg.properties?.id}
                        className={`studio-mini-item ${reg.properties?.id === selectedRegionId ? 'studio-mini-item--active' : ''}`}
                        onClick={() => onSelectRegion(reg.properties!.id)}
                      >
                        <span>{reg.properties?.isCapital ? '⭐ ' : ''}{reg.properties?.name || 'Без названия'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="studio-list-view">
              <div className="studio-list-header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <h3 style={{ margin: 0 }}>Все государства ({countries.length})</h3>
                  {onStartCreateCountry && (
                    <button
                      type="button"
                      className="studio-btn studio-btn--primary studio-btn--sm"
                      onClick={onStartCreateCountry}
                      title="Отделить территорию или остров в новое государство"
                      style={{
                        background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                        borderColor: '#34d399',
                        padding: '4px 10px',
                        fontSize: '12px',
                      }}
                    >
                      ➕ Создать
                    </button>
                  )}
                </div>
                <input
                  type="search"
                  className="studio-input studio-input--sm"
                  placeholder="🔍 Поиск страны по названию..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <ul className="studio-objects-list">
                {countries
                  .filter((c) =>
                    !search || (c.properties?.name || '').toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((c) => (
                    <li
                      key={c.properties?.id}
                      className="studio-objects-item"
                      onClick={() => onSelectCountry(c.properties!.id)}
                    >
                      <span className="studio-objects-item__name">
                        {c.properties?.name || 'Без названия'}
                      </span>
                      <span className="studio-objects-item__id">{c.properties?.id}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 2. REGION EDITING */}
      {mode === 'regions' && activeTool !== 'bucket-fill' && activeTool !== 'move-label' && (
        <div className="studio-panel-content">
          {activeRegion ? (
            <div className="studio-card">
              <div className="studio-nav-header">
                <button
                  type="button"
                  className="studio-back-btn"
                  onClick={() => onSelectRegion(null)}
                  title="Вернуться к полному списку всех регионов"
                >
                  ← Все регионы (Поиск)
                </button>
                <span className="studio-code-badge">{activeRegion.properties?.id}</span>
              </div>

              <div className="studio-field">
                <label htmlFor="region-name-input">Название региона</label>
                <input
                  id="region-name-input"
                  type="text"
                  className="studio-input studio-input--bold"
                  value={activeRegion.properties?.name || ''}
                  onChange={(e) => onRegionNameChange(activeRegion.properties!.id, e.target.value)}
                  placeholder="Например: Остерская область"
                />
              </div>

              <div className="studio-field">
                <label className="studio-checkbox-label">
                  <input
                    type="checkbox"
                    checked={Boolean(activeRegion.properties?.isCapital)}
                    onChange={(e) => onRegionCapitalToggle(activeRegion.properties!.id, e.target.checked)}
                  />
                  <span>⭐ Столичный регион (с символом столицы)</span>
                </label>
              </div>

              <div className="studio-stats">
                <div className="studio-stat-item">
                  <span className="studio-stat-item__label">Принадлежит стране:</span>
                  <span className="studio-stat-item__val">
                    {countries.find((c) => c.properties?.id === activeRegion.properties?.countryId)?.properties?.name ||
                      activeRegion.properties?.countryId}
                  </span>
                </div>
              </div>

              <div className="studio-card__actions">
                <button
                  type="button"
                  className="studio-btn studio-btn--primary"
                  onClick={onStartRedrawBorder}
                >
                  ✏️ Перерисовать границу
                </button>
                <button
                  type="button"
                  className="studio-btn studio-btn--secondary"
                  onClick={onStartMoveLabel}
                >
                  🏷️ Переместить название
                </button>
                <button
                  type="button"
                  className="studio-btn studio-btn--danger"
                  onClick={() => onDeleteRegion(activeRegion.properties!.id)}
                >
                  🧹 Удалить этот регион
                </button>
              </div>
            </div>
          ) : (
            <div className="studio-list-view">
              <div className="studio-list-header">
                <h3>
                  {selectedCountryId
                    ? `Регионы страны (${countryRegions.length})`
                    : `Все регионы карты (${regions.length})`}
                </h3>
                <input
                  type="search"
                  className="studio-input studio-input--sm"
                  placeholder="🔍 Поиск региона по названию..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>

              {selectedCountryId && (
                <button
                  type="button"
                  className="studio-btn studio-btn--primary studio-btn--full"
                  onClick={onStartSlice}
                  style={{ marginBottom: '12px' }}
                >
                  ✂️ Нарезать регион от руки
                </button>
              )}

              <ul className="studio-objects-list">
                {(selectedCountryId ? countryRegions : regions)
                  .filter((r) =>
                    !search || (r.properties?.name || '').toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((r) => (
                    <li
                      key={r.properties?.id}
                      className="studio-objects-item"
                      onClick={() => onSelectRegion(r.properties!.id)}
                    >
                      <span className="studio-objects-item__name">
                        {r.properties?.isCapital ? '⭐ ' : ''}
                        {r.properties?.name || 'Без названия'}
                      </span>
                      <span className="studio-objects-item__id">
                        {r.properties?.countryId}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
