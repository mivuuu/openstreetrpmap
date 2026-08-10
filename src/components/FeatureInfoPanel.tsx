import { KLEROPOL_PLACE_DETAILS } from '../data/kleropolPlace'
import type { SelectedMapFeature } from '../types/mapFeatures'

type FeatureInfoPanelProps = {
  city: SelectedMapFeature
  onClose: () => void
}

const populationFormatter = new Intl.NumberFormat('ru-RU')

export function FeatureInfoPanel({ city, onClose }: FeatureInfoPanelProps) {
  const { properties } = city
  const details = KLEROPOL_PLACE_DETAILS
  const population = populationFormatter.format(details.population)

  return (
    <aside className="feature-panel" aria-label={`Информация о городе ${properties.name}`}>
      <header className="feature-panel__header">
        <div>
          <h2>{properties.name}</h2>
          <p className="feature-panel__status">
            <span aria-hidden="true" />
            {details.status}
          </p>
        </div>
        <button
          type="button"
          className="panel-close"
          onClick={onClose}
          aria-label="Закрыть информационную панель"
        >
          ×
        </button>
      </header>

      <div className="feature-panel__content">
        <p className="feature-panel__population">{population} жителей</p>
        <p className="feature-panel__description">{details.description}</p>

        <dl className="feature-panel__details">
          <div>
            <dt>Население</dt>
            <dd>{population} человек</dd>
          </div>
          <div>
            <dt>Площадь</dt>
            <dd>{details.area}</dd>
          </div>
          <div>
            <dt>Основан</dt>
            <dd>{details.founded}</dd>
          </div>
        </dl>

        <p className="feature-panel__mock-note">Тестовые данные для макета</p>
      </div>
    </aside>
  )
}
