import type { Feature, MultiPolygon, Polygon } from 'geojson'
import type { StudioMode, StudioTool } from './types'

type Props = {
  mode: StudioMode
  onModeChange: (mode: StudioMode) => void
  activeTool: StudioTool
  onToolChange: (tool: StudioTool) => void
  countries: Feature<Polygon | MultiPolygon>[]
  regions: Feature<Polygon | MultiPolygon>[]
  fillCountryId: string | null
  onFillCountryChange: (countryId: string) => void
  fillRegionId: string | null
  onFillRegionChange: (regionId: string) => void
  unsavedCount: number
  isSaving: boolean
  onSave: () => void
  onPublishClick: () => void
  onExit: () => void
}

export function StudioToolbar({
  mode,
  onModeChange,
  activeTool,
  onToolChange,
  countries,
  regions,
  fillCountryId,
  onFillCountryChange,
  fillRegionId,
  onFillRegionChange,
  unsavedCount,
  isSaving,
  onSave,
  onPublishClick,
  onExit,
}: Props) {
  const currentCountryRegions = regions.filter((r) => r.properties?.countryId === fillCountryId)

  return (
    <header className="studio-toolbar" role="toolbar" aria-label="Панель инструментов картографа">
      <div className="studio-toolbar__brand">
        <span className="studio-toolbar__logo">🗺️</span>
        <div className="studio-toolbar__title-group">
          <strong>Студия карты</strong>
          <span className="studio-toolbar__badge">v1.2</span>
        </div>
      </div>

      <div className="studio-toolbar__separator" />

      {/* Mode switcher: Countries vs Regions */}
      <div className="studio-toolbar__segmented">
        <button
          type="button"
          className={`studio-segmented-btn ${mode === 'countries' ? 'studio-segmented-btn--active' : ''}`}
          onClick={() => onModeChange('countries')}
          title="Редактирование государств"
        >
          🌍 Страны
        </button>
        <button
          type="button"
          className={`studio-segmented-btn ${mode === 'regions' ? 'studio-segmented-btn--active' : ''}`}
          onClick={() => onModeChange('regions')}
          title="Редактирование регионов"
        >
          🗺️ Регионы
        </button>
      </div>

      <div className="studio-toolbar__separator" />

      {/* Tools */}
      <div className="studio-toolbar__tools">
        <button
          type="button"
          className={`studio-tool-btn ${activeTool === 'select' ? 'studio-tool-btn--active' : ''}`}
          onClick={() => onToolChange('select')}
          title="Выбрать объект на карте и перемещать карту"
        >
          <span className="studio-tool-icon">👆</span>
          <span>Выбор</span>
        </button>

        {mode === 'regions' && (
          <button
            type="button"
            className={`studio-tool-btn ${activeTool === 'slice-region' ? 'studio-tool-btn--active' : ''}`}
            onClick={() => onToolChange('slice-region')}
            title="Провести тонкую линию и нарезать регион"
          >
            <span className="studio-tool-icon">✂️</span>
            <span>Нарезать регион</span>
          </button>
        )}

        <button
          type="button"
          className={`studio-tool-btn ${activeTool === 'redraw-border' ? 'studio-tool-btn--active' : ''}`}
          onClick={() => onToolChange('redraw-border')}
          title="Нарисовать границу от руки"
        >
          <span className="studio-tool-icon">✏️</span>
          <span>Перерисовать границу</span>
        </button>

        <button
          type="button"
          className={`studio-tool-btn ${activeTool === 'bucket-fill' ? 'studio-tool-btn--active' : ''}`}
          onClick={() => onToolChange('bucket-fill')}
          title="Заливка острова выбранной страной"
        >
          <span className="studio-tool-icon">🪣</span>
          <span>Заливка острова</span>
        </button>

        <button
          type="button"
          className={`studio-tool-btn ${activeTool === 'move-label' ? 'studio-tool-btn--active' : ''}`}
          onClick={() => onToolChange('move-label')}
          title="Свободно переместить название по карте внутри границы"
        >
          <span className="studio-tool-icon">🏷️</span>
          <span>Положение названий</span>
        </button>

        {mode === 'regions' && (
          <button
            type="button"
            className={`studio-tool-btn ${activeTool === 'erase-region' ? 'studio-tool-btn--active' : ''}`}
            onClick={() => onToolChange('erase-region')}
            title="Удалить выбранный регион"
          >
            <span className="studio-tool-icon">🧹</span>
            <span>Удалить регион</span>
          </button>
        )}
      </div>

      {/* Island Fill Country/Region Selector */}
      {activeTool === 'bucket-fill' && (
        <div className="studio-toolbar__fill-selector">
          <label className="studio-fill-label">
            <span>Страна для заливки:</span>
            <select
              value={fillCountryId || ''}
              onChange={(e) => onFillCountryChange(e.target.value)}
              className="studio-select"
            >
              {countries.map((c) => (
                <option key={c.properties?.id} value={c.properties?.id}>
                  {c.properties?.name || c.properties?.id}
                </option>
              ))}
            </select>
          </label>

          {mode === 'regions' && currentCountryRegions.length > 0 && (
            <label className="studio-fill-label">
              <span>Регион:</span>
              <select
                value={fillRegionId || ''}
                onChange={(e) => onFillRegionChange(e.target.value)}
                className="studio-select"
              >
                <option value="">(вся страна)</option>
                {currentCountryRegions.map((r) => (
                  <option key={r.properties?.id} value={r.properties?.id}>
                    {r.properties?.name || r.properties?.id}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="studio-toolbar__spacer" />

      {/* Save & Publish */}
      <div className="studio-toolbar__actions">
        {unsavedCount > 0 && (
          <span className="studio-unsaved-badge" title="Есть несохраненные изменения">
            ● Изменено: {unsavedCount}
          </span>
        )}

        <button
          type="button"
          className="studio-action-btn studio-action-btn--save"
          onClick={onSave}
          disabled={isSaving}
          title="Сохранить в локальные файлы карты (Ctrl+S)"
        >
          💾 {isSaving ? 'Сохранение...' : 'Сохранить'}
        </button>

        <button
          type="button"
          className="studio-action-btn studio-action-btn--publish"
          onClick={onPublishClick}
          title="Закоммитить и опубликовать на GitHub"
        >
          🚀 Опубликовать на GitHub
        </button>

        <button
          type="button"
          className="studio-action-btn studio-action-btn--exit"
          onClick={onExit}
          title="Выйти из режима редактора"
        >
          ✕
        </button>
      </div>
    </header>
  )
}
